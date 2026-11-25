import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let client: SupabaseClient | null = null;

export const hasSupabase = () => Boolean(url && key);

export function supabase(): SupabaseClient {
  if (!url || !key) throw new Error('config');
  client ??= createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true }, realtime: { params: { eventsPerSecond: 5 } } });
  return client;
}

/** Token anonim perangkat: uid stabil tanpa akun. Aktifkan "Anonymous sign-ins" di Supabase Auth. */
export async function ensureSession() {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session;
  const { data: d, error } = await sb.auth.signInAnonymously();
  if (error || !d.session) throw error ?? new Error('auth');
  return d.session;
}
