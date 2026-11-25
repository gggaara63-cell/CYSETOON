import { normalize, type Locale } from './normalize';

export interface Term { norm: string; answerId: number; canonical: boolean; text: string }
export type Verdict =
  | { status: 'accepted'; answerId: number }
  | { status: 'needs_confirm'; answerId: number; term: string }
  | { status: 'invalid' };

/** Jarak Damerau (OSA): tukar huruf bersebelahan = 1. */
export function osa(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
export const typoLimit = (len: number) => (len <= 4 ? 0 : len <= 8 ? 1 : 2);

/**
 * Alur validasi (architecture.md). Fuzzy: 0 kandidat = invalid; >1 jawaban berbeda pada jarak minimal =
 * invalid TANPA saran; 1 jawaban lewat istilah kanonik = accepted; lewat alias = needs_confirm.
 */
export function validate(terms: Term[], raw: string, locale: Locale): Verdict {
  const q = normalize(raw, locale);
  if (!q) return { status: 'invalid' };
  const exact = terms.find((t) => t.norm === q);
  if (exact) return { status: 'accepted', answerId: exact.answerId };
  const lim = typoLimit(q.length);
  if (lim === 0) return { status: 'invalid' };
  let best = lim + 1;
  let hits: Term[] = [];
  for (const t of terms) {
    const d = osa(q, t.norm, lim);
    if (d > lim) continue;
    if (d < best) { best = d; hits = [t]; } else if (d === best) hits.push(t);
  }
  if (!hits.length) return { status: 'invalid' };
  if (new Set(hits.map((h) => h.answerId)).size > 1) return { status: 'invalid' };
  const canon = hits.find((h) => h.canonical);
  if (canon) return { status: 'accepted', answerId: canon.answerId };
  return { status: 'needs_confirm', answerId: hits[0].answerId, term: hits[0].text };
}
