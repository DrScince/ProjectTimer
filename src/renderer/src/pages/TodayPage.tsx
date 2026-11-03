import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type {
  Anwesenheit,
  EmpfaengerArt,
  ProjektMitZeit,
  TagesThema
} from '../../../shared/types'
import {
  IconCheck,
  IconLogin,
  IconLogout,
  IconPause,
  IconPlus,
  IconSplit,
  IconUndo,
  IconX
} from '../icons'
import { useI18n } from '../i18n'
import { formatDateTimeLocal, formatDauer, formatSekunden, heuteIso } from '../utils'

type Props = {
  onNeuerAuftrag?: () => void
}

export default function TodayPage({ onNeuerAuftrag }: Props) {
  const { t, localeTag } = useI18n()
  const [anwesenheit, setAnwesenheit] = useState<Anwesenheit | null>(null)
  const [projekte, setProjekte] = useState<ProjektMitZeit[]>([])
  const [sapMessage, setSapMessage] = useState('')
  const [personalnummer, setPersonalnummer] = useState('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [quick, setQuick] = useState({
    name: '',
    kuerzel: '',
    auftragsnummer: '',
    arbeitsplatz: '',
    empfaengerArt: 'Innenauftrag' as EmpfaengerArt,
    empfaenger: '',
    leistungsart: ''
  })
  const [manual, setManual] = useState({
    projektId: '' as number | '',
    dauerStunden: '1',
    dauerMinuten: '0',
    notiz: ''
  })
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const dragIdRef = useRef<number | null>(null)
  const [topicDrafts, setTopicDrafts] = useState<Record<number, string>>({})
  const [redistributeId, setRedistributeId] = useState<number | null>(null)
  const [redistributeRows, setRedistributeRows] = useState<
    Array<{ key: string; kurztext: string; minuten: number }>
  >([])
  const [redistributeNewText, setRedistributeNewText] = useState('')

  const load = useCallback(async (opts?: { animate?: boolean }) => {
    const [a, p, settings] = await Promise.all([
      window.api.anwesenheit.get(),
      window.api.projekte.listMitZeiten(),
      window.api.einstellungen.get()
    ])
    const apply = (): void => {
      setAnwesenheit(a)
      setProjekte(p)
      setPersonalnummer(settings.personalnummer)
      setManual((prev) =>
        prev.projektId === '' && p.length > 0 ? { ...prev, projektId: p[0].id } : prev
      )
    }
    const doc = document as Document & {
      startViewTransition?: (update: () => void) => unknown
    }
    if (opts?.animate && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(apply)
    } else {
      apply()
    }
  }, [])

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
    // Mit Top-Leiste synchron halten (Events + Polling-Fallback)
    const unsubscribe = window.api.onStatusChanged(() => {
      void load().catch(() => undefined)
    })
    const poll = window.setInterval(() => {
      void load().catch(() => undefined)
    }, 2000)
    return () => {
      unsubscribe()
      window.clearInterval(poll)
    }
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const stempelLive = useMemo(() => {
    if (!anwesenheit?.istOffen) {
      return anwesenheit
    }
    const kommenMs = new Date(anwesenheit.kommenAm).getTime()
    const bruttoSekunden = Math.max(0, Math.floor((now.getTime() - kommenMs) / 1000))
    let pausenSekunden = anwesenheit.pausenMinuten * 60
    if (anwesenheit.pauseSeit) {
      pausenSekunden += Math.max(
        0,
        Math.floor((now.getTime() - new Date(anwesenheit.pauseSeit).getTime()) / 1000)
      )
    }
    return {
      ...anwesenheit,
      bruttoSekunden,
      stempelSekunden: Math.max(0, bruttoSekunden - pausenSekunden)
    }
  }, [anwesenheit, now])

  const aktiverAuftrag = projekte.find((p) => p.timerLaeuft) ?? null

  /** Aktiver Track immer oben (nur Anzeige, Drag speichert die sichtbare Reihenfolge). */
  const angezeigteProjekte = useMemo(() => {
    const activeIdx = projekte.findIndex((p) => p.timerLaeuft)
    if (activeIdx <= 0) return projekte
    const next = [...projekte]
    const [active] = next.splice(activeIdx, 1)
    return [active, ...next]
  }, [projekte])

  async function handleKommen() {
    setError('')
    try {
      setAnwesenheit(await window.api.anwesenheit.kommen())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errCheckIn'))
    }
  }

  async function handleGehen() {
    setError('')
    try {
      setAnwesenheit(await window.api.anwesenheit.gehen())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errCheckOut'))
    }
  }

  async function handlePause() {
    setError('')
    try {
      setAnwesenheit(await window.api.anwesenheit.pauseToggle())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errPause'))
    }
  }

  async function persistAuftragOrder(next: ProjektMitZeit[]): Promise<void> {
    setProjekte(next)
    try {
      const all = await window.api.projekte.list(false)
      const activeIds = new Set(next.map((p) => p.id))
      const rest = all.filter((p) => !activeIds.has(p.id)).map((p) => p.id)
      await window.api.projekte.reorder([...next.map((p) => p.id), ...rest])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errReorder'))
      await load()
    }
  }

  function handleDragStart(projektId: number): void {
    dragIdRef.current = projektId
    setDragId(projektId)
  }

  function handleDragOver(event: DragEvent, targetId: number): void {
    event.preventDefault()
    if (dragIdRef.current != null && dragIdRef.current !== targetId) {
      setDragOverId(targetId)
    }
  }

  async function handleDrop(targetId: number): Promise<void> {
    const fromId = dragIdRef.current
    setDragOverId(null)
    setDragId(null)
    dragIdRef.current = null
    if (fromId == null || fromId === targetId) return

    const fromIndex = angezeigteProjekte.findIndex((p) => p.id === fromId)
    const toIndex = angezeigteProjekte.findIndex((p) => p.id === targetId)
    if (fromIndex < 0 || toIndex < 0) return

    const next = [...angezeigteProjekte]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    await persistAuftragOrder(next)
  }

  function handleDragEnd(): void {
    dragIdRef.current = null
    setDragId(null)
    setDragOverId(null)
  }

  function sapTopicStatusLabel(status: TagesThema['sapStatus']): string {
    if (status === 'ueberfuehrt') return t('stempel.sapOrderDone')
    if (status === 'gemischt') return t('stempel.sapOrderPartial')
    if (status === 'offen') return t('stempel.sapOrderOpen')
    return t('stempel.sapOrderOpen')
  }

  function isOrderTimerRunning(projekt: ProjektMitZeit): boolean {
    const empty = (projekt.themen ?? []).find((th) => !th.kurztext.trim())
    if (empty?.timerLaeuft) return true
    return Boolean(projekt.timerLaeuft && !(projekt.themen ?? []).some((th) => th.timerLaeuft))
  }

  function ohneKurztextThema(projekt: ProjektMitZeit): TagesThema | undefined {
    return (projekt.themen ?? []).find((th) => !th.kurztext.trim())
  }

  function namedThemen(projekt: ProjektMitZeit): TagesThema[] {
    return (projekt.themen ?? []).filter((th) => th.kurztext.trim().length > 0)
  }

  /** Heute-Gesamt = alle Kurztexte + Zeit ohne Kurztext (inkl. laufender Timer). */
  function projektHeuteGesamt(projekt: ProjektMitZeit): number {
    const fromThemen = (projekt.themen ?? []).reduce((sum, th) => sum + th.heuteMinuten, 0)
    return fromThemen > 0 ? fromThemen : projekt.heuteMinuten
  }

  function visibleThemen(projekt: ProjektMitZeit): TagesThema[] {
    const named = namedThemen(projekt)
    const ohne = ohneKurztextThema(projekt)
    if (
      ohne &&
      (ohne.heuteMinuten > 0 || ohne.timerLaeuft || ohne.heuteAbgeschlossenMinuten > 0)
    ) {
      return [...named, ohne]
    }
    return named
  }

  async function handleAuftragClick(projekt: ProjektMitZeit): Promise<void> {
    setError('')
    try {
      if (isOrderTimerRunning(projekt)) {
        await window.api.timer.stop()
        if (redistributeId === projekt.id) closeRedistribute()
      } else {
        if (redistributeId != null && redistributeId !== projekt.id) closeRedistribute()
        await window.api.timer.start(projekt.id, '')
      }
      await load({ animate: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errTimer'))
    }
  }

  async function handleThemaClick(projektId: number, thema: TagesThema): Promise<void> {
    setError('')
    try {
      if (thema.timerLaeuft) {
        await window.api.timer.stop()
      } else {
        await window.api.timer.start(projektId, thema.kurztext)
      }
      await load({ animate: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errTimer'))
    }
  }

  async function handleSapMarkAuftrag(projektId: number): Promise<void> {
    setError('')
    setSapMessage('')
    try {
      const count = await window.api.buchungen.markSapDatumProjekt(heuteIso(), projektId)
      setSapMessage(t('stempel.sapMarked', { count }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleSapClearAuftrag(projektId: number): Promise<void> {
    setError('')
    setSapMessage('')
    try {
      const count = await window.api.buchungen.clearSapDatumProjekt(heuteIso(), projektId)
      setSapMessage(t('stempel.sapCleared', { count }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  function sapOrderStatusLabel(status: ProjektMitZeit['heuteSapStatus']): string {
    if (status === 'ueberfuehrt') return t('stempel.sapOrderDone')
    if (status === 'gemischt') return t('stempel.sapOrderPartial')
    if (status === 'offen') return t('stempel.sapOrderOpen')
    return t('stempel.sapOrderOpen')
  }

  function openRedistribute(projekt: ProjektMitZeit): void {
    const available = ohneKurztextThema(projekt)?.heuteAbgeschlossenMinuten ?? 0
    if (available <= 0) return
    const rows = namedThemen(projekt).map((th) => ({
      key: `t-${th.kurztext}`,
      kurztext: th.kurztext,
      minuten: 0
    }))
    setRedistributeRows(rows)
    setRedistributeNewText('')
    setRedistributeId(projekt.id)
    setError('')
  }

  function closeRedistribute(): void {
    setRedistributeId(null)
    setRedistributeRows([])
    setRedistributeNewText('')
  }

  function setRedistributeMinuten(key: string, value: number, available: number): void {
    const raw = Math.max(0, Math.floor(value || 0))
    setRedistributeRows((prev) => {
      const others = prev.filter((r) => r.key !== key).reduce((sum, r) => sum + r.minuten, 0)
      const clamped = Math.min(raw, Math.max(0, available - others))
      return prev.map((r) => (r.key === key ? { ...r, minuten: clamped } : r))
    })
  }

  function addRedistributeTopic(available: number): void {
    const text = redistributeNewText.trim()
    if (!text) {
      setError(t('stempel.errTopicRequired'))
      return
    }
    if (redistributeRows.some((r) => r.kurztext === text)) {
      setRedistributeNewText('')
      return
    }
    const used = redistributeRows.reduce((sum, r) => sum + r.minuten, 0)
    if (used >= available) {
      setRedistributeRows((prev) => [...prev, { key: `t-${text}`, kurztext: text, minuten: 0 }])
    } else {
      setRedistributeRows((prev) => [
        ...prev,
        { key: `t-${text}`, kurztext: text, minuten: 0 }
      ])
    }
    setRedistributeNewText('')
    setError('')
  }

  async function applyRedistribute(projektId: number, available: number): Promise<void> {
    setError('')
    setSapMessage('')
    const allocations = redistributeRows.filter((r) => r.minuten > 0)
    const want = allocations.reduce((sum, r) => sum + r.minuten, 0)
    if (want <= 0) {
      closeRedistribute()
      return
    }
    if (want > available) {
      setError(t('err.redistributeTooMuch', { want, available }))
      return
    }
    try {
      const moved = await window.api.themen.redistribute(projektId, heuteIso(), allocations)
      setSapMessage(t('stempel.redistributeDone', { minutes: moved }))
      closeRedistribute()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errRedistribute'))
    }
  }

  async function handleAddThema(projektId: number): Promise<void> {
    setError('')
    const text = (topicDrafts[projektId] ?? '').trim()
    if (!text) {
      setError(t('stempel.errTopicRequired'))
      return
    }
    try {
      await window.api.themen.create(projektId, text)
      setTopicDrafts((prev) => ({ ...prev, [projektId]: '' }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errTopic'))
    }
  }

  async function handleRemoveThema(projektId: number, kurztext: string): Promise<void> {
    setError('')
    try {
      const ok = await window.api.themen.delete(projektId, kurztext)
      if (!ok) {
        setError(t('err.topicNotFound'))
        return
      }
      await load({ animate: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errTopic'))
    }
  }

  async function handleSapMarkThema(projektId: number, kurztext: string): Promise<void> {
    setError('')
    setSapMessage('')
    try {
      const count = await window.api.buchungen.markSapDatumProjektNotiz(
        heuteIso(),
        projektId,
        kurztext
      )
      setSapMessage(t('stempel.sapMarked', { count }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleSapClearThema(projektId: number, kurztext: string): Promise<void> {
    setError('')
    setSapMessage('')
    try {
      const count = await window.api.buchungen.clearSapDatumProjektNotiz(
        heuteIso(),
        projektId,
        kurztext
      )
      setSapMessage(t('stempel.sapCleared', { count }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleQuickCreate(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!quick.name.trim() || !quick.kuerzel.trim()) {
      setError(t('projects.errName'))
      return
    }
    if (!quick.auftragsnummer.trim() || !quick.arbeitsplatz.trim()) {
      setError(t('projects.errSap'))
      return
    }
    try {
      await window.api.projekte.create({
        name: quick.name,
        kuerzel: quick.kuerzel,
        auftragsnummer: quick.auftragsnummer,
        arbeitsplatz: quick.arbeitsplatz,
        empfaengerArt: quick.empfaengerArt,
        empfaenger: quick.empfaenger || quick.auftragsnummer,
        leistungsart: quick.leistungsart,
        aktiv: true
      })
      setQuick({
        name: '',
        kuerzel: '',
        auftragsnummer: '',
        arbeitsplatz: '',
        empfaengerArt: 'Innenauftrag',
        empfaenger: '',
        leistungsart: ''
      })
      setShowQuickCreate(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errCreate'))
    }
  }

  async function handleManualSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (manual.projektId === '') {
      setError('Bitte einen Auftrag wählen.')
      return
    }
    const dauerMinuten =
      Number(manual.dauerStunden || 0) * 60 + Number(manual.dauerMinuten || 0)
    if (dauerMinuten <= 0) {
      setError('Bitte eine Dauer größer 0 angeben.')
      return
    }
    try {
      const heute = new Date()
      const datum = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`
      await window.api.buchungen.create({
        projektId: manual.projektId,
        datum,
        dauerMinuten,
        notiz: manual.notiz,
        quelle: 'manuell'
      })
      setManual((prev) => ({ ...prev, dauerStunden: '1', dauerMinuten: '0', notiz: '' }))
      setShowManual(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errManual'))
    }
  }

  return (
    <div className="page stempel-page">
      <div className="page-header">
        <div>
          <h1>{t('stempel.title')}</h1>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setShowManual((v) => !v)}>
            {t('stempel.manual')}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setShowQuickCreate((v) => !v)
            }}
          >
            {t('stempel.newOrder')}
          </button>
          {onNeuerAuftrag && (
            <button className="btn btn-ghost" type="button" onClick={onNeuerAuftrag}>
              {t('stempel.toAdmin')}
            </button>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!personalnummer.trim() && (
        <p className="error">
          {t('stempel.personalMissing')}
        </p>
      )}
      <p className="muted">{t('stempel.personalLabel')}: {personalnummer.trim() || '–'}</p>
      {sapMessage && <p className="success">{sapMessage}</p>}

      <section className={`card stempel-kopf${stempelLive?.imPause ? ' pause' : ''}`}>
        <div className="stempel-zeiten">
          <div>
            <span className="stempel-label">{t('stempel.timeLabel')}</span>
            <div className="stempel-display">
              {formatSekunden(stempelLive?.stempelSekunden ?? 0)}
            </div>
            <div className="muted">
              {t('stempel.timeWithBreaks')} {formatSekunden(stempelLive?.bruttoSekunden ?? 0)}
              {' · '}
              {t('stempel.pause')}{' '}
              {formatSekunden(
                Math.max(
                  0,
                  (stempelLive?.bruttoSekunden ?? 0) - (stempelLive?.stempelSekunden ?? 0)
                )
              )}
            </div>
            <div className="muted">
              {t('stempel.autoPauseHint')}
            </div>
          </div>
          <div className="stempel-meta">
            {stempelLive ? (
              <>
                <span
                  className={`badge ${
                    stempelLive.istOffen
                      ? stempelLive.imPause
                        ? 'running'
                        : 'active'
                      : 'inactive'
                  }`}
                >
                  {stempelLive.istOffen
                    ? stempelLive.imPause
                      ? t('stempel.pause')
                      : t('stempel.present')
                    : t('stempel.doneToday')}
                </span>
                <div className="stempel-uhrzeiten">
                  <span>
                    {t('stempel.comeAt')}:{' '}
                    <strong>
                      {new Date(stempelLive.kommenAm).toLocaleTimeString(localeTag, {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </strong>
                  </span>
                  <span>
                    {t('stempel.leaveAt')}:{' '}
                    <strong>
                      {stempelLive.gehenAm
                        ? new Date(stempelLive.gehenAm).toLocaleTimeString(localeTag, {
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : '–'}
                    </strong>
                  </span>
                  {stempelLive.istOffen && stempelLive.imPause && stempelLive.pauseSeit && (
                    <span className="muted">
                      {t('stempel.pauseSince')}{' '}
                      {new Date(stempelLive.pauseSeit).toLocaleTimeString(localeTag, {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <span className="muted">{t('stempel.notCheckedIn')}</span>
            )}
          </div>
        </div>
        <div className="actions stempel-actions">
          <button
            className="btn btn-icon"
            type="button"
            disabled={!stempelLive?.istOffen || Boolean(stempelLive?.imPause && !aktiverAuftrag)}
            onClick={() => void handlePause()}
            title={
              aktiverAuftrag
                ? t('stempel.pauseTitleRunning')
                : t('stempel.pauseTitleIdle')
            }
            aria-label={aktiverAuftrag ? t('stempel.pauseOrder') : t('stempel.pause')}
          >
            <IconPause />
          </button>
          <button
            className="btn btn-success btn-icon"
            type="button"
            disabled={Boolean(stempelLive?.istOffen)}
            onClick={() => void handleKommen()}
            title={t('stempel.checkIn')}
            aria-label={t('stempel.checkIn')}
          >
            <IconLogin />
          </button>
          <button
            className="btn btn-danger btn-icon"
            type="button"
            disabled={!stempelLive?.istOffen}
            onClick={() => void handleGehen()}
            title={t('stempel.checkOut')}
            aria-label={t('stempel.checkOut')}
          >
            <IconLogout />
          </button>
        </div>
      </section>

      {showQuickCreate && (
        <section className="card">
          <h2>{t('stempel.newOrderTitle')}</h2>
          <form className="form-grid" onSubmit={(e) => void handleQuickCreate(e)}>
            <div className="field">
              <label htmlFor="q-name">{t('stempel.name')}</label>
              <input
                id="q-name"
                value={quick.name}
                onChange={(e) => setQuick((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="q-kuerzel">{t('stempel.code')}</label>
              <input
                id="q-kuerzel"
                value={quick.kuerzel}
                onChange={(e) => setQuick((p) => ({ ...p, kuerzel: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="q-auftrag">{t('stempel.orderNo')}</label>
              <input
                id="q-auftrag"
                value={quick.auftragsnummer}
                onChange={(e) => setQuick((p) => ({ ...p, auftragsnummer: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="q-ap">{t('stempel.workplace')}</label>
              <input
                id="q-ap"
                value={quick.arbeitsplatz}
                onChange={(e) => setQuick((p) => ({ ...p, arbeitsplatz: e.target.value }))}
                placeholder={t('stempel.workplacePh')}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="q-leist">{t('stempel.activityType')}</label>
              <input
                id="q-leist"
                value={quick.leistungsart}
                onChange={(e) => setQuick((p) => ({ ...p, leistungsart: e.target.value }))}
              />
            </div>
            <div className="actions" style={{ gridColumn: '1 / -1' }}>
              <button className="btn btn-primary" type="submit">
                {t('stempel.create')}
              </button>
              <button className="btn" type="button" onClick={() => setShowQuickCreate(false)}>
                {t('stempel.cancel')}
              </button>
            </div>
          </form>
        </section>
      )}

      {showManual && (
        <section className="card">
          <h2>{t('stempel.manualTitle')}</h2>
          <form className="form-grid" onSubmit={(e) => void handleManualSubmit(e)}>
            <div className="field full">
              <label htmlFor="m-proj">{t('stempel.order')}</label>
              <select
                id="m-proj"
                value={manual.projektId}
                onChange={(e) =>
                  setManual((p) => ({
                    ...p,
                    projektId: e.target.value ? Number(e.target.value) : ''
                  }))
                }
              >
                {projekte.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.kuerzel} – {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="m-h">{t('stempel.hours')}</label>
              <input
                id="m-h"
                type="number"
                min="0"
                value={manual.dauerStunden}
                onChange={(e) => setManual((p) => ({ ...p, dauerStunden: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="m-m">{t('stempel.minutes')}</label>
              <input
                id="m-m"
                type="number"
                min="0"
                max="59"
                value={manual.dauerMinuten}
                onChange={(e) => setManual((p) => ({ ...p, dauerMinuten: e.target.value }))}
              />
            </div>
            <div className="field full">
              <label htmlFor="m-notiz">{t('stempel.shortText')}</label>
              <input
                id="m-notiz"
                value={manual.notiz}
                onChange={(e) => setManual((p) => ({ ...p, notiz: e.target.value }))}
              />
            </div>
            <div className="actions" style={{ gridColumn: '1 / -1' }}>
              <button className="btn btn-primary" type="submit">
                {t('stempel.save')}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card auftrag-liste-card">
        <h2>{t('stempel.orders')}</h2>
        <p className="muted stempel-reorder-hint">{t('stempel.reorderHint')}</p>
        {projekte.length === 0 ? (
          <div className="empty">
            {t('stempel.noOrders')}
          </div>
        ) : (
          <ul className="auftrag-liste">
            {angezeigteProjekte.map((p) => {
              const isActive = isOrderTimerRunning(p) || p.timerLaeuft
              const sapDot =
                p.heuteAbgeschlossenMinuten > 0 && p.heuteSapStatus !== 'leer'
                  ? p.heuteSapStatus
                  : null
              return (
              <li
                key={p.id}
                className={`auftrag-item${dragOverId === p.id ? ' drag-over' : ''}${
                  dragId === p.id ? ' dragging' : ''
                }${isActive ? ' is-expanded' : ''}`}
                style={{ viewTransitionName: `auftrag-${p.id}` }}
                onDragOver={(e) => handleDragOver(e, p.id)}
                onDrop={() => void handleDrop(p.id)}
              >
                <div className={`auftrag-zeile${isActive ? ' aktiv' : ''}`}>
                  <div className="auftrag-compact">
                    <button
                      type="button"
                      className="auftrag-drag-handle"
                      draggable
                      title={t('stempel.dragReorder')}
                      aria-label={t('stempel.dragReorder')}
                      onDragStart={() => handleDragStart(p.id)}
                      onDragEnd={handleDragEnd}
                    >
                      ⋮⋮
                    </button>
                    <button
                      type="button"
                      className="auftrag-start auftrag-compact-start"
                      onClick={() => void handleAuftragClick(p)}
                      disabled={!stempelLive?.istOffen}
                      title={
                        !stempelLive?.istOffen
                          ? t('stempel.needCheckIn')
                          : isOrderTimerRunning(p)
                            ? t('stempel.stopOrder')
                            : stempelLive.imPause
                              ? t('stempel.startOrderPause')
                              : t('stempel.startOrder')
                      }
                    >
                      <span className="auftrag-compact-order">
                        {p.auftragsnummer || t('stempel.orderNoMissing')}
                      </span>
                      <span className="auftrag-compact-name" title={`${p.kuerzel} – ${p.name}`}>
                        {p.name}
                      </span>
                      <span className="auftrag-compact-time">
                        {formatDauer(projektHeuteGesamt(p))}
                      </span>
                      {sapDot && (
                        <span
                          className={`auftrag-compact-sap-dot sap-${sapDot}`}
                          title={sapOrderStatusLabel(sapDot)}
                          aria-hidden="true"
                        />
                      )}
                      {isActive && (
                        <span className="badge running">{t('stempel.running')}</span>
                      )}
                    </button>
                  </div>

                  <div
                    className={`auftrag-detail-wrap${isActive ? ' is-open' : ''}`}
                    aria-hidden={!isActive}
                  >
                    <div className="auftrag-detail-inner">
                    <div className="auftrag-detail">
                      {(projektHeuteGesamt(p) > 0 || p.heuteAbgeschlossenMinuten > 0) && (
                        <div className={`auftrag-sap sap-${p.heuteSapStatus}`}>
                          <div className="auftrag-sap-meta">
                            <span className="auftrag-sap-time">
                              <span className="auftrag-sap-label">{t('stempel.sapOrderToday')}</span>
                              <strong>{formatDauer(projektHeuteGesamt(p))}</strong>
                            </span>
                            {p.heuteAbgeschlossenMinuten > 0 && (
                              <span className={`badge sap-${p.heuteSapStatus}`}>
                                {sapOrderStatusLabel(p.heuteSapStatus)}
                              </span>
                            )}
                            {p.heuteSapUeberfuehrtAm && (
                              <span className="muted">
                                {t('stempel.sapAt', {
                                  when: formatDateTimeLocal(p.heuteSapUeberfuehrtAm, localeTag)
                                })}
                              </span>
                            )}
                            {p.timerLaeuft && p.heuteSapStatus === 'leer' && (
                              <span className="muted">{t('stempel.sapOrderRunningHint')}</span>
                            )}
                          </div>
                          <div className="auftrag-sap-actions">
                            {(ohneKurztextThema(p)?.heuteAbgeschlossenMinuten ?? 0) > 0 && (
                              <button
                                className={`btn btn-icon btn-small${
                                  redistributeId === p.id ? ' is-active' : ''
                                }`}
                                type="button"
                                title={t('stempel.redistribute')}
                                aria-label={t('stempel.redistribute')}
                                onClick={() =>
                                  redistributeId === p.id
                                    ? closeRedistribute()
                                    : openRedistribute(p)
                                }
                              >
                                <IconSplit />
                              </button>
                            )}
                            <button
                              className="btn btn-success btn-icon btn-small"
                              type="button"
                              title={t('stempel.sapOrderMark')}
                              aria-label={t('stempel.sapOrderMark')}
                              disabled={
                                p.heuteSapStatus === 'ueberfuehrt' ||
                                p.heuteSapStatus === 'leer' ||
                                p.heuteAbgeschlossenMinuten <= 0
                              }
                              onClick={() => void handleSapMarkAuftrag(p.id)}
                            >
                              <IconCheck />
                            </button>
                            <button
                              className="btn btn-ghost btn-icon btn-small"
                              type="button"
                              title={t('stempel.sapOrderClear')}
                              aria-label={t('stempel.sapOrderClear')}
                              disabled={p.heuteSapStatus === 'leer' || p.heuteSapStatus === 'offen'}
                              onClick={() => void handleSapClearAuftrag(p.id)}
                            >
                              <IconUndo />
                            </button>
                          </div>
                        </div>
                      )}

                      {redistributeId === p.id &&
                        (() => {
                          const available =
                            ohneKurztextThema(p)?.heuteAbgeschlossenMinuten ?? 0
                          const used = redistributeRows.reduce((sum, r) => sum + r.minuten, 0)
                          const rest = Math.max(0, available - used)
                          return (
                            <div className="auftrag-redistribute">
                              <div className="auftrag-themen-head">
                                {t('stempel.redistributeTitle')}
                              </div>
                              <p className="muted stempel-topic-none">
                                {t('stempel.redistributeHint')}
                              </p>
                              <div className="redistribute-meta">
                                <span>
                                  {t('stempel.redistributeAvailable')}:{' '}
                                  <strong>{formatDauer(available)}</strong>
                                </span>
                                <span>
                                  {t('stempel.redistributeRest')}:{' '}
                                  <strong>{formatDauer(rest)}</strong>
                                </span>
                              </div>
                              <ul className="redistribute-liste">
                                {redistributeRows.map((row) => (
                                  <li key={row.key} className="redistribute-row">
                                    <span className="redistribute-label">{row.kurztext}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={available}
                                      value={row.minuten}
                                      onChange={(e) =>
                                        setRedistributeMinuten(
                                          row.key,
                                          Number(e.target.value),
                                          available
                                        )
                                      }
                                    />
                                    <span className="muted">Min.</span>
                                  </li>
                                ))}
                              </ul>
                              <form
                                className="thema-add"
                                onSubmit={(e) => {
                                  e.preventDefault()
                                  addRedistributeTopic(available)
                                }}
                              >
                                <input
                                  value={redistributeNewText}
                                  placeholder={t('stempel.redistributeNew')}
                                  onChange={(e) => setRedistributeNewText(e.target.value)}
                                />
                                <button
                                  className="btn btn-icon btn-small"
                                  type="submit"
                                  title={t('stempel.topicAdd')}
                                  aria-label={t('stempel.topicAdd')}
                                >
                                  <IconPlus />
                                </button>
                              </form>
                              <div className="actions">
                                <button
                                  className="btn btn-primary btn-icon btn-small"
                                  type="button"
                                  disabled={used <= 0}
                                  title={t('stempel.redistributeApply')}
                                  aria-label={t('stempel.redistributeApply')}
                                  onClick={() => void applyRedistribute(p.id, available)}
                                >
                                  <IconCheck />
                                </button>
                                <button
                                  className="btn btn-ghost btn-icon btn-small"
                                  type="button"
                                  title={t('stempel.redistributeCancel')}
                                  aria-label={t('stempel.redistributeCancel')}
                                  onClick={closeRedistribute}
                                >
                                  <IconX />
                                </button>
                              </div>
                            </div>
                          )
                        })()}

                      <div className="auftrag-themen">
                        <div className="auftrag-themen-head">{t('stempel.topics')}</div>
                        {visibleThemen(p).length === 0 ? (
                          <p className="muted stempel-topic-none">{t('stempel.topicNone')}</p>
                        ) : (
                          <ul className="thema-liste">
                            {visibleThemen(p).map((thema) => (
                              <li
                                key={`${p.id}:${thema.kurztext || '__empty'}`}
                                className={`thema-item${thema.timerLaeuft ? ' aktiv' : ''}`}
                              >
                                <button
                                  type="button"
                                  className="thema-start"
                                  disabled={!stempelLive?.istOffen}
                                  title={
                                    !stempelLive?.istOffen
                                      ? t('stempel.needCheckIn')
                                      : thema.timerLaeuft
                                        ? t('stempel.topicStop')
                                        : t('stempel.topicStart')
                                  }
                                  onClick={() => void handleThemaClick(p.id, thema)}
                                >
                                  <span className="thema-play" aria-hidden="true">
                                    {thema.timerLaeuft ? '■' : '▶'}
                                  </span>
                                  <span className="thema-text">
                                    {thema.kurztext || t('stempel.topicEmpty')}
                                  </span>
                                  <span className="thema-zeit">{formatDauer(thema.heuteMinuten)}</span>
                                  {thema.timerLaeuft && (
                                    <span className="badge running">{t('stempel.running')}</span>
                                  )}
                                </button>
                                <div className="thema-sap">
                                  {thema.heuteMinuten > 0 && thema.sapStatus !== 'leer' && (
                                    <span className={`badge sap-${thema.sapStatus}`}>
                                      {sapTopicStatusLabel(thema.sapStatus)}
                                    </span>
                                  )}
                                  {thema.sapUeberfuehrtAm && (
                                    <span className="muted">
                                      {t('stempel.sapAt', {
                                        when: formatDateTimeLocal(thema.sapUeberfuehrtAm, localeTag)
                                      })}
                                    </span>
                                  )}
                                  <button
                                    className="btn btn-success btn-icon btn-small"
                                    type="button"
                                    title={t('stempel.sapOrderMark')}
                                    aria-label={t('stempel.sapOrderMark')}
                                    disabled={
                                      thema.sapStatus === 'ueberfuehrt' ||
                                      thema.sapStatus === 'leer'
                                    }
                                    onClick={() => void handleSapMarkThema(p.id, thema.kurztext)}
                                  >
                                    <IconCheck />
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-icon btn-small"
                                    type="button"
                                    title={t('stempel.sapOrderClear')}
                                    aria-label={t('stempel.sapOrderClear')}
                                    disabled={
                                      thema.sapStatus === 'leer' || thema.sapStatus === 'offen'
                                    }
                                    onClick={() => void handleSapClearThema(p.id, thema.kurztext)}
                                  >
                                    <IconUndo />
                                  </button>
                                  {Boolean(thema.kurztext.trim()) && !thema.timerLaeuft && (
                                    <button
                                      className="btn btn-ghost btn-icon btn-small"
                                      type="button"
                                      title={t('stempel.topicRemove')}
                                      aria-label={t('stempel.topicRemove')}
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        void handleRemoveThema(p.id, thema.kurztext)
                                      }}
                                    >
                                      <IconX />
                                    </button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                        <form
                          className="thema-add"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void handleAddThema(p.id)
                          }}
                        >
                          <input
                            value={topicDrafts[p.id] ?? ''}
                            placeholder={t('stempel.topicPlaceholder')}
                            onChange={(e) =>
                              setTopicDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                          />
                          <button
                            className="btn btn-primary btn-icon btn-small"
                            type="submit"
                            title={t('stempel.topicAdd')}
                            aria-label={t('stempel.topicAdd')}
                          >
                            <IconPlus />
                          </button>
                        </form>
                      </div>
                    </div>
                    </div>
                  </div>
                </div>
              </li>
              )
            })}
          </ul>
        )}
      </section>

      <footer className={`stempel-status${aktiverAuftrag ? ' aktiv' : ''}`}>
        {aktiverAuftrag
          ? t('stempel.statusActive', {
              name: (() => {
                const runningTopic = (aktiverAuftrag.themen ?? []).find(
                  (th) => th.timerLaeuft && th.kurztext.trim()
                )
                const base = `${aktiverAuftrag.auftragsnummer ? `${aktiverAuftrag.auftragsnummer} · ` : ''}${aktiverAuftrag.kuerzel} – ${aktiverAuftrag.name}`
                return runningTopic ? `${base} · ${runningTopic.kurztext}` : base
              })()
            })
          : stempelLive?.istOffen
            ? stempelLive.imPause
              ? t('stempel.statusPause')
              : t('stempel.statusPresent')
            : t('stempel.statusOut')}
      </footer>
    </div>
  )
}
