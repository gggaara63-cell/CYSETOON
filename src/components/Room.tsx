'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Oxygen, TierPlate } from '@/components/ui';
import { rpc, useRoom, type Player, type Snap } from '@/lib/party';

const ROUNDS = [5, 7, 10, 15];
const SECS = [15, 25, 30, 45, 60];

export function Room({ roomId }: { roomId: string }) {
  const { t } = useI18n();
  const { snap, live, failed, refresh, now } = useRoom(roomId);
  if (!snap) return <main className="wrap" role="status">{failed ? t('party.err.generic') : t('play.loading')}</main>;
  return (
    <main className="wrap">
      {(failed || !live) && <p className="muted" role="status">{t('game.reconnecting')}</p>}
      {snap.phase === 'lobby' && <Lobby snap={snap} refresh={refresh} />}
      {snap.phase === 'starting' && <h1 className="display" style={{ fontSize: 'var(--text-display)' }} role="status">{t('game.starting')}</h1>}
      {snap.phase === 'answering' && <Arena snap={snap} now={now} refresh={refresh} />}
      {(snap.phase === 'reveal' || snap.phase === 'leaderboard') && <Reveal snap={snap} refresh={refresh} />}
      {(snap.phase === 'finished' || snap.phase === 'closed') && <Final snap={snap} />}
    </main>
  );
}

function Board({ players, lives }: { players: Player[]; lives: { on: boolean; max: number } }) {
  const { t } = useI18n();
  const sorted = [...players].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.score - a.score);
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {sorted.map((p, i) => (
        <li key={p.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
          <span><span className="num" style={{ marginRight: 8 }}>{i + 1}</span>
            <span style={{ fontWeight: p.me ? 700 : 400 }}>{p.nickname}{p.me ? ` (${t('lobby.you')})` : ''}</span>
            {p.eliminated && <span className="muted"> · {t('game.eliminated')}</span>}</span>
          <span className="row" style={{ gap: 12 }}>
            {lives.on && p.lives !== null && <Oxygen n={p.lives} max={lives.max} />}
            <strong className="num">{p.score}</strong>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Lobby({ snap, refresh }: { snap: Snap; refresh: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const patch = async (p: Record<string, unknown>) => { await rpc('room_update_config', { p_room: snap.room_id, p_patch: p }); refresh(); };
  const start = async () => {
    setBusy(true); setErr('');
    const r = await rpc<{ error?: string }>('room_start', { p_room: snap.room_id }).catch(() => ({ error: 'generic' }));
    setBusy(false);
    if (r.error) setErr(t(`party.err.${r.error}`)); else refresh();
  };
  const leave = async () => { await rpc('room_leave', { p_room: snap.room_id }).catch(() => {}); router.push('/mabar'); };
  const host = snap.is_host;
  const lives = snap.lives_enabled ? t('lobby.livesSummary.on', { n: snap.initial_lives }) : t('lobby.livesSummary.off');
  return (
    <div className="home">
      <section className="plate big">
        <p className="muted">{t('lobby.code')}</p>
        <p className="display num" style={{ fontSize: 'var(--text-numeral)', lineHeight: 1 }}>{snap.code}</p>
        <button className="btn secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(snap.code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} }}>{t('lobby.copy')}</button>
        <span role="status" className="muted" style={{ marginLeft: 12 }}>{copied ? t('lobby.copied') : ''}</span>
        <h2 style={{ fontSize: 28, margin: '24px 0 8px' }}>{t('lobby.players', { n: snap.players.length })}</h2>
        {snap.players.length < 2 && <p className="muted">{t('lobby.alone')}</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {snap.players.map((p) => (
            <li key={p.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ fontWeight: p.me ? 700 : 400 }}>{p.nickname}{p.me ? ` (${t('lobby.you')})` : ''}</span>
              <span className="muted">{p.is_host ? t('lobby.host') : ''}{!p.connected ? ` ${t('lobby.offline')}` : ''}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="plate">
        <h2 style={{ fontSize: 28, marginBottom: 12 }}>{t('lobby.settings')}</h2>
        {host ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <label>{t('lobby.rounds')}<br />
              <select value={snap.total_rounds} onChange={(e) => patch({ total_rounds: +e.target.value })}>{ROUNDS.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label>{t('lobby.duration')}<br />
              <select value={snap.round_duration_sec} onChange={(e) => patch({ round_duration_sec: +e.target.value })}>{SECS.map((n) => <option key={n} value={n}>{t('lobby.seconds', { n })}</option>)}</select></label>
            <label>{t('lobby.lives')}<br />
              <select value={snap.lives_enabled ? 'on' : 'off'} onChange={(e) => patch({ lives_enabled: e.target.value === 'on' })}>
                <option value="off">{t('lobby.lives.off')}</option><option value="on">{t('lobby.lives.on')}</option></select></label>
            {snap.lives_enabled && (
              <label>{t('lobby.livesCount')}<br />
                <select value={snap.initial_lives} onChange={(e) => patch({ initial_lives: +e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>)}
            <label>{t('lobby.locale')}<br />
              <select value={snap.question_locale} onChange={(e) => patch({ question_locale: e.target.value })}><option value="id">Indonesia</option><option value="en">English</option></select></label>
            <label><input type="checkbox" checked={snap.join_locked} onChange={(e) => patch({ join_locked: e.target.checked })} /> {t('lobby.lock')}</label>
            <button className="btn" type="button" onClick={start} disabled={busy}>{busy ? t('party.busy') : t('lobby.start')}</button>
          </div>
        ) : (
          <>
            <p>{t('lobby.summary', { rounds: snap.total_rounds, sec: snap.round_duration_sec, lives })}</p>
            <p className="muted" role="status">{t('lobby.waitHost')}</p>
          </>
        )}
        <p className="hint err" role="alert">{err}</p>
        <button className="btn secondary" type="button" onClick={leave}>{t('lobby.leave')}</button>
      </section>
    </div>
  );
}

function Arena({ snap, now, refresh }: { snap: Snap; now: () => number; refresh: () => void }) {
  const { t } = useI18n();
  const total = snap.round_duration_sec * 1000;
  const [ms, setMs] = useState(total);
  const [text, setText] = useState('');
  const [hint, setHint] = useState('');
  const [shake, setShake] = useState(0);
  const [confirm, setConfirm] = useState<{ id: string; term: string } | null>(null);
  const [locked, setLocked] = useState(snap.my_locked);
  const input = useRef<HTMLInputElement>(null);
  const sec = Math.ceil(ms / 1000);
  const done = locked || snap.my_locked;
  const answered = snap.players.filter((p) => p.locked).length;
  const active = snap.players.filter((p) => !p.eliminated).length;

  useEffect(() => { setLocked(snap.my_locked); setText(''); setHint(''); setConfirm(null); }, [snap.round, snap.my_locked]);
  useEffect(() => {
    let raf = 0;
    const loop = () => { setMs(Math.max(0, Date.parse(snap.deadline!) - now())); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [snap.deadline, now]);
  useEffect(() => { if (!done && !snap.eliminated) input.current?.focus(); }, [snap.round, done, snap.eliminated]);

  const apply = (r: { status: string; confirm_id?: string; term?: string }) => {
    if (r.status === 'locked' || r.status === 'already_locked') { setLocked(true); setConfirm(null); refresh(); }
    else if (r.status === 'needs_confirm') setConfirm({ id: r.confirm_id!, term: r.term! });
    else if (r.status === 'invalid') { setHint(t('play.invalid')); setShake((n) => n + 1); input.current?.select(); }
    else if (r.status === 'rate_limited') setHint(t('play.rate'));
    else if (r.status === 'closed') refresh();
  };
  const submit = async () => {
    if (!text.trim() || done || confirm || snap.eliminated) return;
    apply(await rpc('room_submit', { p_room: snap.room_id, p_text: text }).catch(() => ({ status: 'closed' })));
  };
  const answerConfirm = async (yes: boolean) => {
    const c = confirm; setConfirm(null);
    if (c) apply(await rpc('room_confirm', { p_room: snap.room_id, p_confirm: c.id, p_yes: yes }).catch(() => ({ status: 'closed' })));
  };

  return (
    <div className="arena">
      <section>
        <div className="row"><p className="muted">{t('play.round', { n: snap.round, total: snap.total_rounds })}</p>
          <p className="muted" role="status">{t('game.answered', { n: answered, total: active })}</p></div>
        <div className="timer">
          <div className={`bar${sec <= 5 ? ' low' : ''}`} role="timer" aria-label={t('play.secondsLeft', { n: sec })}><i style={{ transform: `scaleX(${ms / total})` }} /></div>
          <div className="numeral">{sec}</div>
        </div>
        <h1 className="prompt">{snap.prompt}</h1>
        {snap.eliminated ? <p className="plate" role="status">{t('game.spectator')}</p> : (
          <>
            <label htmlFor="ans" className="muted">{t('play.answer')}</label>
            <div className="field">
              <input ref={input} id="ans" key={shake} data-state={shake ? 'invalid' : undefined} value={text} readOnly={done} autoComplete="off" autoCapitalize="none" enterKeyHint="send"
                placeholder={t('play.placeholder')} onChange={(e) => { setText(e.target.value); setHint(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
              <button className={`btn${sec <= 5 && !done ? ' urgent' : ''}`} type="button" onClick={submit} disabled={done || !!confirm}>{t('play.send')}</button>
            </div>
            <div className={`hint${hint ? ' err' : ''}`} role="status">{done ? t('game.locked') : hint ? `✕ ${hint}` : ''}</div>
            {confirm && (
              <div className="row" style={{ justifyContent: 'flex-start' }}>
                <span>{t('play.confirm', { term: confirm.term })}</span>
                <button className="btn" type="button" onClick={() => answerConfirm(true)}>{t('play.yes')}</button>
                <button className="btn secondary" type="button" onClick={() => answerConfirm(false)}>{t('play.no')}</button>
              </div>)}
          </>
        )}
      </section>
      <aside className="plate"><h2 style={{ fontSize: 28, marginBottom: 8 }}>{t('game.leaderboard')}</h2><Board players={snap.players} lives={{ on: snap.lives_enabled, max: snap.initial_lives }} /></aside>
    </div>
  );
}

function Reveal({ snap, refresh }: { snap: Snap; refresh: () => void }) {
  const { t } = useI18n();
  const skip = async () => { await rpc('room_skip', { p_room: snap.room_id, p_seq: snap.phase_seq }).catch(() => {}); refresh(); };
  return (
    <div className="arena">
      <section>
        <p className="muted">{t('play.round', { n: snap.round, total: snap.total_rounds })}</p>
        <h1 className="prompt">{snap.prompt}</h1>
        {snap.phase === 'reveal' ? (
          <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }} aria-label={t('game.reveal', { n: snap.round })}>
            {snap.reveal.map((r, i) => (
              <li key={r.player_id} className="plate" style={{ animation: 'stamp 220ms var(--spring) both', animationDelay: `${i * 60}ms` }}>
                <div className="row"><strong>{r.nickname}</strong>
                  {r.tier ? <TierPlate tier={r.tier} reveal /> : <span className="muted">{t('game.noAnswer')}</span>}</div>
                <p style={{ margin: '4px 0 0' }}>{r.answer ?? ''} {r.tier ? <strong>{t('play.points', { n: r.points })}</strong> : ''} {r.life_lost ? <span className="muted"> · {t('game.lifeLost')}</span> : ''}</p>
              </li>
            ))}
          </ol>
        ) : (<Board players={snap.players} lives={{ on: snap.lives_enabled, max: snap.initial_lives }} />)}
        {snap.is_host && <p><button className="btn secondary" type="button" onClick={skip}>{t('game.skip')}</button></p>}
      </section>
      <aside className="plate"><h2 style={{ fontSize: 28, marginBottom: 8 }}>{t('game.leaderboard')}</h2><Board players={snap.players} lives={{ on: snap.lives_enabled, max: snap.initial_lives }} /></aside>
    </div>
  );
}

function Final({ snap }: { snap: Snap }) {
  const { t } = useI18n();
  const router = useRouter();
  const ranked = [...snap.players].sort((a, b) => (a.final_rank ?? 99) - (b.final_rank ?? 99));
  return (
    <section>
      <h1 className="display" style={{ fontSize: 'var(--text-display)' }}>{t('game.final')}</h1>
      <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
        {ranked.map((p) => (
          <li key={p.id} className="plate row"><span><span className="num" style={{ marginRight: 8 }}>{p.final_rank ?? '-'}</span>{p.nickname}{p.me ? ` (${t('lobby.you')})` : ''}{p.eliminated ? ` · ${t('game.eliminated')}` : ''}</span>
            <strong className="num">{t('game.points', { n: p.score })}</strong></li>))}
      </ol>
      <button className="btn" type="button" onClick={() => router.push('/mabar')}>{t('game.again')}</button>
    </section>
  );
}
