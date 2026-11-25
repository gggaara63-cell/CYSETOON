'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureSession, supabase } from './supabase';

export interface Player { id: string; nickname: string; is_host: boolean; connected: boolean; score: number; meters: number; lives: number | null; eliminated: boolean; locked: boolean; final_rank: number | null; me: boolean }
export interface RevealRow { player_id: string; nickname: string; text: string | null; answer: string | null; tier: 1 | 2 | 3 | 4 | 5 | 6 | null; points: number; meters: number; rank: number | null; life_lost: boolean; outcome: 'valid' | 'timeout' }
export interface Snap {
  server_now: string; room_id: string; code: string; phase: 'lobby' | 'starting' | 'answering' | 'reveal' | 'leaderboard' | 'finished' | 'closed'; phase_seq: number;
  round: number; total_rounds: number; round_duration_sec: number; lives_enabled: boolean; initial_lives: number; question_locale: 'id' | 'en'; join_locked: boolean; max_players: number;
  deadline: string | null; prompt: string | null; me: string; is_host: boolean; eliminated: boolean; my_locked: boolean; players: Player[]; reveal: RevealRow[]; error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  await ensureSession();
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** Snapshot room + langganan realtime + detak jantung + penjadwal pemajuan fase (dipanggil semua klien, CAS di server). */
export function useRoom(roomId: string) {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);
  const offset = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(async () => {
    try {
      const s = await rpc<Snap>('room_get_state', { p_room: roomId });
      if (s.error) { setFailed(true); return; }
      offset.current = Date.parse(s.server_now) - Date.now();
      setFailed(false); setSnap(s);
    } catch { setFailed(true); }
  }, [roomId]);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(refresh, 120); }, [refresh]);

  useEffect(() => {
    refresh();
    let ch: ReturnType<ReturnType<typeof supabase>['channel']> | null = null;
    ensureSession().then(() => {
      const sb = supabase();
      ch = sb.channel(`room:${roomId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, soon)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, soon)
        .subscribe((st) => setLive(st === 'SUBSCRIBED'));
    });
    const poll = setInterval(refresh, 5000);                          // jaring pengaman bila kanal putus
    const beat = setInterval(() => rpc('room_heartbeat', { p_room: roomId }).catch(() => {}), 15000);
    rpc('room_heartbeat', { p_room: roomId }).catch(() => {});
    const vis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', refresh);
    return () => { clearInterval(poll); clearInterval(beat); clearTimeout(timer.current); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', refresh); if (ch) supabase().removeChannel(ch); };
  }, [roomId, refresh, soon]);

  // Setiap klien menjadwalkan room_advance pada tenggat + jitter; server memakai CAS (phase_seq), sisanya no-op.
  useEffect(() => {
    if (!snap?.deadline || !['starting', 'answering', 'reveal', 'leaderboard'].includes(snap.phase)) return;
    const wait = Date.parse(snap.deadline) - (Date.now() + offset.current) + (snap.phase === 'answering' ? 350 : 50) + Math.random() * 400;
    const h = setTimeout(() => { rpc('room_advance', { p_room: roomId, p_seq: snap.phase_seq }).then(refresh).catch(refresh); }, Math.max(0, wait));
    return () => clearTimeout(h);
  }, [snap?.phase_seq, snap?.deadline, snap?.phase, roomId, refresh]);

  const now = useCallback(() => Date.now() + offset.current, []);
  return { snap, live, failed, refresh, now };
}
