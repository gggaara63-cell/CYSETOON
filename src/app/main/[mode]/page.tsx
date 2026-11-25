'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { Oxygen, Profile, TierPlate, shareText } from '@/components/ui';
import { Solo, ROUND_MS, MAX_LIVES, type Mode, type Round } from '@/engine/solo';
import { bankFor, dailySet, playDate, saveDaily } from '@/lib/daily';
import type { Question } from '@/engine/bank';

type Phase = 'question' | 'feedback' | 'end';

export default function Arena() {
  const { mode: m } = useParams<{ mode: string }>();
  const mode: Mode = m === 'endless' ? 'endless' : 'daily';
  const { t, locale } = useI18n();
  const game = useRef<Solo | null>(null);
  const date = useRef('');
  const [q, setQ] = useState<Question | null>(null);
  const [phase, setPhase] = useState<Phase>('question');
  const [text, setText] = useState('');
  const [hint, setHint] = useState<{ kind: 'err' | 'ok'; msg: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [last, setLast] = useState<Round | null>(null);
  const [shake, setShake] = useState(0);
  const [ms, setMs] = useState(ROUND_MS);
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const sec = Math.ceil(ms / 1000);

  const start = useCallback(() => {
    date.current = playDate(locale);
    game.current = new Solo(mode, mode === 'daily' ? dailySet(locale, date.current) : bankFor(locale));
    setPhase('question'); setLast(null); advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, mode]);
  const advance = () => {
    const g = game.current!;
    const nq = g.next();
    if (!nq) return finish();
    setQ(nq); setText(''); setHint(null); setConfirm(null); setLast(null); setPhase('question'); setMs(ROUND_MS);
    setTimeout(() => input.current?.focus(), 0);
  };
  const finish = () => {
    const g = game.current!;
    if (g.mode === 'daily') saveDaily(locale, date.current, { score: g.score, rounds: g.rounds });
    setPhase('end'); force((n) => n + 1);
  };
  const after = (r: Round) => { setLast(r); setPhase('feedback'); setConfirm(null); force((n) => n + 1); };

  useEffect(() => { start(); }, [start]);

  // Hitung mundur digambar dari tenggat; ronde kedaluwarsa ditutup sebagai timeout.
  useEffect(() => {
    if (phase !== 'question') return;
    let raf = 0;
    const loop = () => {
      const g = game.current;
      if (g) {
        setMs(g.remainingMs());
        const r = g.settle();
        if (r) return after(r);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'feedback' && e.key === 'Enter') { e.preventDefault(); next(); }
      if (confirm && e.key === 'Escape') answerConfirm(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const next = () => { const g = game.current!; if (g.finished) finish(); else advance(); };
  const submit = () => {
    const g = game.current;
    if (!g || !text.trim() || phase !== 'question' || confirm) return;
    const r = g.submit(text);
    if (r.kind === 'locked') return after(r.round);
    if (r.kind === 'timeout') { const s = g.rounds[g.rounds.length - 1]; return s ? after(s) : undefined; }
    if (r.kind === 'needs_confirm') { setConfirm(r.term); setHint(null); return; }
    setHint({ kind: 'err', msg: t(r.kind === 'rate_limited' ? 'play.rate' : 'play.invalid') });
    if (r.kind === 'invalid') { setShake((n) => n + 1); input.current?.select(); }
  };
  const answerConfirm = (yes: boolean) => {
    const r = game.current!.confirm(yes);
    if (r.kind === 'locked') return after(r.round);
    setConfirm(null);
    if (r.kind === 'timeout') { const s = game.current!.rounds.at(-1); return s ? after(s) : undefined; }
    setHint({ kind: 'err', msg: t('play.invalid') }); input.current?.focus();
  };

  const g = game.current;
  if (!g || (!q && phase !== 'end')) return <main className="wrap" role="status">{t('play.loading')}</main>;

  if (phase === 'end') {
    const total = g.rounds.reduce((a, r) => a + r.meters, 0);
    const head = t(mode === 'daily' ? 'share.daily' : 'share.endless', { date: date.current, lang: locale.toUpperCase() });
    const share = shareText(head, g.rounds, t('share.line', { score: g.score, meters: total.toLocaleString() }));
    return (
      <main className="wrap">
        <h1 className="display" style={{ fontSize: 'var(--text-display)' }}>{t(mode === 'daily' ? 'end.title.daily' : 'end.title.endless')}</h1>
        <p>{t('end.summary', { n: g.rounds.length, score: g.score })}</p>
        <section className="plate big" aria-label={t('end.profile')}><Profile rounds={g.rounds} /></section>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-start' }}>
          <button className="btn secondary" type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(share); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
          }}>{t('end.copy')}</button>
          <span role="status" className="muted">{copied ? t('end.copied') : ''}</span>
          {mode === 'endless' && <button className="btn" type="button" onClick={start}>{t('end.again')}</button>}
          <Link className="btn secondary" href="/">{t('end.home')}</Link>
        </div>
      </main>
    );
  }

  const label = mode === 'daily'
    ? t('play.round', { n: Math.min(g.rounds.length + (phase === 'question' ? 1 : 0), g.total ?? 0), total: g.total ?? 0 })
    : t('play.roundEndless', { n: g.rounds.length + (phase === 'question' ? 1 : 0) });
  const lastIdx = g.rounds.length - 1;

  return (
    <main className="wrap">
      <div className="row">
        <Link href="/" className="muted">{t('play.exit')}</Link>
        <span className="row" style={{ gap: 16 }}>
          {g.lives !== null && <Oxygen n={g.lives} max={MAX_LIVES} />}
          <strong className="num" aria-live="polite">{t('play.score', { n: g.score })}</strong>
        </span>
      </div>
      <div className="arena">
        <section aria-live="off">
          <p className="muted">{label} · {q!.category}</p>
          <div className={`timer`}>
            <div className={`bar${sec <= 5 ? ' low' : ''}`} role="timer" aria-label={t('play.secondsLeft', { n: sec })}>
              <i style={{ transform: `scaleX(${ms / ROUND_MS})` }} />
            </div>
            <div className="numeral">{sec}</div>
          </div>
          <p className="sr" role="status">{sec === 10 || sec === 5 ? t('play.secondsLeft', { n: sec }) : ''}</p>
          <h1 className="prompt">{q!.prompt}</h1>
          <label htmlFor="ans" className="muted">{t('play.answer')}</label>
          <div className="field">
            <input ref={input} id="ans" key={shake} data-state={shake ? 'invalid' : undefined} value={text} autoComplete="off" autoCapitalize="none"
              enterKeyHint="send" placeholder={t('play.placeholder')} readOnly={phase !== 'question'}
              onChange={(e) => { setText(e.target.value); setHint(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
            <button className={`btn${sec <= 5 && phase === 'question' ? ' urgent' : ''}`} type="button" onClick={submit} disabled={phase !== 'question' || !!confirm}>{t('play.send')}</button>
          </div>
          <div className={`hint${hint?.kind === 'err' ? ' err' : ''}`} role="status">
            {hint && (<span>{hint.kind === 'err' ? '✕ ' : ''}{hint.msg}</span>)}
          </div>
          {confirm && (
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <span>{t('play.confirm', { term: confirm })}</span>
              <button className="btn" type="button" onClick={() => answerConfirm(true)}>{t('play.yes')}</button>
              <button className="btn secondary" type="button" onClick={() => answerConfirm(false)}>{t('play.no')}</button>
            </div>
          )}
          {phase === 'feedback' && last && (
            <div className="plate" role="status" style={{ marginTop: 12 }}>
              {last.status === 'locked' && last.tier ? (
                <>
                  <TierPlate tier={last.tier} reveal />
                  <p style={{ margin: '8px 0 0' }}><strong>{t('play.points', { n: last.points })}</strong> · {t(`tier.${last.tier}.line`)}</p>
                  <p className="muted" style={{ margin: 0 }}>{t('play.counted', { answer: last.answer ?? '' })}</p>
                </>
              ) : (<p style={{ margin: 0 }}>{t('play.timeout')}</p>)}
              <p style={{ margin: '12px 0 0' }}>
                <button className="btn" type="button" autoFocus onClick={next}>{t('play.next')}</button>
              </p>
            </div>
          )}
        </section>
        <aside className="plate" aria-label={t('end.profile')}><Profile rounds={g.rounds.slice(0, lastIdx + 1)} /></aside>
      </div>
    </main>
  );
}
