import { useCallback, useEffect, useState } from 'react'
import type { CsvVorschauZeile, SapTransferStatus } from '../../../shared/types'
import { useI18n } from '../i18n'
import { addDaysIso, formatDateTimeLocal, heuteIso } from '../utils'

type ExportKind = 'csv' | 'excel' | 'pdf'

export default function ExportPage() {
  const { t, localeTag } = useI18n()
  const today = heuteIso()
  const [von, setVon] = useState(addDaysIso(today, -6))
  const [bis, setBis] = useState(today)
  const [rows, setRows] = useState<CsvVorschauZeile[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<ExportKind | null>(null)

  const loadPreview = useCallback(async () => {
    setError('')
    try {
      const data = await window.api.export.vorschau(von, bis, {})
      setRows(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('export.errPreview'))
    }
  }, [von, bis, t])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  function sapLabel(status: SapTransferStatus): string {
    if (status === 'ueberfuehrt') return t('export.sapDone')
    if (status === 'gemischt') return t('export.sapMixed')
    return t('export.sapOpen')
  }

  async function handleExport(kind: ExportKind): Promise<void> {
    setMessage('')
    setError('')
    setBusy(kind)
    try {
      if (kind === 'excel') {
        const result = await window.api.export.excel(von, bis, { excelMode: 'ask' })
        if (!result.canceled) {
          setMessage(
            result.opened
              ? t('export.opened', { path: result.path ?? '' })
              : t('export.saved', { path: result.path ?? '' })
          )
          await loadPreview()
        }
        return
      }

      const api = kind === 'csv' ? window.api.export.csv : window.api.export.pdf
      const result = await api(von, bis, {})
      if (!result.canceled) {
        setMessage(t('export.saved', { path: result.path ?? '' }))
        await loadPreview()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('export.errExport'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('export.title')}</h1>
          <p>{t('export.subtitle')}</p>
        </div>
        <div className="actions">
          <button
            className="btn"
            type="button"
            disabled={busy != null}
            onClick={() => void handleExport('csv')}
          >
            {busy === 'csv' ? t('export.saving') : t('export.saveCsv')}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy != null}
            onClick={() => void handleExport('excel')}
          >
            {busy === 'excel' ? t('export.saving') : t('export.saveExcel')}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy != null}
            onClick={() => void handleExport('pdf')}
          >
            {busy === 'pdf' ? t('export.saving') : t('export.savePdf')}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <section className="card">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="export-von">{t('export.from')}</label>
            <input
              id="export-von"
              type="date"
              value={von}
              onChange={(e) => setVon(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="export-bis">{t('export.to')}</label>
            <input
              id="export-bis"
              type="date"
              value={bis}
              onChange={(e) => setBis(e.target.value)}
            />
          </div>
        </div>
        <p className="muted">{t('export.hint')}</p>
      </section>

      <section className="card">
        <div className="page-header compact">
          <h2>
            {t('export.preview')} ({rows.length})
          </h2>
        </div>
        {rows.length === 0 ? (
          <div className="empty">{t('export.empty')}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('export.colPersonal')}</th>
                  <th>{t('export.colDate')}</th>
                  <th>{t('export.colHours')}</th>
                  <th>{t('export.colOrder')}</th>
                  <th>{t('export.colWorkplace')}</th>
                  <th>{t('export.colProject')}</th>
                  <th>{t('export.colText')}</th>
                  <th>{t('export.colSap')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const when = formatDateTimeLocal(row.sapUeberfuehrtAm, localeTag)
                  return (
                    <tr
                      key={`${row.datum}-${row.projektKuerzel}-${row.buchungIds.join(',')}-${index}`}
                    >
                      <td>{row.personalnummer || '–'}</td>
                      <td>{row.datum}</td>
                      <td>{row.stunden}</td>
                      <td>{row.auftragsnummer || '–'}</td>
                      <td>{row.arbeitsplatz || '–'}</td>
                      <td>{row.projektKuerzel}</td>
                      <td>{row.kurztext || '–'}</td>
                      <td>
                        <span className={`badge sap-${row.sapStatus}`}>{sapLabel(row.sapStatus)}</span>
                        {when ? (
                          <div className="muted sap-when">{t('export.sapAt', { when })}</div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
