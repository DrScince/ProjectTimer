import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CsvVorschauZeile, SapTransferStatus } from '../../../shared/types'
import { useI18n } from '../i18n'
import { addDaysIso, formatDateTimeLocal, heuteIso } from '../utils'

function rowKey(row: CsvVorschauZeile, index: number): string {
  return `${row.datum}-${row.projektKuerzel}-${row.buchungIds.join(',')}-${index}`
}

export default function ExportPage() {
  const { t, localeTag } = useI18n()
  const today = heuteIso()
  const [von, setVon] = useState(addDaysIso(today, -6))
  const [bis, setBis] = useState(today)
  const [nurOffen, setNurOffen] = useState(true)
  const [markiereUeberfuehrt, setMarkiereUeberfuehrt] = useState(true)
  const [rows, setRows] = useState<CsvVorschauZeile[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadPreview = useCallback(async () => {
    setError('')
    try {
      const data = await window.api.export.vorschau(von, bis, { nurOffen })
      setRows(data)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('export.errPreview'))
    }
  }, [von, bis, nurOffen, t])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  const selectedIds = useMemo(() => {
    const ids = new Set<number>()
    rows.forEach((row, index) => {
      if (selected.has(rowKey(row, index))) {
        for (const id of row.buchungIds) ids.add(id)
      }
    })
    return Array.from(ids)
  }, [rows, selected])

  const allSelected = rows.length > 0 && selected.size === rows.length

  function toggleAll(): void {
    if (allSelected) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(rows.map((row, index) => rowKey(row, index))))
  }

  function toggleRow(key: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function sapLabel(status: SapTransferStatus): string {
    if (status === 'ueberfuehrt') return t('export.sapDone')
    if (status === 'gemischt') return t('export.sapMixed')
    return t('export.sapOpen')
  }

  async function handleExport(): Promise<void> {
    setMessage('')
    setError('')
    try {
      const result = await window.api.export.csv(von, bis, {
        nurOffen,
        markiereUeberfuehrt
      })
      if (!result.canceled) {
        const marked = result.marked ?? 0
        if (markiereUeberfuehrt && marked > 0) {
          setMessage(
            t('export.savedMarked', { path: result.path ?? '', count: marked })
          )
        } else {
          setMessage(t('export.saved', { path: result.path ?? '' }))
        }
        await loadPreview()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('export.errExport'))
    }
  }

  async function handleMarkSelected(): Promise<void> {
    setMessage('')
    setError('')
    if (selectedIds.length === 0) {
      setError(t('export.selectNone'))
      return
    }
    try {
      const count = await window.api.export.markSap(selectedIds)
      setMessage(t('export.markedCount', { count }))
      await loadPreview()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('export.errExport'))
    }
  }

  async function handleClearSelected(): Promise<void> {
    setMessage('')
    setError('')
    if (selectedIds.length === 0) {
      setError(t('export.selectNone'))
      return
    }
    try {
      const count = await window.api.export.clearSap(selectedIds)
      setMessage(t('export.clearedCount', { count }))
      await loadPreview()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('export.errExport'))
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
          <button className="btn btn-primary" type="button" onClick={() => void handleExport()}>
            {t('export.saveCsv')}
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
        <div className="export-options">
          <label className="checkbox-list">
            <input
              type="checkbox"
              checked={nurOffen}
              onChange={(e) => setNurOffen(e.target.checked)}
            />
            <span>{t('export.onlyOpen')}</span>
          </label>
          <label className="checkbox-list">
            <input
              type="checkbox"
              checked={markiereUeberfuehrt}
              onChange={(e) => setMarkiereUeberfuehrt(e.target.checked)}
            />
            <span>{t('export.markOnSave')}</span>
          </label>
        </div>
        <p className="muted">{t('export.hint')}</p>
      </section>

      <section className="card">
        <div className="page-header compact">
          <h2>
            {t('export.preview')} ({rows.length})
          </h2>
          <div className="actions">
            <button
              className="btn btn-success"
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => void handleMarkSelected()}
            >
              {t('export.markSelected')}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => void handleClearSelected()}
            >
              {t('export.clearSelected')}
            </button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty">{t('export.empty')}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={t('export.markSelected')}
                    />
                  </th>
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
                  const key = rowKey(row, index)
                  const when = formatDateTimeLocal(row.sapUeberfuehrtAm, localeTag)
                  return (
                    <tr key={key}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggleRow(key)}
                        />
                      </td>
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
