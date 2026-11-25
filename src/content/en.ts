import { buildQuestion, type RawQuestion } from '@/engine/bank';
import data from '@/data/questions-en.json';

/** Single source for the EN bank: src/data/questions-en.json (also read by scripts/gen-seed.mjs). */
export const BANK_EN = (data.questions as RawQuestion[]).map((r) => buildQuestion(r, 'en'));
