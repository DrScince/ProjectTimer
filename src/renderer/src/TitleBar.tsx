import { useEffect, useState } from 'react'
import { useI18n } from './i18n'
import logoUrl from './assets/logo.png'

export default function TitleBar() {
  const { t } = useI18n()
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then(setIsMaximized).catch(() => undefined)
    return window.api.window.onState((state) => setIsMaximized(state.isMaximized))
  }, [])

  return (
    <header className={`titlebar${isMaximized ? ' is-maximized' : ''}`}>
      <div
        className="titlebar-drag"
        onDoubleClick={() => void window.api.window.maximizeToggle()}
      >
        <img className="titlebar-logo" src={logoUrl} alt="" width={18} height={18} />
        <span className="titlebar-title">ProjectTimer</span>
      </div>
      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn"
          title={t('window.minimize')}
          aria-label={t('window.minimize')}
          onClick={() => void window.api.window.minimize()}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <rect x="1" y="5.5" width="10" height="1.2" rx="0.4" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar-btn"
          title={isMaximized ? t('window.restore') : t('window.maximize')}
          aria-label={isMaximized ? t('window.restore') : t('window.maximize')}
          onClick={() => void window.api.window.maximizeToggle()}
        >
          {isMaximized ? (
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path
                d="M3.2 3.8h5v5h-5zM4.2 2.5h5.3v5.3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.15"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <rect
                x="2.2"
                y="2.2"
                width="7.6"
                height="7.6"
                rx="0.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.15"
              />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn-close"
          title={t('window.close')}
          aria-label={t('window.close')}
          onClick={() => void window.api.window.close()}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path
              d="M2.4 2.4l7.2 7.2M9.6 2.4L2.4 9.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}
