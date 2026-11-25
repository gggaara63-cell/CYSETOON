import { normalize, type Locale } from './normalize';
import { tierFor, type Tier } from './tiers';
import type { Term } from './match';

/** Satu jawaban: "Kanonik|alias1;alias2|familiarity|override(opsional)". */
export interface RawQuestion { slug: string; category: string; prompt: string; a: string[] }
export interface Answer { id: number; canonical: string; tier: Tier }
export interface Question { slug: string; category: string; prompt: string; locale: Locale; answers: Answer[]; terms: Term[] }

export function buildQuestion(raw: RawQuestion, locale: Locale): Question {
  const answers: Answer[] = [];
  const terms: Term[] = [];
  const seen = new Map<string, number>();
  raw.a.forEach((line, id) => {
    const [canonical, aliases = '', fam = '0', ov = ''] = line.split('|');
    answers.push({ id, canonical, tier: tierFor(parseFloat(fam), ov ? (Number(ov) as Tier) : undefined) });
    const all = [{ text: canonical, canonical: true }, ...aliases.split(';').filter(Boolean).map((text) => ({ text, canonical: false }))];
    for (const t of all) {
      const norm = normalize(t.text, locale);
      if (!norm) throw new Error(`istilah kosong: ${raw.slug}/${t.text}`);
      if (seen.has(norm) && seen.get(norm) !== id) throw new Error(`istilah bentrok: ${raw.slug}/${norm}`);
      seen.set(norm, id);
      terms.push({ norm, answerId: id, canonical: t.canonical, text: t.text });
    }
  });
  return { slug: raw.slug, category: raw.category, prompt: raw.prompt, locale, answers, terms };
}
