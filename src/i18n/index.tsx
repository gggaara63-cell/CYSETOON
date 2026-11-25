'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import id from './id.json';
import en from './en.json';
import type { Locale } from '@/engine/normalize';
import { BRAND } from '@/config/brand';

const DICT: Record<Locale, Record<string, string>> = { id, en };
const KEY = `${BRAND.slug}:locale`;
type T = (key: string, vars?: Record<string, string | number>) => string;
const Ctx = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: T }>({ locale: 'id', setLocale: () => {}, t: (k) => k });

/** Kedua bundel dimuat bersama, jadi pergantian bahasa seketika tanpa reload. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLoc] = useState<Locale>('id');
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    const pick = saved === 'id' || saved === 'en' ? saved : navigator.language.toLowerCase().startsWith('id') ? 'id' : 'en';
    setLoc(pick);
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const setLocale = useCallback((l: Locale) => { setLoc(l); try { localStorage.setItem(KEY, l); } catch {} }, []);
  const t = useCallback<T>((key, vars) => {
    let s = DICT[locale][key] ?? key;
    for (const [k, v] of Object.entries({ app: BRAND.name, ...vars })) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useI18n = () => useContext(Ctx);
