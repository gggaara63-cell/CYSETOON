-- =====================================================================
-- replica/schema.sql  |  codename: puncak (nama sementara, ganti lewat /replica-brand)
-- Target: Supabase (Postgres 15+). Semua waktu timestamptz (UTC).
-- STATUS: ditulis dari spesifikasi, BELUM dijalankan terhadap Postgres
--         (tidak ada Postgres di lingkungan penulisan). Jalankan di proyek
--         kosong, perbaiki galat sintaks apa pun, lalu tambahkan fungsi RPC
--         dari architecture.md bagian "State machine".
-- Pengecualian aturan umum: tabel referensi kecil (locales, tiers,
-- normalize_articles, player_heartbeats) memakai kunci alami, bukan uuid.
-- =====================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;
-- pg_cron: aktifkan lewat dashboard (Database > Extensions), lalu lihat blok CRON di bawah.

-- ---------------------------------------------------------------------
-- 0. Utilitas
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 1. Referensi statis
-- ---------------------------------------------------------------------
create table public.locales (
  code       text primary key check (code in ('id','en')),
  reset_tz   text not null,                       -- zona waktu reset Daily
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.locales (code, reset_tz) values ('id','Asia/Jakarta'), ('en','UTC');

-- Nama tampilan tier ada di i18n/{id,en}.json, bukan di DB (kunci stabil = key).
create table public.tiers (
  tier       smallint primary key check (tier between 1 and 6),
  key        text not null unique,
  points     smallint not null,
  meters     smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.tiers (tier, key, points, meters) values
  (1,'foothills',  10,  100),
  (2,'shortcut',   15,  150),   -- "Terlalu Cerdik"
  (3,'slope',      30,  300),
  (4,'ridge',      60,  600),
  (5,'crag',       85,  850),
  (6,'summit',    100, 1000);   -- tier puncak

-- Artikel/kata depan yang dibuang di depan jawaban, per bahasa. Data, bukan kode.
create table public.normalize_articles (
  locale     text not null references public.locales(code),
  article    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (locale, article)
);
insert into public.normalize_articles (locale, article) values
  ('en','the'), ('en','a'), ('en','an'),
  ('id','si'),  ('id','sang');

-- Satu-satunya implementasi normalisasi. Dipakai trigger ingest DAN fungsi validasi,
-- supaya norm di tabel dan norm input pemain tidak pernah berbeda.
create or replace function public.normalize_text(txt text, loc text) returns text
language plpgsql stable set search_path = public, extensions as $$
declare
  t   text;
  art text;
begin
  t := lower(unaccent(coalesce(txt, '')));
  t := regexp_replace(t, '[^[:alnum:]]+', ' ', 'g');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  select a.article into art
    from public.normalize_articles a
   where a.locale = loc and t like a.article || ' %'
   order by length(a.article) desc
   limit 1;
  if art is not null then
    t := substr(t, length(art) + 2);
  end if;
  return t;
end $$;

-- ---------------------------------------------------------------------
-- 2. Bank soal (dipisah penuh per bahasa)
-- ---------------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  locale     text not null references public.locales(code),
  slug       text not null,
  name       text not null,
  sort       smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, slug),
  unique (id, locale)
);

create table public.questions (
  id           uuid primary key default gen_random_uuid(),
  locale       text not null references public.locales(code),
  category_id  uuid not null,
  slug         text not null,
  prompt       text not null check (char_length(prompt) between 8 and 200),
  hint         text,
  difficulty   smallint not null default 2 check (difficulty between 1 and 3),
  status       text not null default 'draft' check (status in ('draft','review','live','retired')),
  tier_cuts    jsonb not null default '{}',     -- override ambang persentil per soal
  sources      jsonb not null default '[]',     -- [{kind,url,license,attribution}]
  norm_version smallint not null default 1,
  answer_count integer not null default 0,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (locale, slug),
  foreign key (category_id, locale) references public.categories(id, locale) on delete restrict,
  check (status <> 'live' or published_at is not null)
);
create index questions_locale_status_idx on public.questions (locale, status);
create index questions_category_idx      on public.questions (category_id);

create table public.answers (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions(id) on delete cascade,
  canonical      text not null,
  familiarity    real check (familiarity between 0 and 1),
  tier_computed  smallint not null references public.tiers(tier),
  tier_override  smallint references public.tiers(tier),
  override_reason text check (override_reason in ('too_clever','gem','manual')),
  tier           smallint generated always as (coalesce(tier_override, tier_computed)) stored,
  ref_url        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, question_id),
  constraint override_pair check ((tier_override is null) = (override_reason is null)),
  constraint override_meaning check (
    override_reason is null
    or override_reason = 'manual'
    or (override_reason = 'too_clever' and tier_override = 2)
    or (override_reason = 'gem'        and tier_override = 6)
  )
);
create index answers_question_tier_idx on public.answers (question_id, tier);

-- Indeks pencarian: kanonik + alias dalam satu tabel. unique(question_id, norm)
-- membuat dua jawaban berbeda tidak bisa berbagi istilah yang sama (konflik
-- ketahuan saat ingest, bukan saat pemain bermain).
create table public.answer_terms (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null,
  answer_id   uuid not null,
  term        text not null,
  norm        text not null default '',
  kind        text not null check (kind in ('canonical','alias','spelling','abbreviation')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (answer_id, question_id) references public.answers(id, question_id) on delete cascade,
  unique (question_id, norm),
  check (norm <> '')
);
create index answer_terms_answer_idx on public.answer_terms (answer_id);
create unique index answer_terms_one_canonical on public.answer_terms (answer_id) where kind = 'canonical';

create or replace function public.answer_terms_set_norm() returns trigger
language plpgsql as $$
declare loc text;
begin
  select q.locale into loc from public.questions q where q.id = new.question_id;
  new.norm := public.normalize_text(new.term, loc);
  return new;
end $$;
create trigger answer_terms_norm before insert or update of term, question_id
  on public.answer_terms for each row execute function public.answer_terms_set_norm();

-- ---------------------------------------------------------------------
-- 3. Daily Challenge: 7 soal terkunci per (bahasa, tanggal)
-- ---------------------------------------------------------------------
create table public.daily_sets (
  id         uuid primary key default gen_random_uuid(),
  locale     text not null references public.locales(code),
  play_date  date not null,
  source     text not null default 'auto' check (source in ('auto','editorial')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, play_date)
);
create table public.daily_set_questions (
  daily_set_id uuid not null references public.daily_sets(id) on delete cascade,
  position     smallint not null check (position between 1 and 7),
  question_id  uuid not null references public.questions(id) on delete restrict,
  primary key (daily_set_id, position),
  unique (daily_set_id, question_id)
);
create index daily_set_questions_question_idx on public.daily_set_questions (question_id);
-- Jumlah tepat 7 soal dicek oleh daily_prefill() dan ingest, bukan constraint baris.

-- ---------------------------------------------------------------------
-- 4. Mode Solo
-- ---------------------------------------------------------------------
create table public.solo_sessions (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references auth.users(id) on delete cascade,  -- uid anonim perangkat
  mode         text not null check (mode in ('daily','endless')),
  locale       text not null references public.locales(code),
  play_date    date,
  status       text not null default 'active' check (status in ('active','finished','abandoned')),
  total_score  integer not null default 0,
  total_meters integer not null default 0,
  lives        smallint,                          -- hanya endless; maks 3
  rounds_played smallint not null default 0,
  seen_question_ids uuid[] not null default '{}', -- endless: hindari ulang
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint mode_shape check (
    (mode = 'daily'   and play_date is not null and lives is null) or
    (mode = 'endless' and play_date is null     and lives is not null and lives between 0 and 3)
  )
);
create unique index solo_one_daily_per_day on public.solo_sessions (player_id, locale, play_date) where mode = 'daily';
create index solo_sessions_player_idx on public.solo_sessions (player_id, started_at desc);
create index solo_sessions_active_idx on public.solo_sessions (started_at) where status = 'active';
create index solo_endless_best_idx    on public.solo_sessions (player_id, locale, total_score desc)
  where mode = 'endless' and status = 'finished';

create table public.solo_rounds (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.solo_sessions(id) on delete cascade,
  position      smallint not null check (position >= 1),
  question_id   uuid not null references public.questions(id) on delete restrict,
  shown_at      timestamptz not null default now(),
  deadline_at   timestamptz not null,             -- shown_at + 25 dtk, ditetapkan server
  status        text not null default 'open' check (status in ('open','locked','timeout')),
  answer_id     uuid references public.answers(id) on delete set null,
  answered_text text,
  tier          smallint references public.tiers(tier),   -- salinan, riwayat tetap utuh
  points        smallint not null default 0,
  meters        smallint not null default 0,
  locked_at     timestamptz,
  answer_ms     integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (session_id, position),
  check (deadline_at > shown_at),
  check (
    (status = 'open'    and tier is null and locked_at is null) or
    (status = 'locked'  and tier is not null and answer_ms is not null) or
    (status = 'timeout' and tier is null and points = 0)
  )
);
create index solo_rounds_question_idx on public.solo_rounds (question_id);
create index solo_rounds_open_idx     on public.solo_rounds (deadline_at) where status = 'open';

-- ---------------------------------------------------------------------
-- 5. Mode Party (Mabar)
-- ---------------------------------------------------------------------
create table public.rooms (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null check (code ~ '^[0-9]{4,6}$'),
  phase              text not null default 'lobby'
                       check (phase in ('lobby','starting','answering','reveal','leaderboard','finished','closed')),
  question_locale    text not null references public.locales(code),
  category_ids       uuid[] not null default '{}',       -- kosong = semua kategori
  -- Konfigurasi host (hanya bisa diubah saat phase = 'lobby'):
  round_duration_sec smallint not null default 25 check (round_duration_sec in (15,25,30,45,60)),
  total_rounds       smallint not null default 7  check (total_rounds in (5,7,10,15)),
  lives_enabled      boolean  not null default false,
  initial_lives      smallint not null default 3  check (initial_lives between 1 and 5),
  max_players        smallint not null default 12 check (max_players between 2 and 20),
  join_locked        boolean  not null default false,
  settings           jsonb    not null default '{}',     -- cadangan: reveal_sec, end_when_last_standing, dll.
  -- Mesin status:
  current_round      smallint not null default 0 check (current_round between 0 and 15),
  phase_seq          bigint   not null default 0,        -- naik 1 tiap transisi (CAS)
  phase_started_at   timestamptz,
  phase_deadline_at  timestamptz,
  last_progress_at   timestamptz,                        -- throttle siaran "n sudah menjawab"
  started_at         timestamptz,
  finished_at        timestamptz,
  expires_at         timestamptz not null default now() + interval '6 hours',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint round_within_total check (current_round <= total_rounds),
  constraint deadline_iff_timed check ((phase in ('lobby','finished','closed')) = (phase_deadline_at is null))
);
create unique index rooms_code_active_uidx on public.rooms (code) where phase not in ('finished','closed');
create index rooms_deadline_idx on public.rooms (phase_deadline_at) where phase in ('starting','answering','reveal','leaderboard');
create index rooms_expiry_idx   on public.rooms (expires_at) where phase <> 'closed';

create or replace function public.rooms_guard_config() returns trigger
language plpgsql as $$
begin
  if old.phase <> 'lobby' and (
        new.round_duration_sec is distinct from old.round_duration_sec
     or new.total_rounds       is distinct from old.total_rounds
     or new.lives_enabled      is distinct from old.lives_enabled
     or new.initial_lives      is distinct from old.initial_lives
     or new.question_locale    is distinct from old.question_locale
     or new.category_ids       is distinct from old.category_ids) then
    raise exception 'konfigurasi room terkunci setelah game dimulai' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger rooms_config_lock before update on public.rooms
  for each row execute function public.rooms_guard_config();

create table public.room_players (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,  -- uid anonim perangkat
  nickname        text not null check (char_length(nickname) between 2 and 16),
  nickname_norm   text not null,
  is_host         boolean not null default false,
  is_connected    boolean not null default true,
  score           integer not null default 0,
  meters          integer not null default 0,
  remaining_lives smallint check (remaining_lives is null or remaining_lives between 0 and 5),
  is_eliminated   boolean not null default false,
  eliminated_round smallint,
  locked_round    smallint not null default 0,      -- ronde terakhir yang sudah dikunci (untuk "n sudah menjawab")
  final_rank      smallint,
  kicked          boolean not null default false,
  left_at         timestamptz,
  joined_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (room_id, user_id),
  unique (room_id, nickname_norm),
  constraint elimination_shape check (
    (is_eliminated and eliminated_round is not null and coalesce(remaining_lives, -1) = 0)
    or (not is_eliminated and eliminated_round is null)
  )
);
create unique index room_players_one_host on public.room_players (room_id) where is_host;
create index room_players_user_idx on public.room_players (user_id);
create index room_players_room_idx on public.room_players (room_id) where left_at is null;

-- Detak jantung terpisah supaya tidak memicu event pada tabel yang dilanggan klien.
create table public.player_heartbeats (
  player_id uuid primary key references public.room_players(id) on delete cascade,
  seen_at   timestamptz not null default now()
);
create index player_heartbeats_seen_idx on public.player_heartbeats (seen_at);

create table public.room_rounds (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  round_no    smallint not null check (round_no between 1 and 15),
  question_id uuid not null references public.questions(id) on delete restrict,
  started_at  timestamptz,
  deadline_at timestamptz,
  revealed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (room_id, round_no),
  unique (room_id, question_id)
);
create index room_rounds_question_idx on public.room_rounds (question_id);

create table public.room_submissions (
  id            uuid primary key default gen_random_uuid(),
  room_round_id uuid not null references public.room_rounds(id) on delete cascade,
  player_id     uuid not null references public.room_players(id) on delete cascade,
  outcome       text not null check (outcome in ('valid','timeout')),
  answer_id     uuid references public.answers(id) on delete set null,
  answered_text text,
  tier          smallint references public.tiers(tier),
  points        smallint not null default 0,
  meters        smallint not null default 0,
  answer_ms     integer,
  round_rank    smallint,                           -- diisi saat transisi ke reveal
  life_lost     boolean not null default false,
  locked_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (room_round_id, player_id),                -- JAWABAN VALID PERTAMA MENGUNCI (anti-spam)
  check (
    (outcome = 'valid'   and tier is not null and answer_ms is not null) or
    (outcome = 'timeout' and tier is null and points = 0)
  )
);
create index room_submissions_player_idx on public.room_submissions (player_id);

-- ---------------------------------------------------------------------
-- 6. Anti-abuse, konfirmasi alias, filter nickname
-- ---------------------------------------------------------------------
create table public.attempt_log (          -- semua percobaan; juga bahan "jawaban yang belum terdaftar"
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('solo','room')),
  round_id    uuid not null,               -- solo_rounds.id atau room_rounds.id (polimorfik, tanpa FK)
  user_id     uuid not null,
  question_id uuid not null references public.questions(id) on delete cascade,
  raw_text    text not null check (char_length(raw_text) <= 80),
  norm        text,
  result      text not null check (result in ('accepted','invalid','needs_confirm','ambiguous','rate_limited')),
  created_at  timestamptz not null default now()
);
create index attempt_log_round_user_idx on public.attempt_log (round_id, user_id);
create index attempt_log_missing_idx    on public.attempt_log (question_id, norm) where result = 'invalid';
create index attempt_log_created_idx    on public.attempt_log (created_at);

create table public.pending_confirms (   -- "Maksud kamu ...?" (cocok lewat alias dengan typo)
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('solo','room')),
  round_id    uuid not null,
  user_id     uuid not null,
  answer_id   uuid not null references public.answers(id) on delete cascade,
  matched_term text not null,
  expires_at  timestamptz not null default now() + interval '20 seconds',
  created_at  timestamptz not null default now()
);
create index pending_confirms_expiry_idx on public.pending_confirms (expires_at);
create index pending_confirms_lookup_idx on public.pending_confirms (round_id, user_id);

create table public.blocked_terms (
  id         uuid primary key default gen_random_uuid(),
  locale     text not null references public.locales(code),
  term       text not null,                -- sudah ternormalisasi (huruf kecil, tanpa leet)
  severity   text not null check (severity in ('severe','mild')),  -- severe: cocok substring; mild: cocok token utuh
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, term)
);

create table public.join_attempts (      -- batas tebak kode room
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  code_tried text not null,
  ok         boolean not null,
  created_at timestamptz not null default now()
);
create index join_attempts_user_idx on public.join_attempts (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 7. Hak akses (RLS). Prinsip: klien hanya MEMBACA bagian miliknya;
--    semua penulisan lewat fungsi RPC security definer (lihat architecture.md).
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

alter table public.locales            enable row level security;
alter table public.tiers              enable row level security;
alter table public.normalize_articles enable row level security;
alter table public.categories         enable row level security;
alter table public.questions          enable row level security;   -- tanpa policy: server-only
alter table public.answers            enable row level security;   -- tanpa policy: server-only
alter table public.answer_terms       enable row level security;   -- tanpa policy: server-only
alter table public.daily_sets         enable row level security;   -- tanpa policy: lewat RPC
alter table public.daily_set_questions enable row level security;  -- tanpa policy: lewat RPC
alter table public.solo_sessions      enable row level security;
alter table public.solo_rounds        enable row level security;
alter table public.rooms              enable row level security;
alter table public.room_players       enable row level security;
alter table public.player_heartbeats  enable row level security;   -- tanpa policy
alter table public.room_rounds        enable row level security;
alter table public.room_submissions   enable row level security;
alter table public.attempt_log        enable row level security;   -- tanpa policy
alter table public.pending_confirms   enable row level security;   -- tanpa policy
alter table public.blocked_terms      enable row level security;   -- tanpa policy
alter table public.join_attempts      enable row level security;   -- tanpa policy

grant select on public.locales, public.tiers, public.normalize_articles, public.categories to authenticated;
grant select on public.solo_sessions, public.solo_rounds to authenticated;
grant select on public.rooms, public.room_players, public.room_rounds, public.room_submissions to authenticated;

create policy ref_read_locales    on public.locales            for select to authenticated using (true);
create policy ref_read_tiers      on public.tiers              for select to authenticated using (true);
create policy ref_read_articles   on public.normalize_articles for select to authenticated using (true);
create policy ref_read_categories on public.categories        for select to authenticated using (true);

create policy solo_sessions_own on public.solo_sessions for select to authenticated
  using (player_id = (select auth.uid()));
create policy solo_rounds_own on public.solo_rounds for select to authenticated
  using (exists (select 1 from public.solo_sessions s
                  where s.id = session_id and s.player_id = (select auth.uid())));

-- Helper security definer: menghindari rekursi RLS dan menyembunyikan data ronde berjalan.
create or replace function public.is_room_member(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_players rp
     where rp.room_id = p_room_id and rp.user_id = auth.uid()
       and not rp.kicked and rp.left_at is null);
$$;

create or replace function public.round_started(p_room_id uuid, p_round_no smallint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_room_member(p_room_id)
     and exists (select 1 from public.rooms r where r.id = p_room_id and r.current_round >= p_round_no);
$$;

-- Jawaban orang lain TIDAK terbaca selama ronde berjalan; terbuka serentak saat reveal.
create or replace function public.can_read_submission(p_room_round_id uuid, p_player_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.room_rounds rr
      join public.rooms r        on r.id = rr.room_id
      join public.room_players me on me.room_id = r.id and me.user_id = auth.uid()
                                  and not me.kicked and me.left_at is null
     where rr.id = p_room_round_id
       and ( me.id = p_player_id
          or r.phase in ('finished','closed')
          or r.current_round > rr.round_no
          or (r.current_round = rr.round_no and r.phase in ('reveal','leaderboard')) )
  );
$$;

create policy rooms_member         on public.rooms            for select to authenticated using (public.is_room_member(id));
create policy room_players_member  on public.room_players     for select to authenticated using (public.is_room_member(room_id));
create policy room_rounds_started  on public.room_rounds      for select to authenticated using (public.round_started(room_id, round_no));
create policy room_subs_revealed   on public.room_submissions for select to authenticated using (public.can_read_submission(room_round_id, player_id));

-- ---------------------------------------------------------------------
-- 8. updated_at otomatis untuk semua tabel yang punya kolomnya
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      'trg_' || t || '_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. CRON (aktifkan pg_cron dulu; fungsi-fungsi ini ditulis di milestone M4/M7)
-- ---------------------------------------------------------------------
-- select cron.schedule('room-sweep',      '5 seconds',  $$select public.room_sweep()$$);
-- select cron.schedule('daily-prefill',   '10 17 * * *', $$select public.daily_prefill(14)$$);   -- 00:10 WIB (UTC+7)
-- select cron.schedule('cleanup',         '*/10 * * * *', $$select public.cleanup_expired()$$);
-- select cron.schedule('abandon-solo',    '*/15 * * * *', $$select public.abandon_stale_solo()$$);
-- select cron.schedule('cron-log-purge',  '0 0 * * *',   $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
