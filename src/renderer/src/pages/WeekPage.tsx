import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  Projekt,
  SapTagesStatus,
  SapTransferStatus,
  ZeitbuchungMitProjekt
} from '../../../shared/types'
import { IconCheck, IconUndo } from '../icons'
import { useI18n } from '../i18n'
import {
  addMonthsKey,
  buildMonthCells,
  formatDauer,
  formatDatumDe,
  formatZeitHm,
  heuteIso,
  monthEndIso,
  monthKeyFromIso,
  monthStartIso
} from '../utils'

type EditForm = {
  projektId: number
  startZeit: string
  endeZeit: string
  notiz: string
}

function toTimeInput(zeit: string | null | undefined): string {
  if (!zeit) return ''
  const parts = zeit.split(':')
  if (parts.length < 2) return ''
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
}

function fromTimeInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed
}

type DayGroup = {
  key: string
  projektId: number
  projektName: string
  projektKuerzel: string
  auftragsnummer: string
  kurztext: string
  minuten: number
  sapStatus: SapTransferStatus | 'leer'
  buchungen: ZeitbuchungMitProjekt[]
}

function istAbgeschlossen(b: ZeitbuchungMitProjekt): boolean {
  return (
    b.endeZeit != null || (b.quelle === 'manuell' && b.dauerMinuten != null && b.dauerMinuten > 0)
  )
}

function buchungMinuten(b: ZeitbuchungMitProjekt): number {
  return Math.max(0, b.dauerMinuten ?? 0)
}

function daySapStatus(buchungen: ZeitbuchungMitProjekt[]): SapTagesStatus['status'] {
  const completed = buchungen.filter(istAbgeschlossen)
  if (completed.length === 0) return 'leer'
  const done = completed.filter((b) => Boolean(b.sapUeberfuehrtAm)).length
  if (done === 0) return 'offen'
  if (done === completed.length) return 'ueberfuehrt'
  return 'gemischt'
}

function sapStatusForGroup(buchungen: ZeitbuchungMitProjekt[]): SapTransferStatus | 'leer' {
  const completed = buchungen.filter(istAbgeschlossen)
  if (completed.length === 0) return 'leer'
  const done = completed.filter((b) => Boolean(b.sapUeberfuehrtAm)).length
  if (done === 0) return 'offen'
  if (done === completed.length) return 'ueberfuehrt'
  return 'gemischt'
}

function groupKey(projektId: number, kurztext: string): string {
  return `${projektId}::${kurztext}`
}

function sortBuchungen(buchungen: ZeitbuchungMitProjekt[]): ZeitbuchungMitProjekt[] {
  return [...buchungen].sort((a, b) => {
    const as = a.startZeit ?? '99:99'
    const bs = b.startZeit ?? '99:99'
    if (as !== bs) return as.localeCompare(bs)
    return a.id - b.id
  })
}

function groupByProjektKurztext(buchungen: ZeitbuchungMitProjekt[]): DayGroup[] {
  const groups = new Map<
    string,
    {
      projektId: number
      projektName: string
      projektKuerzel: string
      auftragsnummer: string
      kurztext: string
      minuten: number
      items: ZeitbuchungMitProjekt[]
    }
  >()

  for (const b of buchungen) {
    const kurztext = (b.notiz ?? '').trim()
    const key = groupKey(b.projektId, kurztext)
    const minutes = buchungMinuten(b)
    const existing = groups.get(key)
    if (existing) {
      existing.minuten += minutes
      existing.items.push(b)
    } else {
      groups.set(key, {
        projektId: b.projektId,
        projektName: b.projektName,
        projektKuerzel: b.projektKuerzel,
        auftragsnummer: b.auftragsnummer,
        kurztext,
        minuten: minutes,
        items: [b]
      })
    }
  }

  return Array.from(groups.entries())
    .map(([key, g]) => ({
      key,
      projektId: g.projektId,
      projektName: g.projektName,
      projektKuerzel: g.projektKuerzel,
      auftragsnummer: g.auftragsnummer,
      kurztext: g.kurztext,
      minuten: g.minuten,
      sapStatus: sapStatusForGroup(g.items),
      buchungen: sortBuchungen(g.items)
    }))
    .sort((a, b) => {
      const byKuerzel = a.projektKuerzel.localeCompare(b.projektKuerzel, 'de')
      if (byKuerzel !== 0) return byKuerzel
      return a.kurztext.localeCompare(b.kurztext, 'de')
    })
}

export default function WeekPage() {
  const { t, localeTag } = useI18n()
  const today = heuteIso()
  const [viewMonth, setViewMonth] = useState(() => monthKeyFromIso(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [monthMinutes, setMonthMinutes] = useState<Record<string, number>>({})
  const [monthPresent, setMonthPresent] = useState<Record<string, number>>({})
  const [monthSap, setMonthSap] = useState<Record<string, SapTagesStatus['status']>>({})
  const [dayBuchungen, setDayBuchungen] = useState<ZeitbuchungMitProjekt[]>([])
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())
  const [loadingMonth, setLoadingMonth] = useState(true)
  const [loadingDay, setLoadingDay] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editBuchung, setEditBuchung] = useState<ZeitbuchungMitProjekt | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [projekte, setProjekte] = useState<Projekt[]>([])

  const loadMonth = useCallback(
    async (monthKey: string, opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setError('')
        setLoadingMonth(true)
      }
      try {
        const von = monthStartIso(monthKey)
        const bis = monthEndIso(monthKey)
        const [rows, anwesenheit] = await Promise.all([
          window.api.buchungen.listByRange(von, bis),
          window.api.anwesenheit.listMinutenByRange(von, bis)
        ])
        const map: Record<string, number> = {}
        const byDatum = new Map<string, ZeitbuchungMitProjekt[]>()
        for (const b of rows) {
          const m = buchungMinuten(b)
          if (m > 0) map[b.datum] = (map[b.datum] ?? 0) + m
          const list = byDatum.get(b.datum)
          if (list) list.push(b)
          else byDatum.set(b.datum, [b])
        }
        const sapMap: Record<string, SapTagesStatus['status']> = {}
        for (const [datum, list] of byDatum) {
          sapMap[datum] = daySapStatus(list)
        }
        const presentMap: Record<string, number> = {}
        for (const row of anwesenheit) {
          if (row.stempelMinuten > 0) presentMap[row.datum] = row.stempelMinuten
        }
        setMonthMinutes(map)
        setMonthPresent(presentMap)
        setMonthSap(sapMap)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('week.errLoad'))
      } finally {
        if (!opts?.silent) setLoadingMonth(false)
      }
    },
    [t]
  )

  const loadDay = useCallback(
    async (datum: string, opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setError('')
        setLoadingDay(true)
      }
      try {
        const rows = await window.api.buchungen.listByDatum(datum)
        setDayBuchungen(rows)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('week.errLoad'))
      } finally {
        if (!opts?.silent) setLoadingDay(false)
      }
    },
    [t]
  )

  useEffect(() => {
    void loadMonth(viewMonth)
  }, [loadMonth, viewMonth])

  useEffect(() => {
    void loadDay(selectedDate)
  }, [loadDay, selectedDate])

  useEffect(() => {
    setExpandedKeys(new Set())
  }, [selectedDate])

  useEffect(() => {
    void window.api.projekte.list(true).then(setProjekte).catch(() => setProjekte([]))
  }, [])

  async function refreshQuietly(): Promise<void> {
    await Promise.all([
      loadMonth(viewMonth, { silent: true }),
      loadDay(selectedDate, { silent: true })
    ])
  }

  function openEdit(buchung: ZeitbuchungMitProjekt): void {
    setEditError('')
    setEditBuchung(buchung)
    setEditForm({
      projektId: buchung.projektId,
      startZeit: toTimeInput(buchung.startZeit),
      endeZeit: toTimeInput(buchung.endeZeit),
      notiz: buchung.notiz ?? ''
    })
  }

  function closeEdit(): void {
    if (editSaving) return
    setEditBuchung(null)
    setEditForm(null)
    setEditError('')
  }

  async function handleEditSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!editBuchung || !editForm) return
    setEditError('')
    if (!editForm.projektId) {
      setEditError(t('week.errEdit'))
      return
    }
    const startZeit = fromTimeInput(editForm.startZeit)
    const endeZeit = fromTimeInput(editForm.endeZeit)
    if (!startZeit && !endeZeit && !(editBuchung.dauerMinuten && editBuchung.dauerMinuten > 0)) {
      setEditError(t('week.errEdit'))
      return
    }
    setEditSaving(true)
    try {
      await window.api.buchungen.update(editBuchung.id, {
        projektId: editForm.projektId,
        datum: editBuchung.datum,
        startZeit,
        endeZeit,
        dauerMinuten:
          startZeit && endeZeit ? null : editBuchung.dauerMinuten,
        notiz: editForm.notiz,
        quelle: editBuchung.quelle
      })
      setEditBuchung(null)
      setEditForm(null)
      await refreshQuietly()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t('week.errEdit'))
    } finally {
      setEditSaving(false)
    }
  }

  const projektOptions = useMemo(() => {
    const map = new Map(projekte.map((p) => [p.id, p]))
    if (editBuchung && !map.has(editBuchung.projektId)) {
      map.set(editBuchung.projektId, {
        id: editBuchung.projektId,
        name: editBuchung.projektName,
        kuerzel: editBuchung.projektKuerzel,
        auftragsnummer: editBuchung.auftragsnummer,
        arbeitsplatz: editBuchung.arbeitsplatz,
        empfaengerArt: editBuchung.empfaengerArt,
        empfaenger: editBuchung.empfaenger,
        leistungsart: editBuchung.leistungsart,
        aktiv: true,
        sortOrder: 0,
        kurztext: '',
        erstelltAm: ''
      } as Projekt)
    }
    return Array.from(map.values()).sort((a, b) =>
      a.kuerzel.localeCompare(b.kuerzel, 'de')
    )
  }, [projekte, editBuchung])

  async function handleSapMarkGroup(group: DayGroup): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.markSapDatumProjektNotiz(
        selectedDate,
        group.projektId,
        group.kurztext
      )
      setMessage(t('stempel.sapMarked', { count }))
      await refreshQuietly()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleSapClearGroup(group: DayGroup): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.clearSapDatumProjektNotiz(
        selectedDate,
        group.projektId,
        group.kurztext
      )
      setMessage(t('stempel.sapCleared', { count }))
      await refreshQuietly()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleSapMarkEntry(buchung: ZeitbuchungMitProjekt): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.markSap([buchung.id])
      setMessage(t('stempel.sapMarked', { count }))
      await refreshQuietly()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleSapClearEntry(buchung: ZeitbuchungMitProjekt): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.clearSap([buchung.id])
      setMessage(t('stempel.sapCleared', { count }))
      await refreshQuietly()
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

  function goToday(): void {
    setViewMonth(monthKeyFromIso(today))
    setSelectedDate(today)
  }

  function selectDay(datum: string): void {
    setSelectedDate(datum)
    if (monthKeyFromIso(datum) !== viewMonth) {
      setViewMonth(monthKeyFromIso(datum))
    }
  }

  function toggleGroup(key: string): void {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const cells = useMemo(() => buildMonthCells(viewMonth), [viewMonth])
  const weekdayLabels = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(2024, 0, 1 + i)
      return d.toLocaleDateString(localeTag, { weekday: 'short' })
    })
  }, [localeTag])

  const monthTitle = useMemo(() => {
    const [y, m] = viewMonth.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString(localeTag, {
      month: 'long',
      year: 'numeric'
    })
  }, [viewMonth, localeTag])

  const selectedLabel = useMemo(() => {
    return new Date(`${selectedDate}T00:00:00`).toLocaleDateString(localeTag, {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    })
  }, [selectedDate, localeTag])

  const dayTotal = useMemo(
    () => dayBuchungen.reduce((sum, b) => sum + buchungMinuten(b), 0),
    [dayBuchungen]
  )
  const dayPresent = monthPresent[selectedDate] ?? 0
  const groups = useMemo(() => groupByProjektKurztext(dayBuchungen), [dayBuchungen])
  const sapStatus = useMemo(() => daySapStatus(dayBuchungen), [dayBuchungen])
  const sapLabel = sapDayLabel(sapStatus)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('week.title')}</h1>
          <p>{t('week.subtitle')}</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={goToday}>
            {t('week.today')}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <div className="calendar-layout">
        <section className="card calendar-panel">
          <div className="calendar-nav">
            <button
              className="btn"
              type="button"
              onClick={() => setViewMonth((m) => addMonthsKey(m, -1))}
              aria-label={t('week.prevMonth')}
            >
              {t('week.prevMonth')}
            </button>
            <strong className="calendar-month-title">{monthTitle}</strong>
            <button
              className="btn"
              type="button"
              onClick={() => setViewMonth((m) => addMonthsKey(m, 1))}
              aria-label={t('week.nextMonth')}
            >
              {t('week.nextMonth')}
            </button>
          </div>

          <div className="month-weekdays">
            {weekdayLabels.map((label) => (
              <span key={label} className="month-weekday">
                {label}
              </span>
            ))}
          </div>

          <div className="month-grid">
            {cells.map((cell, index) => {
              if (!cell.datum) {
                return <div key={`empty-${index}`} className="day-cell is-empty" />
              }
              const minutes = monthMinutes[cell.datum] ?? 0
              const present = monthPresent[cell.datum] ?? 0
              const daySap = monthSap[cell.datum] ?? 'leer'
              const isSelected = cell.datum === selectedDate
              const isToday = cell.datum === today
              const sapTitle =
                daySap === 'ueberfuehrt'
                  ? t('week.sapDone')
                  : daySap === 'gemischt'
                    ? t('week.sapMixed')
                    : daySap === 'offen'
                      ? t('week.sapOpen')
                      : ''
              const cellTitle = [
                present > 0 ? `${t('week.present')}: ${formatDauer(present)}` : '',
                minutes > 0 ? `${t('week.total')}: ${formatDauer(minutes)}` : '',
                sapTitle
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <button
                  key={cell.datum}
                  type="button"
                  className={[
                    'day-cell',
                    isSelected ? 'is-selected' : '',
                    isToday ? 'is-today' : '',
                    minutes > 0 || present > 0 ? 'has-bookings' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={cellTitle || undefined}
                  onClick={() => selectDay(cell.datum!)}
                >
                  <span className="day-cell-num">{Number(cell.datum.slice(8))}</span>
                  {(minutes > 0 || present > 0) && (
                    <span
                      className={`day-cell-dot sap-${
                        minutes > 0 ? (daySap === 'leer' ? 'offen' : daySap) : 'offen'
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  {present > 0 && (
                    <span className="day-cell-mins day-cell-present">{formatDauer(present)}</span>
                  )}
                  {minutes > 0 && (
                    <span className="day-cell-mins day-cell-booked">{formatDauer(minutes)}</span>
                  )}
                </button>
              )
            })}
          </div>
          {loadingMonth && <p className="muted calendar-hint">{t('week.loading')}</p>}
        </section>

        <section className="card day-detail">
          <div className="day-detail-header">
            <div>
              <h2>{selectedLabel}</h2>
              <p className="muted">{formatDatumDe(selectedDate)}</p>
            </div>
            <div className="day-detail-meta">
              {dayPresent > 0 && (
                <span className="badge badge-present">
                  {t('week.present')}: {formatDauer(dayPresent)}
                </span>
              )}
              <span className="badge">
                {t('week.total')}: {formatDauer(dayTotal)}
              </span>
              {sapLabel && <span className={`badge sap-${sapStatus}`}>{sapLabel}</span>}
            </div>
          </div>

          {loadingDay ? (
            <p className="muted">{t('week.loading')}</p>
          ) : groups.length === 0 ? (
            <div className="empty">{t('week.noBookings')}</div>
          ) : (
            <div className="day-groups">
              {groups.map((g) => {
                const open = expandedKeys.has(g.key)
                const topicLabel = g.kurztext || t('stempel.topicEmpty')
                const canMarkGroup = g.sapStatus === 'offen' || g.sapStatus === 'gemischt'
                const canClearGroup = g.sapStatus === 'ueberfuehrt' || g.sapStatus === 'gemischt'
                return (
                  <div key={g.key} className={`day-group${open ? ' is-open' : ''}`}>
                    <div className="day-group-header">
                      <button
                        type="button"
                        className="day-group-summary"
                        aria-expanded={open}
                        onClick={() => toggleGroup(g.key)}
                      >
                        <span className="day-group-chevron" aria-hidden="true">
                          {open ? '▾' : '▸'}
                        </span>
                        <span className="day-group-main">
                          <strong>
                            {g.auftragsnummer ? `${g.auftragsnummer} · ` : ''}
                            {g.projektKuerzel}
                            {g.sapStatus === 'ueberfuehrt' ? ' ✓' : ''}
                          </strong>
                          <span className="day-group-topic">{topicLabel}</span>
                        </span>
                        <span className="day-group-meta">
                          <span className="muted">{t('week.entries', { count: g.buchungen.length })}</span>
                          <span className="day-group-sum">{formatDauer(g.minuten)}</span>
                        </span>
                      </button>
                      <div className="day-group-sap">
                        {g.sapStatus !== 'leer' && (
                          <span className={`badge sap-${g.sapStatus}`}>
                            {sapDayLabel(g.sapStatus)}
                          </span>
                        )}
                        <button
                          className="btn btn-success btn-icon btn-small"
                          type="button"
                          title={t('week.sapMark')}
                          aria-label={t('week.sapMark')}
                          disabled={!canMarkGroup}
                          onClick={() => void handleSapMarkGroup(g)}
                        >
                          <IconCheck />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-small"
                          type="button"
                          title={t('week.sapClear')}
                          aria-label={t('week.sapClear')}
                          disabled={!canClearGroup}
                          onClick={() => void handleSapClearGroup(g)}
                        >
                          <IconUndo />
                        </button>
                      </div>
                    </div>
                    {open && (
                      <div className="day-group-body">
                        <table className="day-bookings-table">
                          <thead>
                            <tr>
                              <th>{t('week.colFrom')}</th>
                              <th>{t('week.colTo')}</th>
                              <th>{t('week.colDuration')}</th>
                              <th>{t('week.colSap')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.buchungen.map((b) => {
                              const completed = istAbgeschlossen(b)
                              const marked = Boolean(b.sapUeberfuehrtAm)
                              return (
                                <tr
                                  key={b.id}
                                  className="day-booking-row"
                                  title={t('week.editHint')}
                                  onContextMenu={(event) => {
                                    event.preventDefault()
                                    openEdit(b)
                                  }}
                                >
                                  <td>{formatZeitHm(b.startZeit)}</td>
                                  <td>{formatZeitHm(b.endeZeit)}</td>
                                  <td>
                                    {formatDauer(buchungMinuten(b))}
                                    {marked ? ' ✓' : ''}
                                  </td>
                                  <td>
                                    <div className="day-entry-sap">
                                      <button
                                        className="btn btn-success btn-icon btn-small"
                                        type="button"
                                        title={t('week.sapMark')}
                                        aria-label={t('week.sapMark')}
                                        disabled={!completed || marked}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void handleSapMarkEntry(b)
                                        }}
                                      >
                                        <IconCheck />
                                      </button>
                                      <button
                                        className="btn btn-ghost btn-icon btn-small"
                                        type="button"
                                        title={t('week.sapClear')}
                                        aria-label={t('week.sapClear')}
                                        disabled={!marked}
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          void handleSapClearEntry(b)
                                        }}
                                      >
                                        <IconUndo />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {editBuchung && editForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeEdit()
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="week-edit-title"
          >
            <h2 id="week-edit-title">{t('week.editTitle')}</h2>
            <form className="form-grid" onSubmit={(e) => void handleEditSubmit(e)}>
              <div className="field full">
                <label htmlFor="week-edit-projekt">{t('week.colProject')}</label>
                <select
                  id="week-edit-projekt"
                  value={editForm.projektId}
                  onChange={(e) =>
                    setEditForm((prev) =>
                      prev ? { ...prev, projektId: Number(e.target.value) } : prev
                    )
                  }
                >
                  {projektOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.auftragsnummer ? `${p.auftragsnummer} · ` : ''}
                      {p.kuerzel} – {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="week-edit-from">{t('week.colFrom')}</label>
                <input
                  id="week-edit-from"
                  type="time"
                  value={editForm.startZeit}
                  onChange={(e) =>
                    setEditForm((prev) => (prev ? { ...prev, startZeit: e.target.value } : prev))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="week-edit-to">{t('week.colTo')}</label>
                <input
                  id="week-edit-to"
                  type="time"
                  value={editForm.endeZeit}
                  onChange={(e) =>
                    setEditForm((prev) => (prev ? { ...prev, endeZeit: e.target.value } : prev))
                  }
                />
              </div>
              <div className="field full">
                <label htmlFor="week-edit-notiz">{t('week.colTopic')}</label>
                <input
                  id="week-edit-notiz"
                  type="text"
                  value={editForm.notiz}
                  onChange={(e) =>
                    setEditForm((prev) => (prev ? { ...prev, notiz: e.target.value } : prev))
                  }
                />
              </div>
              {editError && <p className="error full">{editError}</p>}
              <div className="actions full">
                <button className="btn" type="button" onClick={closeEdit} disabled={editSaving}>
                  {t('week.editCancel')}
                </button>
                <button className="btn btn-primary" type="submit" disabled={editSaving}>
                  {t('week.editSave')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
