import { FormEvent, useEffect, useState } from 'react'
import { CSV_SPALTEN_LABELS, DEFAULT_CSV_SPALTEN, type Einstellungen } from '../../../shared/types'
import { useI18n } from '../i18n'

const ALL_COLUMNS = [...DEFAULT_CSV_SPALTEN]

export default function SettingsPage() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<Einstellungen>({
    anzeigename: '',
    personalnummer: '',
    csvTrennzeichen: ';',
    csvSpalten: [...DEFAULT_CSV_SPALTEN],
    alwaysOnTopBar: false,
    floatBarMode: 'free',
    floatBarEdge: 'top',
    floatBarEdgeOffset: null,
    darkMode: false,
    idleDetectionEnabled: true,
    idleThresholdMinutes: 5,
    autoKommenEnabled: true,
    autoGehenOnShutdown: true,
    autoStartEnabled: false,
    language: 'system',
    kurztextHeute: '',
    kurztextDatum: ''
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.einstellungen
      .get()
      .then(setSettings)
      .catch((err: Error) => setError(err.message))
    return window.api.onEinstellungenChanged(setSettings)
  }, [])

  function toggleColumn(column: string) {
    setSettings((prev) => {
      const exists = prev.csvSpalten.includes(column)
      if (exists) {
        return { ...prev, csvSpalten: prev.csvSpalten.filter((c) => c !== column) }
      }
      const next = ALL_COLUMNS.filter((c) => prev.csvSpalten.includes(c) || c === column)
      return { ...prev, csvSpalten: next }
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (settings.csvSpalten.length === 0) {
      setError(t('settings.errColumns'))
      return
    }

    try {
      const saved = await window.api.einstellungen.save(settings)
      setSettings(saved)
      setMessage(t('settings.saved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.errSave'))
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <section className="card">
        <form className="form-grid" onSubmit={(e) => void handleSubmit(e)}>
          <div className="field">
            <label htmlFor="anzeigename">{t('settings.displayName')}</label>
            <input
              id="anzeigename"
              value={settings.anzeigename}
              onChange={(e) => setSettings((prev) => ({ ...prev, anzeigename: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="personalnummer">{t('settings.personalNo')}</label>
            <input
              id="personalnummer"
              value={settings.personalnummer}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, personalnummer: e.target.value }))
              }
              placeholder={t('settings.personalPh')}
            />
          </div>
          <div className="field">
            <label htmlFor="language">{t('settings.language')}</label>
            <select
              id="language"
              value={settings.language}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  language: e.target.value as Einstellungen['language']
                }))
              }
            >
              <option value="system">{t('settings.langSystem')}</option>
              <option value="de">{t('settings.langDe')}</option>
              <option value="en">{t('settings.langEn')}</option>
            </select>
            <p className="muted">{t('settings.langHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="trennzeichen">{t('settings.csvSep')}</label>
            <select
              id="trennzeichen"
              value={settings.csvTrennzeichen === '\t' ? 'tab' : settings.csvTrennzeichen}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  csvTrennzeichen: e.target.value === 'tab' ? '\t' : e.target.value
                }))
              }
            >
              <option value=";">{t('settings.sepSemicolon')}</option>
              <option value=",">{t('settings.sepComma')}</option>
              <option value="tab">{t('settings.sepTab')}</option>
            </select>
          </div>
          <div className="field full">
            <label className="checkbox-list">
              <span>
                <input
                  type="checkbox"
                  checked={settings.alwaysOnTopBar}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, alwaysOnTopBar: e.target.checked }))
                  }
                />{' '}
                {t('settings.alwaysOnTop')}
              </span>
            </label>
            <p className="muted">{t('settings.alwaysOnTopHint')}</p>
          </div>
          {settings.alwaysOnTopBar && (
            <>
              <div className="field">
                <label htmlFor="float-mode">{t('settings.floatMode')}</label>
                <select
                  id="float-mode"
                  value={settings.floatBarMode}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      floatBarMode: e.target.value as Einstellungen['floatBarMode']
                    }))
                  }
                >
                  <option value="free">{t('settings.floatModeFree')}</option>
                  <option value="slideout">{t('settings.floatModeSlideout')}</option>
                </select>
                <p className="muted">{t('settings.floatModeHint')}</p>
              </div>
              {settings.floatBarMode === 'slideout' && (
                <div className="field">
                  <label htmlFor="float-edge">{t('settings.floatEdge')}</label>
                  <select
                    id="float-edge"
                    value={settings.floatBarEdge}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        floatBarEdge: e.target.value as Einstellungen['floatBarEdge'],
                        floatBarEdgeOffset: null
                      }))
                    }
                  >
                    <option value="top">{t('settings.floatEdgeTop')}</option>
                    <option value="left">{t('settings.floatEdgeLeft')}</option>
                    <option value="right">{t('settings.floatEdgeRight')}</option>
                  </select>
                  <p className="muted">{t('settings.floatEdgeHint')}</p>
                </div>
              )}
            </>
          )}
          <div className="field full">
            <label className="checkbox-list">
              <span>
                <input
                  type="checkbox"
                  checked={settings.darkMode}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, darkMode: e.target.checked }))
                  }
                />{' '}
                {t('settings.darkMode')}
              </span>
            </label>
            <p className="muted">{t('settings.darkModeHint')}</p>
          </div>
          <div className="field full">
            <label className="checkbox-list">
              <span>
                <input
                  type="checkbox"
                  checked={settings.idleDetectionEnabled}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      idleDetectionEnabled: e.target.checked
                    }))
                  }
                />{' '}
                {t('settings.idleDetect')}
              </span>
            </label>
            <p className="muted">{t('settings.idleDetectHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="idle-threshold">{t('settings.idleThreshold')}</label>
            <input
              id="idle-threshold"
              type="number"
              min={1}
              max={120}
              value={settings.idleThresholdMinutes}
              disabled={!settings.idleDetectionEnabled}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  idleThresholdMinutes: Math.max(1, Number(e.target.value) || 5)
                }))
              }
            />
          </div>
          <div className="field full">
            <label className="checkbox-list">
              <span>
                <input
                  type="checkbox"
                  checked={settings.autoKommenEnabled}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoKommenEnabled: e.target.checked
                    }))
                  }
                />{' '}
                {t('settings.autoKommen')}
              </span>
            </label>
            <p className="muted">{t('settings.autoKommenHint')}</p>
          </div>
          <div className="field full">
            <label className="checkbox-list">
              <span>
                <input
                  type="checkbox"
                  checked={settings.autoGehenOnShutdown}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoGehenOnShutdown: e.target.checked
                    }))
                  }
                />{' '}
                {t('settings.autoGehen')}
              </span>
            </label>
            <p className="muted">{t('settings.autoGehenHint')}</p>
          </div>
          <div className="field full">
            <label className="checkbox-list">
              <span>
                <input
                  type="checkbox"
                  checked={settings.autoStartEnabled}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoStartEnabled: e.target.checked
                    }))
                  }
                />{' '}
                {t('settings.autoStart')}
              </span>
            </label>
            <p className="muted">{t('settings.autoStartHint')}</p>
          </div>
          <div className="field full">
            <label>{t('settings.exportCols')}</label>
            <div className="checkbox-list">
              {ALL_COLUMNS.map((column) => (
                <label key={column}>
                  <input
                    type="checkbox"
                    checked={settings.csvSpalten.includes(column)}
                    onChange={() => toggleColumn(column)}
                  />
                  {CSV_SPALTEN_LABELS[column] ?? column}
                </label>
              ))}
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary" type="submit">
              {t('settings.save')}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
