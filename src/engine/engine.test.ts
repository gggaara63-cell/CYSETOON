import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize';
import { osa, validate } from './match';
import { buildQuestion } from './bank';
import { Solo, ROUND_MS } from './solo';

const q = buildQuestion({ slug: 't', category: 'x', prompt: 'Sebutkan hidangan berkuah',
  a: ['Soto|soto ayam|0.9', 'Bakso|baso|0.9', 'Rawon||0.8', 'Sayur asem|sayur asam|0.6', 'Coto Makassar|coto|0.3', 'Pallubasa|palubasa|0.05|6', 'Gulai||0.5|2'] }, 'id');

test('normalisasi: diakritik, tanda baca, artikel', () => {
  assert.equal(normalize('  Sang  Saka!! ', 'id'), 'saka');
  assert.equal(normalize('The Café', 'en'), 'cafe');
});
test('osa: tukar huruf = 1', () => assert.equal(osa('rwaon', 'rawon', 2), 1));
test('exact, alias, typo kanonik langsung diterima', () => {
  assert.equal(validate(q.terms, 'soto', 'id').status, 'accepted');
  assert.equal(validate(q.terms, 'SOTO AYAM', 'id').status, 'accepted');
  assert.equal(validate(q.terms, 'rwaon', 'id').status, 'accepted');
});
test('typo pada alias meminta konfirmasi', () => assert.equal(validate(q.terms, 'palubsa', 'id').status, 'needs_confirm'));
test('kata pendek tidak ditoleransi typo; ngawur ditolak', () => {
  assert.equal(validate(q.terms, 'sot', 'id').status, 'invalid');
  assert.equal(validate(q.terms, 'pizza', 'id').status, 'invalid');
});
test('jawaban valid pertama mengunci dan salah gratis', () => {
  let t = 0;
  const g = new Solo('endless', [q], () => t);
  g.next();
  t += 500; assert.equal(g.submit('pizza').kind, 'invalid');
  t += 500; assert.equal(g.submit('rawon').kind, 'locked');
  t += 500; assert.equal(g.submit('soto').kind, 'already_locked');
  assert.equal(g.score, 30); assert.equal(g.lives, 3);
});
test('waktu habis = nol poin dan -1 nyawa; tier puncak +1 nyawa dibatasi 3', () => {
  let t = 0;
  const g = new Solo('endless', [q], () => t);
  g.next(); t += ROUND_MS + 1; assert.equal(g.submit('soto').kind, 'timeout'); assert.equal(g.lives, 2);
  g.next(); t += 500; g.submit('pallubasa'); assert.equal(g.lives, 3);
  g.next(); t += 500; g.submit('pallubasa'); assert.equal(g.lives, 3);
});
