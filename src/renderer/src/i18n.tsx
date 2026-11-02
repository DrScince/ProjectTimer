import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { t as translate, type AppLocale, type MessageKey } from '../../shared/i18n'

type I18nContextValue = {
  locale: AppLocale
  localeTag: string
  t: (key: MessageKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'de',
  localeTag: 'de-DE',
  t: (key, params) => translate(key, params, 'de')
})

export function I18nProvider({
  locale,
  children
}: {
  locale: AppLocale
  children: ReactNode
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      localeTag: locale === 'de' ? 'de-DE' : 'en-US',
      t: (key, params) => translate(key, params, locale)
    }),
    [locale]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
