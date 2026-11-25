'use client';
import { useI18n } from '@/i18n';
import { TIERS, type Tier } from '@/engine/tiers';
import type { Round } from '@/engine/solo';
import type { Locale } from '@/engine/normalize';

export function LangToggle() {
  const { locale, setLocale, t } = useI18n();
  const opts: Locale[] = ['id', 'en'];
  return (
    <div className="seg" role="radiogroup" aria-label={t('lang.label')}>
      {opts.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={locale === l} onClick={() => setLocale(l)}
          onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') setLocale(l === 'id' ? 'en' : 'id'); }}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function TierPlate({ tier, reveal }: { tier: Tier; reveal?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="tier" data-tier={tier} data-reveal={reveal ? '' : undefined}>
      <span>{tier}</span><span>{t(`tier.${tier}.name`)}</span>
      <span className="num">{TIERS[tier].meters.toLocaleString()} {t('unit.m')}</span>
    </span>
  );
}

export function Oxygen({ n, max }: { n: number; max: number }) {
  const { t } = useI18n();
  return (
    <span className="oxy" role="img" aria-label={t('play.oxygen', { n, max })}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < n ? '' : 'off'} />)}
    </span>
  );
}

/** Profil ketinggian: satu titik per soal, tinggi = tier. Tabel teks untuk pembaca layar. */
export function Profile({ rounds }: { rounds: Round[] }) {
  const { t } = useI18n();
  const W = 320, H = 140, pad = 16;
  const n = Math.max(rounds.length, 2);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (m: number) => H - pad - (m / 1000) * (H - 2 * pad);
  const pts = rounds.map((r, i) => `${x(i)},${y(r.meters)}`).join(' ');
  return (
    <>
      <svg className="profile" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {[100, 300, 600, 1000].map((m) => (
          <g key={m}><line x1={pad} x2={W - pad} y1={y(m)} y2={y(m)} stroke="var(--color-border)" strokeWidth="1" />
            <text x={pad} y={y(m) - 3} fontSize="9" fill="var(--color-text-muted)">{m.toLocaleString()}</text></g>
        ))}
        {rounds.length > 1 && <polyline points={pts} fill="none" stroke="var(--color-text)" strokeWidth="3" strokeLinejoin="round" />}
        {rounds.map((r, i) => (
          <circle key={i} cx={x(i)} cy={y(r.meters)} r="6" stroke="var(--color-text)" strokeWidth="2"
            fill={r.tier ? `var(--color-tier${r.tier})` : 'var(--color-surface)'} strokeDasharray={r.tier ? undefined : '2 2'} />
        ))}
      </svg>
      <ul className="sr">
        {rounds.map((r, i) => (
          <li key={i}>{r.tier ? t('end.station', { n: i + 1, tier: t(`tier.${r.tier}.name`), meters: r.meters }) : t('end.timeout', { n: i + 1 })}</li>
        ))}
      </ul>
    </>
  );
}

const SQ: Record<number, string> = { 1: '⬜', 2: '🟨', 3: '🟩', 4: '🟦', 5: '🟪', 6: '🟥' };
/** Teks bagikan tanpa spoiler: hanya kotak per tier dan skor. */
export function shareText(head: string, rounds: Round[], line: string) {
  return `${head}\n${rounds.map((r) => (r.tier ? SQ[r.tier] : '⬛')).join('')}\n${line}`;
}
