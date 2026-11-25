import { validate } from './match';
import type { Question } from './bank';
import { TIERS, type Tier } from './tiers';

export const ROUND_MS = 25_000;      // dikunci untuk Solo
export const GRACE_MS = 300;
export const ATTEMPT_CAP = 40;
export const MIN_GAP_MS = 400;
export const MAX_LIVES = 3;
export const DAILY_ROUNDS = 7;

export type Mode = 'daily' | 'endless';
export interface Round { slug: string; status: 'locked' | 'timeout'; tier?: Tier; points: number; meters: number; text?: string; answer?: string; ms?: number }
export type SubmitResult =
  | { kind: 'locked'; round: Round }
  | { kind: 'invalid' | 'timeout' | 'already_locked' | 'rate_limited' }
  | { kind: 'needs_confirm'; term: string };

interface Current { q: Question; shownAt: number; deadline: number; attempts: number; lastAt: number; locked: boolean; pending?: { answerId: number; text: string } }

/**
 * Mesin Solo murni (tanpa React); waktu disuntik lewat `now` agar bisa diuji.
 * Slice 1: otoritas waktu ada di klien. Di backend tiap metode menjadi RPC dengan aturan yang sama.
 */
export class Solo {
  rounds: Round[] = [];
  lives: number | null;
  score = 0;
  finished = false;
  current: Current | null = null;
  private queue: Question[];
  constructor(public mode: Mode, private pool: Question[], private now: () => number = Date.now, private rnd: () => number = Math.random) {
    this.lives = mode === 'endless' ? MAX_LIVES : null;
    this.queue = mode === 'daily' ? pool.slice(0, DAILY_ROUNDS) : [];
  }
  get total(): number | null { return this.mode === 'daily' ? this.queue.length : null; }

  next(): Question | null {
    this.settle();
    if (this.finished) return null;
    let q: Question;
    if (this.mode === 'daily') {
      if (this.rounds.length >= this.queue.length) { this.finished = true; return null; }
      q = this.queue[this.rounds.length];
    } else {
      if (!this.queue.length) this.queue = [...this.pool].sort(() => this.rnd() - 0.5);
      q = this.queue.pop()!;
    }
    const t = this.now();
    this.current = { q, shownAt: t, deadline: t + ROUND_MS, attempts: 0, lastAt: 0, locked: false };
    return q;
  }
  remainingMs() { return this.current ? Math.max(0, this.current.deadline - this.now()) : 0; }

  /** Menutup ronde yang waktunya habis tanpa jawaban valid. */
  settle(): Round | null {
    const c = this.current;
    if (!c || c.locked || this.now() < c.deadline) return null;
    return this.close({ slug: c.q.slug, status: 'timeout', points: 0, meters: 0 });
  }
  private close(r: Round): Round {
    this.current!.locked = true;
    this.rounds.push(r);
    this.score += r.points;
    if (this.lives !== null) {
      if (r.status === 'timeout') this.lives -= 1;
      else if (r.tier === 6) this.lives = Math.min(MAX_LIVES, this.lives + 1);
      if (this.lives <= 0) this.finished = true;
    }
    if (this.mode === 'daily' && this.rounds.length >= this.queue.length) this.finished = true;
    return r;
  }

  submit(text: string): SubmitResult {
    const c = this.current;
    if (!c) return { kind: 'timeout' };
    if (c.locked) return { kind: 'already_locked' };            // jawaban valid pertama mengunci
    const t = this.now();
    if (t > c.deadline + GRACE_MS) { this.settle(); return { kind: 'timeout' }; }
    if (c.attempts >= ATTEMPT_CAP || t - c.lastAt < MIN_GAP_MS) return { kind: 'rate_limited' };
    c.attempts += 1; c.lastAt = t;
    const v = validate(c.q.terms, text, c.q.locale);
    if (v.status === 'invalid') return { kind: 'invalid' };      // gratis: tanpa pengurangan apa pun
    if (v.status === 'needs_confirm') { c.pending = { answerId: v.answerId, text }; return { kind: 'needs_confirm', term: v.term }; }
    return { kind: 'locked', round: this.lock(v.answerId, text) };
  }
  confirm(yes: boolean): SubmitResult {
    const c = this.current;
    if (!c || c.locked || !c.pending) return { kind: 'invalid' };
    const p = c.pending; c.pending = undefined;
    if (!yes) return { kind: 'invalid' };
    if (this.now() > c.deadline + GRACE_MS) { this.settle(); return { kind: 'timeout' }; }
    return { kind: 'locked', round: this.lock(p.answerId, p.text) };
  }
  private lock(answerId: number, text: string): Round {
    const c = this.current!;
    const a = c.q.answers[answerId];
    const tr = TIERS[a.tier];
    return this.close({ slug: c.q.slug, status: 'locked', tier: a.tier, points: tr.points, meters: tr.meters, text, answer: a.canonical, ms: this.now() - c.shownAt });
  }
}
