-- 0002_party.sql: mesin Party (validasi jawaban, room, fase, nyawa, handoff).
-- STATUS: ditulis dari architecture.md, BELUM dijalankan terhadap Postgres. Jalankan setelah 0001_schema.sql, lalu seed.sql.
-- Semua RPC mengembalikan jsonb; galat bisnis lewat {"error": "..."} (bukan exception) supaya pencatatan percobaan tidak ikut di-rollback.
-- Catatan: fungsi security definer memakai search_path = public, extensions, pg_temp.

create or replace function public.server_time() returns timestamptz language sql stable as $$ select clock_timestamp() $$;

create or replace function public.osa_distance(a text, b text, mx int) returns int
language plpgsql immutable as $$
declare la int := length(a); lb int := length(b); d int[]; i int; j int; c int; v int; w int := length(b) + 1;
begin
  if abs(la - lb) > mx then return mx + 1; end if;
  d := array_fill(0, array[(la + 1) * w]);
  for i in 0..la loop d[i * w + 1] := i; end loop;
  for j in 0..lb loop d[j + 1] := j; end loop;
  for i in 1..la loop
    for j in 1..lb loop
      c := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      v := least(d[(i - 1) * w + j + 1] + 1, d[i * w + j] + 1, d[(i - 1) * w + j] + c);
      if i > 1 and j > 1 and substr(a, i, 1) = substr(b, j - 1, 1) and substr(a, i - 1, 1) = substr(b, j, 1) then
        v := least(v, d[(i - 2) * w + j - 1] + 1);
      end if;
      d[i * w + j + 1] := v;
    end loop;
  end loop;
  return d[la * w + lb + 1];
end $$;

-- Padanan SQL dari src/engine/match.ts#validate. Ubah keduanya bersama.
create or replace function public.validate_answer(p_question uuid, p_text text) returns jsonb
language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare loc text; q text; lim int; best int := 99; d int; r record; hit_ans uuid; hit_term text; hit_canon boolean := false; amb boolean := false;
begin
  select locale into loc from questions where id = p_question;
  q := normalize_text(p_text, loc);
  if q = '' then return '{"status":"invalid"}'::jsonb; end if;
  select t.answer_id into hit_ans from answer_terms t where t.question_id = p_question and t.norm = q;
  if found then return jsonb_build_object('status', 'accepted', 'answer_id', hit_ans); end if;
  lim := case when length(q) <= 4 then 0 when length(q) <= 8 then 1 else 2 end;
  if lim = 0 then return '{"status":"invalid"}'::jsonb; end if;
  for r in select t.answer_id, t.term, t.norm, (t.kind = 'canonical') as canon from answer_terms t
            where t.question_id = p_question and abs(length(t.norm) - length(q)) <= lim loop
    d := osa_distance(q, r.norm, lim);
    if d > lim then continue; end if;
    if d < best then best := d; hit_ans := r.answer_id; hit_term := r.term; hit_canon := r.canon; amb := false;
    elsif d = best then
      if r.answer_id <> hit_ans then amb := true;
      elsif r.canon and not hit_canon then hit_term := r.term; hit_canon := true; end if;
    end if;
  end loop;
  if best = 99 or amb then return '{"status":"invalid"}'::jsonb; end if;
  if hit_canon then return jsonb_build_object('status', 'accepted', 'answer_id', hit_ans); end if;
  return jsonb_build_object('status', 'needs_confirm', 'answer_id', hit_ans, 'term', hit_term);
end $$;

create or replace function public.nickname_ok(p text) returns boolean
language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare n text; tok text; r record;
begin
  n := translate(lower(unaccent(p)), '0134579@$', 'oieastgas');
  n := regexp_replace(n, '(.)\1{2,}', '\1\1', 'g');
  tok := ' ' || regexp_replace(n, '[^a-z]+', ' ', 'g') || ' ';
  n := regexp_replace(n, '[^a-z]+', '', 'g');
  for r in select term, severity from blocked_terms loop
    if (r.severity = 'severe' and position(r.term in n) > 0) or (r.severity = 'mild' and position(' ' || r.term || ' ' in tok) > 0) then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.gen_room_code() returns text language plpgsql as $$
declare c text; len int; n int;
begin
  select count(*) into n from rooms where phase not in ('finished', 'closed');
  len := case when n < 800 then 4 when n < 8000 then 5 else 6 end;
  loop
    c := lpad(floor(random() * power(10, len))::bigint::text, len, '0');
    exit when not exists (select 1 from rooms where code = c and phase not in ('finished', 'closed'));
  end loop;
  return c;
end $$;

-- Serahkan host ke pemain terhubung dengan joined_at paling awal.
create or replace function public.room_handoff(p_room uuid) returns void language plpgsql as $$
declare nh uuid;
begin
  select id into nh from room_players where room_id = p_room and is_connected and left_at is null and not kicked order by joined_at limit 1;
  if nh is null then return; end if;
  update room_players set is_host = false where room_id = p_room and is_host and id <> nh;
  update room_players set is_host = true where id = nh;
end $$;

create or replace function public.room_create(p_nick text, p_config jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := auth.uid(); rid uuid; pid uuid; v_code text;
begin
  if uid is null then return jsonb_build_object('error', 'auth_required'); end if;
  if not nickname_ok(p_nick) then return jsonb_build_object('error', 'nickname_blocked'); end if;
  if exists (select 1 from room_players rp join rooms r on r.id = rp.room_id
              where rp.user_id = uid and rp.left_at is null and not rp.kicked and r.phase not in ('finished', 'closed')) then
    return jsonb_build_object('error', 'already_in_room'); end if;
  v_code := gen_room_code();
  insert into rooms (code, question_locale, category_ids, round_duration_sec, total_rounds, lives_enabled, initial_lives)
  values (v_code, coalesce(p_config ->> 'question_locale', 'id'),
          coalesce(array(select jsonb_array_elements_text(p_config -> 'category_ids')::uuid), '{}'),
          coalesce((p_config ->> 'round_duration_sec')::int, 25), coalesce((p_config ->> 'total_rounds')::int, 7),
          coalesce((p_config ->> 'lives_enabled')::boolean, false), coalesce((p_config ->> 'initial_lives')::int, 3))
  returning id into rid;
  insert into room_players (room_id, user_id, nickname, nickname_norm, is_host) values (rid, uid, btrim(p_nick), lower(btrim(p_nick)), true) returning id into pid;
  insert into player_heartbeats (player_id) values (pid);
  return jsonb_build_object('room_id', rid, 'code', v_code);
exception when check_violation then return jsonb_build_object('error', 'invalid_input');
end $$;

create or replace function public.room_join(p_code text, p_nick text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := auth.uid(); r rooms; pid uuid; v_nn text;
begin
  if uid is null then return jsonb_build_object('error', 'auth_required'); end if;
  if (select count(*) from join_attempts where user_id = uid and not ok and created_at > now() - interval '5 minutes') >= 10 then
    return jsonb_build_object('error', 'too_many_attempts'); end if;
  select * into r from rooms where code = p_code and phase not in ('finished', 'closed');
  if not found then
    insert into join_attempts (user_id, code_tried, ok) values (uid, left(coalesce(p_code, ''), 6), false);
    return jsonb_build_object('error', 'not_found');
  end if;
  select id into pid from room_players where room_id = r.id and user_id = uid and not kicked;
  if found then  -- reconnect
    update room_players set left_at = null, is_connected = true where id = pid;
    insert into player_heartbeats (player_id) values (pid) on conflict (player_id) do update set seen_at = now();
    return jsonb_build_object('room_id', r.id, 'code', r.code);
  end if;
  if r.phase <> 'lobby' then return jsonb_build_object('error', 'started'); end if;
  if r.join_locked then return jsonb_build_object('error', 'locked'); end if;
  if (select count(*) from room_players where room_id = r.id and left_at is null and not kicked) >= r.max_players then return jsonb_build_object('error', 'full'); end if;
  if not nickname_ok(p_nick) then return jsonb_build_object('error', 'nickname_blocked'); end if;
  v_nn := lower(btrim(p_nick));
  if exists (select 1 from room_players where room_id = r.id and nickname_norm = v_nn) then return jsonb_build_object('error', 'nickname_taken'); end if;
  if exists (select 1 from room_players rp join rooms x on x.id = rp.room_id where rp.user_id = uid and rp.left_at is null and not rp.kicked and x.phase not in ('finished', 'closed')) then
    return jsonb_build_object('error', 'already_in_room'); end if;
  insert into room_players (room_id, user_id, nickname, nickname_norm) values (r.id, uid, btrim(p_nick), v_nn) returning id into pid;
  insert into player_heartbeats (player_id) values (pid);
  insert into join_attempts (user_id, code_tried, ok) values (uid, p_code, true);
  return jsonb_build_object('room_id', r.id, 'code', r.code);
exception when check_violation then return jsonb_build_object('error', 'invalid_input');
end $$;

create or replace function public.room_my_active() returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('room_id', r.id, 'code', r.code) from room_players rp join rooms r on r.id = rp.room_id
                    where rp.user_id = auth.uid() and rp.left_at is null and not rp.kicked and r.phase not in ('finished', 'closed')
                    order by rp.joined_at desc limit 1), '{}'::jsonb);
$$;

-- Snapshot untuk pemanggil. Jawaban orang lain tidak keluar sebelum fase reveal.
create or replace function public.room_get_state(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare r rooms; me room_players; rr room_rounds; pl jsonb; rev jsonb; prm text; mylock boolean := false; v_cnt int;
begin
  select * into r from rooms where id = p_room;
  select * into me from room_players where room_id = p_room and user_id = auth.uid() and not kicked;
  if r.id is null or me.id is null then return jsonb_build_object('error', 'not_member'); end if;
  select * into rr from room_rounds where room_id = p_room and round_no = r.current_round;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nickname', nickname, 'is_host', is_host, 'connected', is_connected, 'score', score,
           'meters', meters, 'lives', remaining_lives, 'eliminated', is_eliminated, 'locked', (r.current_round > 0 and locked_round = r.current_round),
           'final_rank', final_rank, 'me', id = me.id) order by joined_at), '[]'::jsonb)
    into pl from room_players where room_id = p_room and left_at is null and not kicked;
  if rr.id is not null and r.phase in ('answering', 'reveal', 'leaderboard', 'finished') then
    select prompt into prm from questions where id = rr.question_id;
  end if;
  if rr.id is not null and r.phase in ('reveal', 'leaderboard', 'finished') then
    select jsonb_agg(jsonb_build_object('player_id', s.player_id, 'nickname', p.nickname, 'text', s.answered_text, 'answer', a.canonical, 'tier', s.tier,
             'points', s.points, 'meters', s.meters, 'rank', s.round_rank, 'life_lost', s.life_lost, 'outcome', s.outcome) order by s.round_rank nulls last, p.nickname)
      into rev from room_submissions s join room_players p on p.id = s.player_id left join answers a on a.id = s.answer_id where s.room_round_id = rr.id;
  end if;
  if rr.id is not null then mylock := exists (select 1 from room_submissions where room_round_id = rr.id and player_id = me.id and outcome = 'valid'); end if;
  return jsonb_build_object('server_now', clock_timestamp(), 'room_id', r.id, 'code', r.code, 'phase', r.phase, 'phase_seq', r.phase_seq,
    'round', r.current_round, 'total_rounds', r.total_rounds, 'round_duration_sec', r.round_duration_sec, 'lives_enabled', r.lives_enabled,
    'initial_lives', r.initial_lives, 'question_locale', r.question_locale, 'join_locked', r.join_locked, 'max_players', r.max_players,
    'deadline', r.phase_deadline_at, 'prompt', prm, 'me', me.id, 'is_host', me.is_host, 'eliminated', me.is_eliminated, 'my_locked', mylock,
    'players', pl, 'reveal', coalesce(rev, '[]'::jsonb));
end $$;

create or replace function public.room_update_config(p_room uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not exists (select 1 from room_players where room_id = p_room and user_id = auth.uid() and is_host and left_at is null) then return jsonb_build_object('error', 'not_host'); end if;
  update rooms set
    round_duration_sec = coalesce((p_patch ->> 'round_duration_sec')::int, round_duration_sec),
    total_rounds = coalesce((p_patch ->> 'total_rounds')::int, total_rounds),
    lives_enabled = coalesce((p_patch ->> 'lives_enabled')::boolean, lives_enabled),
    initial_lives = coalesce((p_patch ->> 'initial_lives')::int, initial_lives),
    question_locale = coalesce(p_patch ->> 'question_locale', question_locale),
    join_locked = coalesce((p_patch ->> 'join_locked')::boolean, join_locked)
  where id = p_room and phase = 'lobby';
  if not found then return jsonb_build_object('error', 'not_lobby'); end if;
  return jsonb_build_object('ok', true);
exception when check_violation then return jsonb_build_object('error', 'invalid_input');
end $$;

create or replace function public.room_start(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r rooms; n int; np int;
begin
  select * into r from rooms where id = p_room for update;
  if not exists (select 1 from room_players where room_id = p_room and user_id = auth.uid() and is_host and left_at is null) then return jsonb_build_object('error', 'not_host'); end if;
  if r.phase <> 'lobby' then return jsonb_build_object('error', 'not_lobby'); end if;
  select count(*) into np from room_players where room_id = p_room and left_at is null and not kicked;
  if np < coalesce((r.settings ->> 'min_players')::int, 2) then return jsonb_build_object('error', 'need_players'); end if;
  select count(*) into n from questions where locale = r.question_locale and status = 'live' and (cardinality(r.category_ids) = 0 or category_id = any (r.category_ids));
  if n < r.total_rounds then return jsonb_build_object('error', 'not_enough_questions'); end if;
  insert into room_rounds (room_id, round_no, question_id)
    select p_room, (row_number() over ())::int, x.id from (select id from questions where locale = r.question_locale and status = 'live'
      and (cardinality(r.category_ids) = 0 or category_id = any (r.category_ids)) order by random() limit r.total_rounds) x;
  update room_players set remaining_lives = case when r.lives_enabled then r.initial_lives end where room_id = p_room and left_at is null and not kicked;
  update rooms set phase = 'starting', phase_seq = phase_seq + 1, started_at = now(), phase_started_at = now(), phase_deadline_at = now() + interval '3 seconds' where id = p_room;
  return jsonb_build_object('ok', true);
end $$;

-- Mengunci jawaban valid (internal). Jawaban valid PERTAMA menang lewat unique(room_round_id, player_id).
create or replace function public.room_lock_answer(p_room uuid, p_answer uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r rooms; me room_players; rr room_rounds; tr tiers; v_tier smallint; n int;
begin
  select * into r from rooms where id = p_room;
  select * into me from room_players where room_id = p_room and user_id = auth.uid() and not kicked;
  select * into rr from room_rounds where room_id = p_room and round_no = r.current_round;
  select tier into v_tier from answers where id = p_answer;
  select * into tr from tiers where tier = v_tier;
  insert into room_submissions (room_round_id, player_id, outcome, answer_id, answered_text, tier, points, meters, answer_ms)
  values (rr.id, me.id, 'valid', p_answer, left(p_text, 80), tr.tier, tr.points, tr.meters, (extract(epoch from clock_timestamp() - rr.started_at) * 1000)::int)
  on conflict (room_round_id, player_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('status', 'already_locked'); end if;
  update room_players set locked_round = r.current_round where id = me.id;
  perform room_advance(p_room, r.phase_seq);   -- selesai lebih awal bila semua pemain aktif sudah mengunci
  return jsonb_build_object('status', 'locked');
end $$;

create or replace function public.room_submit(p_room uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := auth.uid(); r rooms; me room_players; rr room_rounds; v jsonb; n int; last_at timestamptz; cid uuid; v_norm text;
begin
  select * into r from rooms where id = p_room;
  select * into me from room_players where room_id = p_room and user_id = uid and not kicked and left_at is null;
  if r.id is null or me.id is null then return jsonb_build_object('status', 'not_member'); end if;
  if me.is_eliminated then return jsonb_build_object('status', 'spectator'); end if;
  if r.phase <> 'answering' or clock_timestamp() > r.phase_deadline_at + interval '300 ms' then return jsonb_build_object('status', 'closed'); end if;
  select * into rr from room_rounds where room_id = p_room and round_no = r.current_round;
  if exists (select 1 from room_submissions where room_round_id = rr.id and player_id = me.id) then return jsonb_build_object('status', 'already_locked'); end if;
  select count(*), max(created_at) into n, last_at from attempt_log where round_id = rr.id and user_id = uid;
  if n >= 40 or (last_at is not null and clock_timestamp() - last_at < interval '400 ms') then return jsonb_build_object('status', 'rate_limited'); end if;
  v := validate_answer(rr.question_id, p_text);
  v_norm := normalize_text(p_text, r.question_locale);
  insert into attempt_log (scope, round_id, user_id, question_id, raw_text, norm, result)
  values ('room', rr.id, uid, rr.question_id, left(p_text, 80), v_norm, case v ->> 'status' when 'accepted' then 'accepted' when 'needs_confirm' then 'needs_confirm' else 'invalid' end);
  if v ->> 'status' = 'accepted' then return room_lock_answer(p_room, (v ->> 'answer_id')::uuid, p_text); end if;
  if v ->> 'status' = 'needs_confirm' then
    insert into pending_confirms (scope, round_id, user_id, answer_id, matched_term) values ('room', rr.id, uid, (v ->> 'answer_id')::uuid, v ->> 'term') returning id into cid;
    return jsonb_build_object('status', 'needs_confirm', 'confirm_id', cid, 'term', v ->> 'term');
  end if;
  return jsonb_build_object('status', 'invalid');
end $$;

create or replace function public.room_confirm(p_room uuid, p_confirm uuid, p_yes boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare pc pending_confirms; r rooms; rr room_rounds;
begin
  select * into pc from pending_confirms where id = p_confirm and user_id = auth.uid() and expires_at > now();
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  delete from pending_confirms where id = p_confirm;
  if not p_yes then return jsonb_build_object('status', 'invalid'); end if;
  select * into r from rooms where id = p_room;
  select * into rr from room_rounds where room_id = p_room and round_no = r.current_round;
  if rr.id is distinct from pc.round_id or r.phase <> 'answering' or clock_timestamp() > r.phase_deadline_at + interval '300 ms' then return jsonb_build_object('status', 'closed'); end if;
  return room_lock_answer(p_room, pc.answer_id, pc.matched_term);
end $$;

create or replace function public.room_advance(p_room uuid, p_seq bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r rooms; rr room_rounds; v_now timestamptz := clock_timestamp(); active int; locked int; alive int; started int; finish boolean;
begin
  select * into r from rooms where id = p_room for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if auth.uid() is not null and not exists (select 1 from room_players where room_id = p_room and user_id = auth.uid() and not kicked) then return jsonb_build_object('error', 'not_member'); end if;
  if r.phase_seq <> p_seq or r.phase in ('lobby', 'finished', 'closed') then return jsonb_build_object('advanced', false, 'phase_seq', r.phase_seq); end if;
  select * into rr from room_rounds where room_id = p_room and round_no = r.current_round;

  if r.phase = 'starting' then
    if v_now < r.phase_deadline_at then return jsonb_build_object('advanced', false, 'phase_seq', r.phase_seq); end if;
    update rooms set phase = 'answering', current_round = 1, phase_seq = phase_seq + 1, phase_started_at = v_now, phase_deadline_at = v_now + r.round_duration_sec * interval '1 second' where id = p_room;
    update room_rounds set started_at = v_now, deadline_at = v_now + r.round_duration_sec * interval '1 second' where room_id = p_room and round_no = 1;

  elsif r.phase = 'answering' then
    select count(*) into active from room_players where room_id = p_room and left_at is null and not kicked and not is_eliminated;
    select count(*) into locked from room_submissions s join room_players p on p.id = s.player_id where s.room_round_id = rr.id and s.outcome = 'valid' and not p.is_eliminated and p.left_at is null;
    if not (v_now >= r.phase_deadline_at + interval '300 ms' or (active > 0 and locked >= active)) then return jsonb_build_object('advanced', false, 'phase_seq', r.phase_seq); end if;
    insert into room_submissions (room_round_id, player_id, outcome, points, meters)
      select rr.id, p.id, 'timeout', 0, 0 from room_players p where p.room_id = p_room and p.left_at is null and not p.kicked and not p.is_eliminated
         and not exists (select 1 from room_submissions s where s.room_round_id = rr.id and s.player_id = p.id);
    if r.lives_enabled then
      update room_submissions set life_lost = true where room_round_id = rr.id and outcome = 'timeout';
      update room_players p set remaining_lives = greatest(p.remaining_lives - 1, 0) from room_submissions s
        where s.room_round_id = rr.id and s.player_id = p.id and s.outcome = 'timeout' and p.remaining_lives is not null;
      update room_players set is_eliminated = true, eliminated_round = r.current_round where room_id = p_room and not is_eliminated and remaining_lives = 0;
    end if;
    update room_players p set score = p.score + s.points, meters = p.meters + s.meters from room_submissions s
      where s.room_round_id = rr.id and s.player_id = p.id and s.outcome = 'valid';
    update room_submissions s set round_rank = x.rk from (select id, (rank() over (order by tier desc, answer_ms asc))::int rk from room_submissions where room_round_id = rr.id and outcome = 'valid') x where s.id = x.id;
    update room_rounds set revealed_at = v_now where id = rr.id;
    update rooms set phase = 'reveal', phase_seq = phase_seq + 1, phase_started_at = v_now, phase_deadline_at = v_now + interval '8 seconds' where id = p_room;

  elsif r.phase = 'reveal' then
    if v_now < r.phase_deadline_at then return jsonb_build_object('advanced', false, 'phase_seq', r.phase_seq); end if;
    update rooms set phase = 'leaderboard', phase_seq = phase_seq + 1, phase_started_at = v_now, phase_deadline_at = v_now + interval '5 seconds' where id = p_room;

  elsif r.phase = 'leaderboard' then
    if v_now < r.phase_deadline_at then return jsonb_build_object('advanced', false, 'phase_seq', r.phase_seq); end if;
    select count(*) filter (where not is_eliminated), count(*) into alive, started from room_players where room_id = p_room and left_at is null and not kicked;
    finish := r.current_round >= r.total_rounds or (r.lives_enabled and (alive = 0 or (alive <= 1 and started >= 2)));
    if finish then
      update room_players p set final_rank = x.rk from (select id, (row_number() over (order by is_eliminated asc,
          (case when is_eliminated then eliminated_round end) desc nulls first, score desc, joined_at asc))::int rk
          from room_players where room_id = p_room and left_at is null and not kicked) x where p.id = x.id;
      update rooms set phase = 'finished', phase_seq = phase_seq + 1, finished_at = v_now, phase_deadline_at = null where id = p_room;
    else
      update rooms set phase = 'answering', current_round = current_round + 1, phase_seq = phase_seq + 1, phase_started_at = v_now,
             phase_deadline_at = v_now + r.round_duration_sec * interval '1 second' where id = p_room;
      update room_rounds set started_at = v_now, deadline_at = v_now + r.round_duration_sec * interval '1 second' where room_id = p_room and round_no = r.current_round + 1;
    end if;
  end if;
  return jsonb_build_object('advanced', true, 'phase_seq', r.phase_seq + 1);
end $$;

create or replace function public.room_skip(p_room uuid, p_seq bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from room_players where room_id = p_room and user_id = auth.uid() and is_host and left_at is null) then return jsonb_build_object('error', 'not_host'); end if;
  update rooms set phase_deadline_at = now() - interval '1 second' where id = p_room and phase_seq = p_seq and phase in ('reveal', 'leaderboard');
  return public.room_advance(p_room, p_seq);
end $$;

create or replace function public.room_heartbeat(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me room_players;
begin
  select * into me from room_players where room_id = p_room and user_id = auth.uid() and not kicked;
  if me.id is null then return jsonb_build_object('error', 'not_member'); end if;
  insert into player_heartbeats (player_id) values (me.id) on conflict (player_id) do update set seen_at = now();
  update room_players set is_connected = true, left_at = null where id = me.id and (not is_connected or left_at is not null);
  update room_players p set is_connected = false from player_heartbeats h
    where h.player_id = p.id and p.room_id = p_room and p.is_connected and h.seen_at < now() - interval '40 seconds';
  if exists (select 1 from room_players where room_id = p_room and is_host and (not is_connected or left_at is not null)) then perform room_handoff(p_room); end if;
  return jsonb_build_object('server_now', clock_timestamp());
end $$;

create or replace function public.room_leave(p_room uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me room_players;
begin
  select * into me from room_players where room_id = p_room and user_id = auth.uid() and not kicked;
  if me.id is null then return jsonb_build_object('ok', true); end if;
  update room_players set left_at = now(), is_connected = false where id = me.id;
  if me.is_host then perform room_handoff(p_room); end if;
  if not exists (select 1 from room_players where room_id = p_room and left_at is null and not kicked) then
    update rooms set phase = 'closed', phase_deadline_at = null where id = p_room and phase = 'lobby';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Hak akses fungsi: hanya pengguna masuk (termasuk anonim) yang boleh memanggil RPC publik.
revoke all on function public.room_lock_answer(uuid, uuid, text), public.room_handoff(uuid), public.validate_answer(uuid, text), public.gen_room_code() from public, anon, authenticated;
grant execute on function public.server_time(), public.nickname_ok(text), public.room_create(text, jsonb), public.room_join(text, text), public.room_my_active(),
  public.room_get_state(uuid), public.room_update_config(uuid, jsonb), public.room_start(uuid), public.room_submit(uuid, text), public.room_confirm(uuid, uuid, boolean),
  public.room_advance(uuid, bigint), public.room_skip(uuid, bigint), public.room_heartbeat(uuid), public.room_leave(uuid) to authenticated;

-- Realtime: klien memantau perubahan baris lalu memuat ulang snapshot (RLS membatasi ke anggota room).
alter publication supabase_realtime add table public.rooms, public.room_players;
