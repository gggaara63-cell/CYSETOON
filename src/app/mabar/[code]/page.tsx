'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { Room } from '@/components/Room';
import { hasSupabase } from '@/lib/supabase';
import { rpc } from '@/lib/party';

export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const { t } = useI18n();
  const [roomId, setRoomId] = useState<string | null | undefined>(undefined);   // undefined = memuat, null = belum bergabung
  const [nick, setNick] = useState('');
  const [err, setErr] = useState('');
  const resolve = useCallback(async () => {
    const r = await rpc<{ room_id?: string; code?: string }>('room_my_active').catch(() => ({} as { room_id?: string; code?: string }));
    setRoomId(r.room_id && r.code === code ? r.room_id : null);
  }, [code]);
  useEffect(() => { if (hasSupabase()) { try { setNick(localStorage.getItem('party:nick') ?? ''); } catch {} resolve(); } }, [resolve]);

  if (!hasSupabase()) return <main className="wrap"><p className="plate" role="alert">{t('party.err.config')}</p></main>;
  if (roomId === undefined) return <main className="wrap" role="status">{t('play.loading')}</main>;
  if (roomId) return <Room roomId={roomId} />;
  const join = async () => {
    setErr('');
    const r = await rpc<{ error?: string }>('room_join', { p_code: code, p_nick: nick }).catch(() => ({ error: 'generic' }));
    if (r.error) setErr(t(`party.err.${r.error}`)); else resolve();
  };
  return (
    <main className="wrap">
      <section className="plate big" style={{ maxWidth: 480 }}>
        <h1 className="display" style={{ fontSize: 'var(--text-display)' }}>{t('party.join')} {code}</h1>
        <label htmlFor="nick">{t('party.nick')}</label>
        <div className="field"><input id="nick" value={nick} maxLength={16} onChange={(e) => setNick(e.target.value)} /></div>
        <p className="hint err" role="alert">{err}</p>
        <button className="btn" type="button" disabled={nick.trim().length < 2} onClick={join}>{t('party.join')}</button>
      </section>
      <p><Link href="/mabar" className="muted">{t('party.back')}</Link></p>
    </main>
  );
}
