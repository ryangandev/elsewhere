'use client';
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Locale } from './locale-data';
export { countryBasics, countryName, regionName } from './locale-data';
export type { Locale } from './locale-data';
const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({ locale: 'zh', setLocale: () => {} });
let sessionLocale: Locale = 'zh';
let persistenceFailed = false;
const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener);
  window.addEventListener('elsewhere-language', listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener('elsewhere-language', listener); };
};
const snapshot = (): Locale => { if (persistenceFailed) return sessionLocale; try { const value = localStorage.getItem('elsewhere.language'); return value === 'en' ? 'en' : value === 'zh' ? 'zh' : sessionLocale; } catch { return sessionLocale; } };
export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, snapshot, () => 'zh' as Locale);
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'; }, [locale]);
  const setLocale = (next: Locale) => { sessionLocale = next; try { localStorage.setItem('elsewhere.language', next); persistenceFailed = false; } catch { persistenceFailed = true; } window.dispatchEvent(new Event('elsewhere-language')); };
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}
export const useLocale = () => useContext(LocaleContext);
