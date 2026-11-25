// Membuat supabase/seed.sql dari src/data/questions-*.json. Jalankan: npm run seed:gen
// UUID deterministik (md5), jadi seed bisa dijalankan ulang tanpa duplikat.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const uuid = (s) => { const h = createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
// Salinan ambang src/engine/tiers.ts (tierFor). Ubah keduanya bersama.
const tierFor = (f) => (f >= 0.8 ? 1 : f >= 0.5 ? 3 : f >= 0.25 ? 4 : f >= 0.1 ? 5 : 6);

const out = ['-- GENERATED oleh scripts/gen-seed.mjs. Jangan edit tangan.', 'begin;'];
for (const loc of ['id', 'en']) {
  const d = JSON.parse(readFileSync(`src/data/questions-${loc}.json`, 'utf8'));
  d.categories.forEach((c, i) => out.push(`insert into public.categories (id, locale, slug, name, sort) values (${q(uuid(`c:${loc}:${c.slug}`))}, ${q(loc)}, ${q(c.slug)}, ${q(c.name)}, ${i}) on conflict do nothing;`));
  for (const qu of d.questions) {
    const qid = uuid(`q:${loc}:${qu.slug}`);
    out.push(`insert into public.questions (id, locale, category_id, slug, prompt, status, published_at, answer_count) values (${q(qid)}, ${q(loc)}, ${q(uuid(`c:${loc}:${qu.category}`))}, ${q(qu.slug)}, ${q(qu.prompt)}, 'live', now(), ${qu.a.length}) on conflict do nothing;`);
    qu.a.forEach((line, i) => {
      const [canon, al = '', fam = '0', ov = ''] = line.split('|');
      const aid = uuid(`a:${qid}:${i}`);
      const reason = ov === '2' ? 'too_clever' : ov === '6' ? 'gem' : ov ? 'manual' : null;
      out.push(`insert into public.answers (id, question_id, canonical, familiarity, tier_computed, tier_override, override_reason) values (${q(aid)}, ${q(qid)}, ${q(canon)}, ${parseFloat(fam)}, ${tierFor(parseFloat(fam))}, ${ov ? Number(ov) : 'null'}, ${reason ? q(reason) : 'null'}) on conflict do nothing;`);
      [[canon, 'canonical'], ...al.split(';').filter(Boolean).map((t) => [t, 'alias'])].forEach(([t, k], j) =>
        out.push(`insert into public.answer_terms (id, question_id, answer_id, term, kind) values (${q(uuid(`t:${aid}:${j}`))}, ${q(qid)}, ${q(aid)}, ${q(t)}, ${q(k)}) on conflict do nothing;`));
    });
  }
}
// Daftar AWAL filter nickname (perlu ditinjau manusia sebelum rilis publik).
const blocked = [['id', 'severe', ['kontol', 'memek', 'ngentot', 'jancok']], ['id', 'mild', ['anjing', 'babi', 'bangsat', 'tolol', 'goblok', 'bego']],
  ['en', 'severe', ['fuck', 'cunt', 'nigger', 'faggot']], ['en', 'mild', ['shit', 'bitch', 'asshole', 'dick', 'slut', 'whore']]];
for (const [l, s, terms] of blocked) for (const t of terms) out.push(`insert into public.blocked_terms (locale, term, severity) values (${q(l)}, ${q(t)}, ${q(s)}) on conflict do nothing;`);
out.push('commit;');
writeFileSync('supabase/seed.sql', out.join('\n') + '\n');
console.log(`seed.sql: ${out.length} baris`);
