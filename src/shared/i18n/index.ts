import { de, type MessageKey } from './de'
import { en } from './en'

export type AppLocale = 'de' | 'en'
export type LanguagePreference = 'system' | AppLocale

const catalogs: Record<AppLocale, Record<MessageKey, string>> = {
  de,
  en
}

let currentLocale: AppLocale = 'de'

export function detectSystemLocale(systemLocale?: string): AppLocale {
  const raw = (systemLocale || (typeof navigator !== 'undefined' ? navigator.language : 'de'))
    .toLowerCase()
  return raw.startsWith('de') ? 'de' : 'en'
}

export function resolveLocale(
  preference: LanguagePreference | string | undefined,
  systemLocale?: string
): AppLocale {
  if (preference === 'de' || preference === 'en') return preference
  return detectSystemLocale(systemLocale)
}

export function setLocale(locale: AppLocale): void {
  currentLocale = locale
}

export function getLocale(): AppLocale {
  return currentLocale
}

export function getLocaleTag(): string {
  return currentLocale === 'de' ? 'de-DE' : 'en-US'
}

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
  locale: AppLocale = currentLocale
): string {
  const catalog = catalogs[locale] ?? catalogs.de
  let text = catalog[key] ?? catalogs.de[key] ?? String(key)
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

export type { MessageKey }
