'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { LangToggle } from '@/components/ui';
import { hasSupabase } from '@/lib/supabase';
import { rpc } from '@/lib/party';

export default function Mabar() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [nick, setNick] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = hasSupabase();

  useEffect(() => {
    if (!ok) return;
    try { setNick(localStorage.getItem('party:nick') ?? ''); } catch {}
    rpc<{ code?: string }>('room_my_active').then((r) => { if (r.code) router.replace(`/mabar/${r.code}`); }).catch(() => {});
  }, [ok, router]);

  const go = async (fn: 'room_create' | 'room_join') => {
    setErr(''); setBusy(true);
    try { localStorage.setItem('party:nick', nick); } catch {}
    const r = await (fn === 'room_create'
      ? rpc<{ code?: string; error?: string }>('room_create', { p_nick: nick, p_config: { question_locale: locale } })
      : rpc<{ code?: string; error?: string }>('room_join', { p_code: code.trim(), p_nick: nick })).catch(() => ({ error: 'generic' } as { code?: string; error?: string }));
    setBusy(false);
    if (r.error || !r.code) setErr(t(`party.err.${r.error ?? 'generic'}`)); else router.push(`/mabar/${r.code}`);
  };

  return (
    <main className="wrap">
      <header className="row"><h1 className="display" style={{ fontSize: 'var(--text-display)' }}>{t('party.title')}</h1><LangToggle /></header>
      {!ok ? <p className="plate" role="alert">{t('party.err.config')}</p> : (
        <div className="home" style={{ marginTop: 16 }}>
          <section className="plate big">
            <label htmlFor="nick">{t('party.nick')}</label>
            <div className="field"><input id="nick" value={nick} maxLength={16} autoComplete="nickname" onChange={(e) => setNick(e.target.value)} aria-describedby="nick-h" /></div>
            <p id="nick-h" className="muted">{t('party.nick.hint')}</p>
            <button className="btn" type="button" disabled={busy || nick.trim().length < 2} onClick={() => go('room_create')}>{busy ? t('party.busy') : t('party.create')}</button>
          </section>
          <section className="plate">
            <label htmlFor="code">{t('party.code')}</label>
            <div className="field"><input id="code" value={code} inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="off"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-describedby="code-h" /></div>
            <p id="code-h" className="muted">{t('party.code.hint')}</p>
            <button className="btn secondary" type="button" disabled={busy || nick.trim().length < 2 || code.length < 4} onClick={() => go('room_join')}>{t('party.join')}</button>
          </section>
        </div>
      )}
      <p className="hint err" role="alert">{err}</p>
      <Link href="/" className="muted">{t('party.back')}</Link>
    </main>
  );
}
