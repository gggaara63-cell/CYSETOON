'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { LangToggle } from '@/components/ui';
import { fmtDuration, loadDaily, msToReset, type DailyResult } from '@/lib/daily';

export default function Home() {
  const { t, locale } = useI18n();
  const [done, setDone] = useState<DailyResult | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => { setDone(loadDaily(locale)); setLeft(msToReset(locale)); };
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [locale]);

  return (
    <main className="wrap">
      <header className="row">
        <h1 className="display" style={{ fontSize: 'var(--text-display)' }}>{t('app.name')}</h1>
        <LangToggle />
      </header>
      <p className="muted" style={{ margin: '4px 0 24px' }}>{t('app.tag')}</p>
      <div className="home">
        <section className="plate big" aria-labelledby="daily">
          <h2 id="daily" style={{ fontSize: 'var(--text-display)', lineHeight: 1 }}>{t('home.daily.title')}</h2>
          <p>{t('home.daily.body')}</p>
          {done ? (
            <>
              <p><strong>{t('home.daily.result', { score: done.score })}</strong></p>
              <p className="muted">{t('home.daily.done', { time: fmtDuration(left) })}</p>
            </>
          ) : (
            <>
              <p className="muted">{fmtDuration(left)}</p>
              <Link className="btn" href="/main/daily">{t('home.daily.start')}</Link>
            </>
          )}
        </section>
        <div className="stack">
          <section className="plate" aria-labelledby="endless">
            <h2 id="endless" style={{ fontSize: 'var(--text-display)', lineHeight: 1 }}>{t('home.endless.title')}</h2>
            <p>{t('home.endless.body')}</p>
            <Link className="btn secondary" href="/main/endless">{t('home.endless.start')}</Link>
          </section>
          <Link className="plate" href="/mabar">
            <h2 style={{ fontSize: 32 }}>{t('home.mabar.title')}</h2>
            <p>{t('home.mabar.body')}</p>
          </Link>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 24 }}>{t('home.note')}</p>
    </main>
  );
}
