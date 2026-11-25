import { buildQuestion, type RawQuestion } from '@/engine/bank';
import data from '@/data/questions-id.json';

/** Sumber tunggal bank ID: src/data/questions-id.json (juga dipakai scripts/gen-seed.mjs untuk database). */
export const BANK_ID = (data.questions as RawQuestion[]).map((r) => buildQuestion(r, 'id'));
