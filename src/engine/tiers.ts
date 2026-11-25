export type Tier = 1 | 2 | 3 | 4 | 5 | 6;
export const TIERS: Record<Tier, { key: string; points: number; meters: number }> = {
  1: { key: 'foothills', points: 10, meters: 100 },
  2: { key: 'shortcut', points: 15, meters: 150 },
  3: { key: 'slope', points: 30, meters: 300 },
  4: { key: 'ridge', points: 60, meters: 600 },
  5: { key: 'crag', points: 85, meters: 850 },
  6: { key: 'summit', points: 100, meters: 1000 },
};
/** Ambang awal dari familiarity (tebakan, kalibrasi nanti). Tier 2 dan 6 bisa di-override editorial. */
export function tierFor(familiarity: number, override?: Tier): Tier {
  if (override) return override;
  if (familiarity >= 0.8) return 1;
  if (familiarity >= 0.5) return 3;
  if (familiarity >= 0.25) return 4;
  if (familiarity >= 0.1) return 5;
  return 6;
}
