export type Locale = 'id' | 'en';
const ARTICLES: Record<Locale, string[]> = { id: ['sang', 'si'], en: ['the', 'an', 'a'] };

/** Padanan TS dari normalize_text() di schema.sql. Ubah keduanya bersama dan naikkan norm_version. */
export function normalize(raw: string, locale: Locale): string {
  let t = raw.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  t = t.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  for (const a of ARTICLES[locale]) {
    if (t.startsWith(a + ' ')) { t = t.slice(a.length + 1); break; }
  }
  return t;
}
