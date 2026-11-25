import type { Locale } from '@/engine/normalize';
import type { Round } from '@/engine/solo';
import { BANK_ID } from '@/content/id';
import { BANK_EN } from '@/content/en';
import { BRAND } from '@/config/brand';

export const RESET_TZ: Record<Locale, string> = { id: 'Asia/Jakarta', en: 'UTC' };   // = locales.reset_tz
export const bankFor = (l: Locale) => (l === 'id' ? BANK_ID : BANK_EN);

function parts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
}
export const playDate = (l: Locale) => { const p = parts(RESET_TZ[l]); return `${p.year}-${p.month}-${p.day}`; };
export function msToReset(l: Locale): number {
  const p = parts(RESET_TZ[l]);
  return (86400 - (+p.hour * 3600 + +p.minute * 60 + +p.second)) * 1000;
}
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
/** Set harian deterministik per (bahasa, tanggal): sama untuk semua pemain. Padanan daily_sets di database. */
export function dailySet(l: Locale, date: string) {
  return [...bankFor(l)].sort((a, b) => hash(date + a.slug) - hash(date + b.slug)).slice(0, 7);
}

const k = (l: Locale, d: string) => `${BRAND.slug}:daily:${l}:${d}`;
export interface DailyResult { score: number; rounds: Round[] }
export function loadDaily(l: Locale): DailyResult | null {
  try { const v = localStorage.getItem(k(l, playDate(l))); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function saveDaily(l: Locale, date: string, r: DailyResult) {
  try { localStorage.setItem(k(l, date), JSON.stringify(r)); } catch {}
}
