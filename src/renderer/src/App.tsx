import { useCallback, useEffect, useState } from 'react'
import TodayPage from './pages/TodayPage'
import WeekPage from './pages/WeekPage'
import ProjectsPage from './pages/ProjectsPage'
import ExportPage from './pages/ExportPage'
import SettingsPage from './pages/SettingsPage'
import FloatingBar from './FloatingBar'
import IdlePromptModal from './IdlePromptModal'
import TitleBar from './TitleBar'
import logoUrl from './assets/logo.png'
import UpdateBanner from './UpdateBanner'
import { I18nProvider, useI18n } from './i18n'
import type { Einstellungen, IdlePrompt } from '../../shared/types'
import {
  detectSystemLocale,
  resolveLocale,
  type AppLocale
} from '../../shared/i18n'

type PageId = 'heute' | 'woche' | 'projekte' | 'export' | 'einstellungen'

function isFloatRoute(): boolean {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return hash === 'float'
}

function applyTheme(darkMode: boolean): void {
  document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light'
}

function MainShell({
  settings,
  setSettings,
  darkMode,
  locale
}: {
  settings: Einstellungen | null
  setSettings: (s: Einstellungen) => void
  darkMode: boolean
  locale: AppLocale
}) {
  const { t } = useI18n()
  const [page, setPage] = useState<PageId>('heute')
  const [idlePrompt, setIdlePrompt] = useState<IdlePrompt | null>(null)

  const NAV: Array<{ id: PageId; labelKey: 'nav.stempel' | 'nav.week' | 'nav.projects' | 'nav.export' | 'nav.settings' }> =
    [
      { id: 'heute', labelKey: 'nav.stempel' },
      { id: 'woche', labelKey: 'nav.week' },
      { id: 'projekte', labelKey: 'nav.projects' },
      { id: 'export', labelKey: 'nav.export' },
      { id: 'einstellungen', labelKey: 'nav.settings' }
    ]

  useEffect(() => {
    void window.api.idle.getPrompt().then((prompt) => {
      if (prompt) setIdlePrompt(prompt)
    })
    return window.api.idle.onPrompt((prompt) => setIdlePrompt(prompt))
  }, [])

  async function toggleDarkMode() {
    const current = settings ?? (await window.api.einstellungen.get())
    const saved = await window.api.einstellungen.save({
      ...current,
      darkMode: !current.darkMode
    })
    setSettings(saved)
    applyTheme(saved.darkMode)
  }

  return (
    <div className="app-frame">
      <TitleBar />
      <UpdateBanner />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-logo" src={logoUrl} alt="" width={48} height={48} />
            <div className="brand-text">
              <strong>ProjectTimer</strong>
              <span>{t('brand.subtitle')}</span>
            </div>
          </div>
          <nav className="nav">
            {NAV.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? 'active' : ''}
                onClick={() => setPage(item.id)}
                type="button"
              >
                {t(item.labelKey)}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => void toggleDarkMode()}
            title={darkMode ? t('theme.toLight') : t('theme.toDark')}
            aria-label={darkMode ? t('theme.toLight') : t('theme.toDark')}
            aria-pressed={darkMode}
          >
            {darkMode ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="4.2" />
                <path
                  d="M12 2.8v2.2M12 19v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.8 12H5M19 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M16.4 14.6A6.6 6.6 0 0 1 9.4 7.6 6.8 6.8 0 1 0 16.4 14.6Z" />
              </svg>
            )}
            <span>{darkMode ? t('theme.light') : t('theme.dark')}</span>
          </button>
        </aside>
        <main className="content content-stempel">
          {page === 'heute' && <TodayPage onNeuerAuftrag={() => setPage('projekte')} />}
          {page === 'woche' && <WeekPage />}
          {page === 'projekte' && <ProjectsPage />}
          {page === 'export' && <ExportPage />}
          {page === 'einstellungen' && <SettingsPage />}
        </main>
        {idlePrompt && (
          <IdlePromptModal prompt={idlePrompt} onResolved={() => setIdlePrompt(null)} />
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [darkMode, setDarkMode] = useState(false)
  const [settings, setSettings] = useState<Einstellungen | null>(null)
  const [locale, setLocaleState] = useState<AppLocale>(() => detectSystemLocale())

  const applySettings = useCallback((next: Einstellungen) => {
    setSettings(next)
    setDarkMode(Boolean(next.darkMode))
    applyTheme(Boolean(next.darkMode))
    setLocaleState(resolveLocale(next.language, navigator.language))
  }, [])

  useEffect(() => {
    void window.api.einstellungen
      .get()
      .then(applySettings)
      .catch(() => undefined)
    return window.api.onEinstellungenChanged(applySettings)
  }, [applySettings])

  if (isFloatRoute()) {
    return (
      <I18nProvider locale={locale}>
        <FloatingBar />
      </I18nProvider>
    )
  }

  return (
    <I18nProvider locale={locale}>
      <MainShell
        settings={settings}
        setSettings={applySettings}
        darkMode={darkMode}
        locale={locale}
      />
    </I18nProvider>
  )
}
