import { useCallback, useEffect, useState } from 'react'
import type { SapTagesStatus, SapTransferStatus, WochenUebersicht } from '../../../shared/types'
import { useI18n } from '../i18n'
import { addDaysIso, formatDauer, formatDatumDe, heuteIso } from '../utils'

type DayBuchung = WochenUebersicht['tage'][number]['buchungen'][number]

type DayProjektSumme = {
  projektId: number
  projektKuerzel: string
  auftragsnummer: string
  minuten: number
  sapStatus: SapTransferStatus | 'leer'
}

function istAbgeschlossen(b: DayBuchung): boolean {
  return (
    b.endeZeit != null || (b.quelle === 'manuell' && b.dauerMinuten != null && b.dauerMinuten > 0)
  )
}

function daySapStatus(buchungen: DayBuchung[]): SapTagesStatus['status'] {
  const completed = buchungen.filter(istAbgeschlossen)
  if (completed.length === 0) return 'leer'
  const done = completed.filter((b) => Boolean(b.sapUeberfuehrtAm)).length
  if (done === 0) return 'offen'
  if (done === completed.length) return 'ueberfuehrt'
  return 'gemischt'
}

function sapStatusForGroup(buchungen: DayBuchung[]): SapTransferStatus | 'leer' {
  const completed = buchungen.filter(istAbgeschlossen)
  if (completed.length === 0) return 'leer'
  const done = completed.filter((b) => Boolean(b.sapUeberfuehrtAm)).length
  if (done === 0) return 'offen'
  if (done === completed.length) return 'ueberfuehrt'
  return 'gemischt'
}

/** Einzelbuchungen pro Auftrag zusammenfassen (nur UI) */
function aggregateByProjekt(buchungen: DayBuchung[]): DayProjektSumme[] {
  const groups = new Map<
    number,
    { kuerzel: string; auftragsnummer: string; minuten: number; items: DayBuchung[] }
  >()

  for (const b of buchungen) {
    const minutes = Math.max(0, b.dauerMinuten ?? 0)
    const existing = groups.get(b.projektId)
    if (existing) {
      existing.minuten += minutes
      existing.items.push(b)
    } else {
      groups.set(b.projektId, {
        kuerzel: b.projektKuerzel,
        auftragsnummer: b.auftragsnummer,
        minuten: minutes,
        items: [b]
      })
    }
  }

  return Array.from(groups.entries())
    .map(([projektId, g]) => ({
      projektId,
      projektKuerzel: g.kuerzel,
      auftragsnummer: g.auftragsnummer,
      minuten: g.minuten,
      sapStatus: sapStatusForGroup(g.items)
    }))
    .filter((g) => g.minuten > 0)
    .sort((a, b) => a.projektKuerzel.localeCompare(b.projektKuerzel, 'de'))
}

export default function WeekPage() {
  const { t, localeTag } = useI18n()
  const [week, setWeek] = useState<WochenUebersicht | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const today = heuteIso()

  const load = useCallback(
    async (wochenStart?: string) => {
      setError('')
      try {
        const data = await window.api.woche.get(wochenStart)
        setWeek(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('week.errLoad'))
      }
    },
    [t]
  )

  useEffect(() => {
    void load()
  }, [load])

  async function handleMarkDay(datum: string): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.markSapDatum(datum)
      setMessage(t('stempel.sapMarked', { count }))
      await load(week?.wochenStart)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleClearDay(datum: string): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.clearSapDatum(datum)
      setMessage(t('stempel.sapCleared', { count }))
      await load(week?.wochenStart)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  function sapDayLabel(status: SapTagesStatus['status']): string | null {
    if (status === 'leer') return null
    if (status === 'ueberfuehrt') return t('week.sapDone')
    if (status === 'gemischt') return t('week.sapMixed')
    return t('week.sapOpen')
  }

  if (!week) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1>{t('week.title')}</h1>
            <p>{t('week.subtitle')}</p>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="card">{t('week.loading')}</div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('week.title')}</h1>
          <p>
            {formatDatumDe(week.wochenStart)} – {formatDatumDe(week.wochenEnde)}
          </p>
        </div>
        <div className="actions">
          <button
            className="btn"
            type="button"
            onClick={() => void load(addDaysIso(week.wochenStart, -7))}
          >
            {t('week.prev')}
          </button>
          <button className="btn" type="button" onClick={() => void load(today)}>
            {t('week.current')}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void load(addDaysIso(week.wochenStart, 7))}
          >
            {t('week.next')}
          </button>
          <span className="badge">
            {t('week.total')}: {formatDauer(week.gesamtMinuten)}
          </span>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <section className="card">
        <div className="week-grid">
          {week.tage.map((tag) => {
            const sapStatus = daySapStatus(tag.buchungen)
            const label = sapDayLabel(sapStatus)
            const canMark = sapStatus === 'offen' || sapStatus === 'gemischt'
            const canClear = sapStatus === 'ueberfuehrt' || sapStatus === 'gemischt'
            const projekte = aggregateByProjekt(tag.buchungen)
            return (
              <div key={tag.datum} className={`week-day${tag.datum === today ? ' today' : ''}`}>
                <strong>
                  {new Date(`${tag.datum}T00:00:00`).toLocaleDateString(localeTag, {
                    weekday: 'long'
                  })}
                </strong>
                <span className="muted">{formatDatumDe(tag.datum)}</span>
                <div className="sum">{formatDauer(tag.gesamtMinuten)}</div>
                {label && <span className={`badge sap-${sapStatus}`}>{label}</span>}
                <ul>
                  {projekte.map((p) => (
                    <li key={p.projektId}>
                      {p.auftragsnummer ? `${p.auftragsnummer} · ` : ''}
                      {p.projektKuerzel}: {formatDauer(p.minuten)}
                      {p.sapStatus === 'ueberfuehrt' ? ' ✓' : ''}
                    </li>
                  ))}
                  {projekte.length === 0 && <li>{t('week.noBookings')}</li>}
                </ul>
                {(canMark || canClear) && (
                  <div className="week-day-actions">
                    {canMark && (
                      <button
                        className="btn btn-success btn-small"
                        type="button"
                        onClick={() => void handleMarkDay(tag.datum)}
                      >
                        {t('week.sapMark')}
                      </button>
                    )}
                    {canClear && (
                      <button
                        className="btn btn-ghost btn-small"
                        type="button"
                        onClick={() => void handleClearDay(tag.datum)}
                      >
                        {t('week.sapClear')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="card">
        <h2>{t('week.sums')}</h2>
        {week.summenProProjekt.length === 0 ? (
          <div className="empty">{t('week.sumsEmpty')}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('week.colOrder')}</th>
                  <th>{t('week.colProject')}</th>
                  <th>{t('week.colCode')}</th>
                  <th>{t('week.colDuration')}</th>
                </tr>
              </thead>
              <tbody>
                {week.summenProProjekt.map((p) => (
                  <tr key={p.projektId}>
                    <td>{p.auftragsnummer || '–'}</td>
                    <td>{p.projektName}</td>
                    <td>{p.projektKuerzel}</td>
                    <td>{formatDauer(p.gesamtMinuten)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
