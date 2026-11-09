import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction
} from 'react'
import type {
  Anwesenheit,
  Projekt,
  SapTagesStatus,
  SapTransferStatus,
  VerbuchungsVorschlag,
  ZeitbuchungMitProjekt
} from '../../../shared/types'
import { IconCheck, IconEdit, IconUndo } from '../icons'
import { useI18n } from '../i18n'
import {
  addMonthsKey,
  buildMonthCells,
  formatDauer,
  formatDatumDe,
  formatZeitHm,
  heuteIso,
  istBuchungTeilweiseVerbucht,
  istBuchungVollVerbucht,
  monthEndIso,
  monthKeyFromIso,
  monthStartIso,
  sapOffenMinuten,
  sumVerbuchungByKurztext
} from '../utils'

type EditForm = {
  projektId: number
  notiz: string
  behaltenMinuten: string
  ausPauseMinuten: string
}

type PauseAllocForm = {
  projektId: number
  minuten: string
  notiz: string
}

type PresenceEditForm = {
  kommenZeit: string
  gehenZeit: string
}

function timeInputToMinutes(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const [h, m] = trimmed.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function toTimeInputFromIso(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

type DayTopicGroup = {
  key: string
  projektId: number
  kurztext: string
  minuten: number
  sapStatus: SapTransferStatus | 'leer'
  buchungen: ZeitbuchungMitProjekt[]
}

type DayProjektGroup = {
  key: string
  projektId: number
  projektName: string
  projektKuerzel: string
  auftragsnummer: string
  minuten: number
  sapStatus: SapTransferStatus | 'leer'
  buchungenCount: number
  themen: DayTopicGroup[]
}

function istAktiv(b: ZeitbuchungMitProjekt): boolean {
  return !b.geloeschtAm
}

function istAbgeschlossen(b: ZeitbuchungMitProjekt): boolean {
  if (!istAktiv(b)) return false
  return (
    b.endeZeit != null || (b.quelle === 'manuell' && b.dauerMinuten != null && b.dauerMinuten > 0)
  )
}

function buchungMinuten(b: ZeitbuchungMitProjekt): number {
  if (!istAktiv(b)) return 0
  return Math.max(0, b.dauerMinuten ?? 0)
}

function pauseMinutenGesamt(presence: Anwesenheit | null): number {
  if (!presence) return 0
  let minuten = presence.pausenMinuten
  if (presence.pauseSeit) {
    minuten += Math.max(
      0,
      Math.round((Date.now() - new Date(presence.pauseSeit).getTime()) / 60_000)
    )
  }
  return minuten
}

function pauseMinutenVerfuegbar(presence: Anwesenheit | null): number {
  return Math.max(0, pauseMinutenGesamt(presence))
}

function daySapStatus(buchungen: ZeitbuchungMitProjekt[]): SapTagesStatus['status'] {
  const completed = buchungen.filter(istAbgeschlossen)
  if (completed.length === 0) return 'leer'
  const voll = completed.filter((b) => istBuchungVollVerbucht(b)).length
  const teilweise = completed.filter((b) => istBuchungTeilweiseVerbucht(b)).length
  if (voll === 0 && teilweise === 0) return 'offen'
  if (voll === completed.length) return 'ueberfuehrt'
  return 'gemischt'
}

function sapStatusForGroup(buchungen: ZeitbuchungMitProjekt[]): SapTransferStatus | 'leer' {
  const completed = buchungen.filter(istAbgeschlossen)
  if (completed.length === 0) return 'leer'
  const voll = completed.filter((b) => istBuchungVollVerbucht(b)).length
  const teilweise = completed.filter((b) => istBuchungTeilweiseVerbucht(b)).length
  if (voll === 0 && teilweise === 0) return 'offen'
  if (voll === completed.length) return 'ueberfuehrt'
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

function groupByProjektThemen(buchungen: ZeitbuchungMitProjekt[]): DayProjektGroup[] {
  const projects = new Map<
    number,
    {
      projektId: number
      projektName: string
      projektKuerzel: string
      auftragsnummer: string
      topics: Map<string, ZeitbuchungMitProjekt[]>
    }
  >()

  for (const b of buchungen) {
    let project = projects.get(b.projektId)
    if (!project) {
      project = {
        projektId: b.projektId,
        projektName: b.projektName,
        projektKuerzel: b.projektKuerzel,
        auftragsnummer: b.auftragsnummer,
        topics: new Map()
      }
      projects.set(b.projektId, project)
    }
    const kurztext = (b.notiz ?? '').trim()
    const list = project.topics.get(kurztext) ?? []
    list.push(b)
    project.topics.set(kurztext, list)
  }

  return Array.from(projects.values())
    .map((p) => {
      const themen: DayTopicGroup[] = Array.from(p.topics.entries())
        .map(([kurztext, items]) => ({
          key: groupKey(p.projektId, kurztext),
          projektId: p.projektId,
          kurztext,
          minuten: items.reduce((sum, b) => sum + buchungMinuten(b), 0),
          sapStatus: sapStatusForGroup(items),
          buchungen: sortBuchungen(items)
        }))
        .sort((a, b) => a.kurztext.localeCompare(b.kurztext, 'de'))
      const allItems = themen.flatMap((t) => t.buchungen)
      return {
        key: String(p.projektId),
        projektId: p.projektId,
        projektName: p.projektName,
        projektKuerzel: p.projektKuerzel,
        auftragsnummer: p.auftragsnummer,
        minuten: themen.reduce((sum, t) => sum + t.minuten, 0),
        sapStatus: sapStatusForGroup(allItems),
        buchungenCount: allItems.length,
        themen
      }
    })
    .sort((a, b) => a.projektKuerzel.localeCompare(b.projektKuerzel, 'de'))
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
  const [expandedProjektKeys, setExpandedProjektKeys] = useState<Set<string>>(() => new Set())
  const [expandedTopicKeys, setExpandedTopicKeys] = useState<Set<string>>(() => new Set())
  const [loadingMonth, setLoadingMonth] = useState(true)
  const [loadingDay, setLoadingDay] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editBuchung, setEditBuchung] = useState<ZeitbuchungMitProjekt | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [pauseAllocForm, setPauseAllocForm] = useState<PauseAllocForm | null>(null)
  const [pauseAllocError, setPauseAllocError] = useState('')
  const [pauseAllocSaving, setPauseAllocSaving] = useState(false)
  const [verbuchenVorschlag, setVerbuchenVorschlag] = useState<VerbuchungsVorschlag | null>(null)
  const [verbuchenLabel, setVerbuchenLabel] = useState('')
  const [verbuchenSaving, setVerbuchenSaving] = useState(false)
  const [verbuchenError, setVerbuchenError] = useState('')
  const [dayPresence, setDayPresence] = useState<Anwesenheit | null>(null)
  const [presenceForm, setPresenceForm] = useState<PresenceEditForm | null>(null)
  const [presenceError, setPresenceError] = useState('')
  const [presenceSaving, setPresenceSaving] = useState(false)
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
        const [rows, presence] = await Promise.all([
          window.api.buchungen.listByDatum(datum),
          window.api.anwesenheit.getByDatum(datum)
        ])
        setDayBuchungen(rows)
        setDayPresence(presence)
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
    setExpandedProjektKeys(new Set())
    setExpandedTopicKeys(new Set())
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
    if (buchung.geloeschtAm) {
      setError(t('week.errAdjustDeleted'))
      return
    }
    if (!istAbgeschlossen(buchung)) {
      setError(t('week.errAdjustRunning'))
      return
    }
    setEditError('')
    setEditBuchung(buchung)
    setEditForm({
      projektId: buchung.projektId,
      notiz: buchung.notiz ?? '',
      behaltenMinuten: String(Math.max(0, buchung.dauerMinuten ?? 0)),
      ausPauseMinuten: '0'
    })
  }

  function closeEdit(): void {
    if (editSaving) return
    setEditBuchung(null)
    setEditForm(null)
    setEditError('')
  }

  function openPauseAlloc(): void {
    setPauseAllocError('')
    const first = projekte[0]
    setPauseAllocForm({
      projektId: first?.id ?? 0,
      minuten: '',
      notiz: ''
    })
  }

  function closePauseAlloc(): void {
    if (pauseAllocSaving) return
    setPauseAllocForm(null)
    setPauseAllocError('')
  }

  function openPresenceEdit(): void {
    setPresenceError('')
    setPresenceForm({
      kommenZeit: toTimeInputFromIso(dayPresence?.kommenAm) || '08:00',
      gehenZeit: toTimeInputFromIso(dayPresence?.gehenAm)
    })
  }

  function closePresenceEdit(): void {
    if (presenceSaving) return
    setPresenceForm(null)
    setPresenceError('')
  }

  async function handlePresenceSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!presenceForm) return
    setPresenceError('')
    if (!presenceForm.kommenZeit.trim()) {
      setPresenceError(t('err.kommenRequired'))
      return
    }
    setPresenceSaving(true)
    try {
      await window.api.anwesenheit.upsertForDatum(selectedDate, {
        kommenZeit: presenceForm.kommenZeit,
        gehenZeit: presenceForm.gehenZeit.trim() ? presenceForm.gehenZeit : null,
        pausenMinuten: 0
      })
      setPresenceForm(null)
      setMessage(t('week.presenceSaved'))
      await refreshQuietly()
    } catch (err) {
      setPresenceError(err instanceof Error ? err.message : t('week.errPresenceEdit'))
    } finally {
      setPresenceSaving(false)
    }
  }

  async function applyAdjust(input: {
    projektId: number
    notiz: string
    behaltenMinuten: number
    ausPauseMinuten: number
    successKey: 'week.adjustSaved' | 'week.adjustDeletedDone'
  }): Promise<void> {
    if (!editBuchung) return
    setEditSaving(true)
    try {
      await window.api.buchungen.adjust(editBuchung.id, {
        projektId: input.projektId,
        notiz: input.notiz,
        behaltenMinuten: input.behaltenMinuten,
        ausPauseMinuten: input.ausPauseMinuten
      })
      setEditBuchung(null)
      setEditForm(null)
      setMessage(t(input.successKey))
      await refreshQuietly()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t('week.errEdit'))
    } finally {
      setEditSaving(false)
    }
  }

  async function handleEditSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!editBuchung || !editForm) return
    setEditError('')
    if (!editForm.projektId) {
      setEditError(t('week.errEdit'))
      return
    }
    const original = Math.max(0, editBuchung.dauerMinuten ?? 0)
    const behalten = Math.round(Number(editForm.behaltenMinuten))
    const ausPause = Math.round(Number(editForm.ausPauseMinuten || 0))
    if (!Number.isFinite(behalten) || behalten < 0 || behalten > original) {
      setEditError(t('week.errEdit'))
      return
    }
    if (!Number.isFinite(ausPause) || ausPause < 0) {
      setEditError(t('week.errEdit'))
      return
    }
    await applyAdjust({
      projektId: editForm.projektId,
      notiz: editForm.notiz,
      behaltenMinuten: behalten,
      ausPauseMinuten: ausPause,
      successKey: 'week.adjustSaved'
    })
  }

  async function handleDeleteBuchung(): Promise<void> {
    if (!editBuchung || !editForm || editSaving) return
    setEditError('')
    await applyAdjust({
      projektId: editForm.projektId,
      notiz: editForm.notiz,
      behaltenMinuten: 0,
      ausPauseMinuten: 0,
      successKey: 'week.adjustDeletedDone'
    })
  }

  async function handlePauseAllocSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!pauseAllocForm) return
    setPauseAllocError('')
    const minuten = Math.round(Number(pauseAllocForm.minuten))
    if (!pauseAllocForm.projektId || !Number.isFinite(minuten) || minuten <= 0) {
      setPauseAllocError(t('err.pauseAllocateEmpty'))
      return
    }
    setPauseAllocSaving(true)
    try {
      const moved = await window.api.anwesenheit.allocatePause(selectedDate, [
        {
          projektId: pauseAllocForm.projektId,
          minuten,
          notiz: pauseAllocForm.notiz
        }
      ])
      setPauseAllocForm(null)
      setMessage(t('week.allocatePauseDone', { minutes: moved }))
      await refreshQuietly()
    } catch (err) {
      setPauseAllocError(err instanceof Error ? err.message : t('week.errEdit'))
    } finally {
      setPauseAllocSaving(false)
    }
  }

  async function openVerbuchen(group: DayProjektGroup): Promise<void> {
    setError('')
    setVerbuchenError('')
    try {
      const vorschlag = await window.api.buchungen.verbuchungsVorschlag(
        group.projektId,
        selectedDate
      )
      if (vorschlag.zeilen.length === 0) {
        setError(t('stempel.verbuchenEmpty'))
        return
      }
      setVerbuchenLabel(
        `${group.auftragsnummer ? `${group.auftragsnummer} · ` : ''}${group.projektKuerzel}`
      )
      setVerbuchenVorschlag(vorschlag)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('week.errLoad'))
    }
  }

  function closeVerbuchen(): void {
    if (verbuchenSaving) return
    setVerbuchenVorschlag(null)
    setVerbuchenLabel('')
    setVerbuchenError('')
  }

  async function handleVerbuchenApply(): Promise<void> {
    if (!verbuchenVorschlag) return
    setVerbuchenError('')
    setVerbuchenSaving(true)
    try {
      const count = await window.api.buchungen.applyVerbuchung(
        verbuchenVorschlag.projektId,
        verbuchenVorschlag.datum
      )
      setVerbuchenVorschlag(null)
      setVerbuchenLabel('')
      setMessage(t('stempel.verbuchenDone', { count }))
      await refreshQuietly()
    } catch (err) {
      setVerbuchenError(err instanceof Error ? err.message : t('week.errLoad'))
    } finally {
      setVerbuchenSaving(false)
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
        verbuchungsProzent: 100,
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

  async function handleSapMarkProjekt(group: DayProjektGroup): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.markSapDatumProjekt(
        selectedDate,
        group.projektId
      )
      setMessage(t('stempel.sapMarked', { count }))
      await refreshQuietly()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleSapClearProjekt(group: DayProjektGroup): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.clearSapDatumProjekt(
        selectedDate,
        group.projektId
      )
      setMessage(t('stempel.sapCleared', { count }))
      await refreshQuietly()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleSapMarkTopic(topic: DayTopicGroup): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.markSapDatumProjektNotiz(
        selectedDate,
        topic.projektId,
        topic.kurztext
      )
      setMessage(t('stempel.sapMarked', { count }))
      await refreshQuietly()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleSapClearTopic(topic: DayTopicGroup): Promise<void> {
    setError('')
    setMessage('')
    try {
      const count = await window.api.buchungen.clearSapDatumProjektNotiz(
        selectedDate,
        topic.projektId,
        topic.kurztext
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

  function toggleKey(setter: Dispatch<SetStateAction<Set<string>>>, key: string): void {
    setter((prev) => {
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
  const dayPauseTotal = useMemo(() => pauseMinutenGesamt(dayPresence), [dayPresence])
  const dayPauseAvail = useMemo(() => pauseMinutenVerfuegbar(dayPresence), [dayPresence])
  const dayPresent = useMemo(() => {
    if (dayPresence) return Math.floor(dayPresence.stempelSekunden / 60)
    return monthPresent[selectedDate] ?? 0
  }, [dayPresence, monthPresent, selectedDate])
  const groups = useMemo(() => groupByProjektThemen(dayBuchungen), [dayBuchungen])
  const sapStatus = useMemo(() => daySapStatus(dayBuchungen), [dayBuchungen])
  const sapLabel = sapDayLabel(sapStatus)
  const presencePausePreview = useMemo(() => {
    if (!presenceForm) return null
    const kommen = timeInputToMinutes(presenceForm.kommenZeit)
    if (kommen == null) return null
    let gehen = timeInputToMinutes(presenceForm.gehenZeit)
    if (gehen == null && selectedDate === today) {
      const now = new Date()
      gehen = now.getHours() * 60 + now.getMinutes()
    }
    if (gehen == null) return null
    const brutto = Math.max(0, gehen - kommen)
    return brutto - dayTotal
  }, [presenceForm, selectedDate, today, dayTotal])
  const editOriginalMinuten = editBuchung ? Math.max(0, editBuchung.dauerMinuten ?? 0) : 0
  const editBehalten = Math.max(0, Math.round(Number(editForm?.behaltenMinuten || 0)) || 0)
  const editAusPause = Math.max(0, Math.round(Number(editForm?.ausPauseMinuten || 0)) || 0)
  const editZuPause = Math.max(0, editOriginalMinuten - Math.min(editBehalten, editOriginalMinuten))
  const editErgebnis = Math.min(editBehalten, editOriginalMinuten) + editAusPause

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
            {weekdayLabels.map((label, index) => (
              <span
                key={label}
                className={`month-weekday${index >= 5 ? ' is-weekend' : ''}`}
              >
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
              const weekday = new Date(`${cell.datum}T00:00:00`).getDay()
              const isWeekend = weekday === 0 || weekday === 6
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
                    isWeekend ? 'is-weekend' : '',
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
              {dayPauseAvail > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={openPauseAlloc}
                >
                  {t('week.allocatePause')}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={openPresenceEdit}
              >
                {t('week.editPresence')}
              </button>
            </div>
          </div>
          {dayPresence && (
            <p className="muted day-presence-times">
              {dayPresence.gehenAm
                ? t('week.presenceTimes', {
                    kommen: formatZeitHm(toTimeInputFromIso(dayPresence.kommenAm)),
                    gehen: formatZeitHm(toTimeInputFromIso(dayPresence.gehenAm))
                  })
                : t('week.presenceOpen', {
                    kommen: formatZeitHm(toTimeInputFromIso(dayPresence.kommenAm))
                  })}
              {` · ${t('week.colPauseMin')}: ${dayPauseTotal}`}
            </p>
          )}

          {loadingDay ? (
            <p className="muted">{t('week.loading')}</p>
          ) : groups.length === 0 ? (
            <div className="empty">{t('week.noBookings')}</div>
          ) : (
            <div className="day-groups">
              {groups.map((g) => {
                const open = expandedProjektKeys.has(g.key)
                const canMarkProjekt = g.sapStatus === 'offen' || g.sapStatus === 'gemischt'
                const canClearProjekt =
                  g.sapStatus === 'ueberfuehrt' || g.sapStatus === 'gemischt'
                return (
                  <div key={g.key} className={`day-group${open ? ' is-open' : ''}`}>
                    <div className="day-group-header">
                      <button
                        type="button"
                        className="day-group-summary"
                        aria-expanded={open}
                        onClick={() => toggleKey(setExpandedProjektKeys, g.key)}
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
                          <span className="day-group-topic">
                            {t('week.topics', { count: g.themen.length })}
                          </span>
                        </span>
                        <span className="day-group-meta">
                          <span className="muted">
                            {t('week.entries', { count: g.buchungenCount })}
                          </span>
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
                          className="btn btn-primary btn-small"
                          type="button"
                          title={t('stempel.verbuchen')}
                          disabled={!canMarkProjekt}
                          onClick={() => void openVerbuchen(g)}
                        >
                          {t('stempel.verbuchen')}
                        </button>
                        <button
                          className="btn btn-success btn-icon btn-small"
                          type="button"
                          title={t('week.sapMark')}
                          aria-label={t('week.sapMark')}
                          disabled={!canMarkProjekt}
                          onClick={() => void handleSapMarkProjekt(g)}
                        >
                          <IconCheck />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-small"
                          type="button"
                          title={t('week.sapClear')}
                          aria-label={t('week.sapClear')}
                          disabled={!canClearProjekt}
                          onClick={() => void handleSapClearProjekt(g)}
                        >
                          <IconUndo />
                        </button>
                      </div>
                    </div>
                    {open && (
                      <div className="day-group-body">
                        <div className="day-topics">
                          {g.themen.map((topic) => {
                            const topicOpen = expandedTopicKeys.has(topic.key)
                            const topicLabel = topic.kurztext || t('stempel.topicEmpty')
                            const canMarkTopic =
                              topic.sapStatus === 'offen' || topic.sapStatus === 'gemischt'
                            const canClearTopic =
                              topic.sapStatus === 'ueberfuehrt' || topic.sapStatus === 'gemischt'
                            return (
                              <div
                                key={topic.key}
                                className={`day-topic${topicOpen ? ' is-open' : ''}`}
                              >
                                <div className="day-topic-header">
                                  <button
                                    type="button"
                                    className="day-topic-summary"
                                    aria-expanded={topicOpen}
                                    onClick={() =>
                                      toggleKey(setExpandedTopicKeys, topic.key)
                                    }
                                  >
                                    <span className="day-group-chevron" aria-hidden="true">
                                      {topicOpen ? '▾' : '▸'}
                                    </span>
                                    <span className="day-group-main">
                                      <strong>{topicLabel}</strong>
                                    </span>
                                    <span className="day-group-meta">
                                      <span className="muted">
                                        {t('week.entries', {
                                          count: topic.buchungen.length
                                        })}
                                      </span>
                                      <span className="day-group-sum">
                                        {formatDauer(topic.minuten)}
                                      </span>
                                    </span>
                                  </button>
                                  <div className="day-group-sap">
                                    {topic.sapStatus !== 'leer' && (
                                      <span className={`badge sap-${topic.sapStatus}`}>
                                        {sapDayLabel(topic.sapStatus)}
                                      </span>
                                    )}
                                    <button
                                      className="btn btn-success btn-icon btn-small"
                                      type="button"
                                      title={t('week.sapMark')}
                                      aria-label={t('week.sapMark')}
                                      disabled={!canMarkTopic}
                                      onClick={() => void handleSapMarkTopic(topic)}
                                    >
                                      <IconCheck />
                                    </button>
                                    <button
                                      className="btn btn-ghost btn-icon btn-small"
                                      type="button"
                                      title={t('week.sapClear')}
                                      aria-label={t('week.sapClear')}
                                      disabled={!canClearTopic}
                                      onClick={() => void handleSapClearTopic(topic)}
                                    >
                                      <IconUndo />
                                    </button>
                                  </div>
                                </div>
                                {topicOpen && (
                                  <div className="day-topic-body">
                                    <table className="day-bookings-table">
                                      <thead>
                                        <tr>
                                          <th>{t('week.colFrom')}</th>
                                          <th>{t('week.colTo')}</th>
                                          <th>{t('week.colDuration')}</th>
                                          <th>{t('week.colSap')}</th>
                                          <th className="day-col-actions">
                                            {t('week.colActions')}
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {topic.buchungen.map((b) => {
                                          const completed = istAbgeschlossen(b)
                                          const dauer = Math.max(0, b.dauerMinuten ?? 0)
                                          const verbucht = Math.max(
                                            0,
                                            b.sapVerbuchtMinuten ?? 0
                                          )
                                          const voll = istBuchungVollVerbucht(b)
                                          const teilweise = istBuchungTeilweiseVerbucht(b)
                                          const hasOpen = sapOffenMinuten(b) > 0
                                          const deleted = Boolean(b.geloeschtAm)
                                          const hasClock = Boolean(b.startZeit || b.endeZeit)
                                          return (
                                            <tr
                                              key={b.id}
                                              className={`day-booking-row${
                                                deleted ? ' is-deleted' : ''
                                              }`}
                                              title={
                                                deleted ? t('week.adjustDeleted') : undefined
                                              }
                                            >
                                              <td>
                                                {hasClock
                                                  ? formatZeitHm(b.startZeit)
                                                  : t('week.adjustManual')}
                                              </td>
                                              <td>
                                                {hasClock ? formatZeitHm(b.endeZeit) : '—'}
                                              </td>
                                              <td>
                                                {formatDauer(dauer)}
                                                {deleted
                                                  ? ` · ${t('week.adjustDeleted')}`
                                                  : voll
                                                    ? ' ✓'
                                                    : teilweise
                                                      ? ` · ${t('week.sapPartialOf', {
                                                          booked: formatDauer(verbucht),
                                                          total: formatDauer(dauer)
                                                        })}`
                                                      : ''}
                                              </td>
                                              <td>
                                                <div className="day-entry-sap">
                                                  <button
                                                    className="btn btn-success btn-icon btn-small"
                                                    type="button"
                                                    title={t('week.sapMark')}
                                                    aria-label={t('week.sapMark')}
                                                    disabled={
                                                      deleted || !completed || !hasOpen
                                                    }
                                                    onClick={() =>
                                                      void handleSapMarkEntry(b)
                                                    }
                                                  >
                                                    <IconCheck />
                                                  </button>
                                                  <button
                                                    className="btn btn-ghost btn-icon btn-small"
                                                    type="button"
                                                    title={t('week.sapClear')}
                                                    aria-label={t('week.sapClear')}
                                                    disabled={deleted || verbucht <= 0}
                                                    onClick={() =>
                                                      void handleSapClearEntry(b)
                                                    }
                                                  >
                                                    <IconUndo />
                                                  </button>
                                                </div>
                                              </td>
                                              <td className="day-col-actions">
                                                <button
                                                  className="btn btn-ghost btn-icon btn-small"
                                                  type="button"
                                                  title={t('week.editEntry')}
                                                  aria-label={t('week.editEntry')}
                                                  disabled={deleted || !completed}
                                                  onClick={() => openEdit(b)}
                                                >
                                                  <IconEdit />
                                                </button>
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
            <p className="muted">{t('week.adjustHint')}</p>
            <p className="muted">
              {t('week.adjustOriginal')}: {formatDauer(editOriginalMinuten)}
              {editBuchung.startZeit || editBuchung.endeZeit
                ? ` · ${formatZeitHm(editBuchung.startZeit)} – ${formatZeitHm(editBuchung.endeZeit)}`
                : ` · ${t('week.adjustManual')}`}
              {` · ${t('week.adjustPauseAvail')}: ${formatDauer(dayPauseAvail)}`}
            </p>
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
                <label htmlFor="week-edit-keep">{t('week.adjustKeep')}</label>
                <input
                  id="week-edit-keep"
                  type="number"
                  min={0}
                  max={editOriginalMinuten}
                  step={1}
                  value={editForm.behaltenMinuten}
                  onChange={(e) =>
                    setEditForm((prev) =>
                      prev ? { ...prev, behaltenMinuten: e.target.value } : prev
                    )
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="week-edit-to-pause">{t('week.adjustToPause')}</label>
                <input
                  id="week-edit-to-pause"
                  type="number"
                  readOnly
                  value={editZuPause}
                />
              </div>
              <div className="field">
                <label htmlFor="week-edit-from-pause">{t('week.adjustFromPause')}</label>
                <input
                  id="week-edit-from-pause"
                  type="number"
                  min={0}
                  max={dayPauseAvail}
                  step={1}
                  value={editForm.ausPauseMinuten}
                  onChange={(e) =>
                    setEditForm((prev) =>
                      prev ? { ...prev, ausPauseMinuten: e.target.value } : prev
                    )
                  }
                />
              </div>
              <div className="field">
                <label>{t('week.adjustResult')}</label>
                <input type="text" readOnly value={formatDauer(editErgebnis)} />
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
              <div className="actions full week-edit-actions">
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => void handleDeleteBuchung()}
                  disabled={editSaving}
                >
                  {t('week.adjustDelete')}
                </button>
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

      {pauseAllocForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closePauseAlloc()
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="week-pause-alloc-title"
          >
            <h2 id="week-pause-alloc-title">{t('week.allocatePauseTitle')}</h2>
            <p className="muted">{t('week.allocatePauseHint')}</p>
            <p className="muted">
              {t('week.adjustPauseAvail')}: <strong>{formatDauer(dayPauseAvail)}</strong>
            </p>
            <form className="form-grid" onSubmit={(e) => void handlePauseAllocSubmit(e)}>
              <div className="field full">
                <label htmlFor="week-pause-projekt">{t('week.colProject')}</label>
                <select
                  id="week-pause-projekt"
                  value={pauseAllocForm.projektId}
                  onChange={(e) =>
                    setPauseAllocForm((prev) =>
                      prev ? { ...prev, projektId: Number(e.target.value) } : prev
                    )
                  }
                >
                  {projekte.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.auftragsnummer ? `${p.auftragsnummer} · ` : ''}
                      {p.kuerzel} – {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="week-pause-min">{t('week.colDuration')}</label>
                <input
                  id="week-pause-min"
                  type="number"
                  min={1}
                  max={dayPauseAvail}
                  step={1}
                  value={pauseAllocForm.minuten}
                  onChange={(e) =>
                    setPauseAllocForm((prev) =>
                      prev ? { ...prev, minuten: e.target.value } : prev
                    )
                  }
                />
              </div>
              <div className="field full">
                <label htmlFor="week-pause-notiz">{t('week.colTopic')}</label>
                <input
                  id="week-pause-notiz"
                  type="text"
                  value={pauseAllocForm.notiz}
                  onChange={(e) =>
                    setPauseAllocForm((prev) =>
                      prev ? { ...prev, notiz: e.target.value } : prev
                    )
                  }
                />
              </div>
              {pauseAllocError && <p className="error full">{pauseAllocError}</p>}
              <div className="actions full">
                <button
                  className="btn"
                  type="button"
                  onClick={closePauseAlloc}
                  disabled={pauseAllocSaving}
                >
                  {t('week.editCancel')}
                </button>
                <button className="btn btn-primary" type="submit" disabled={pauseAllocSaving}>
                  {t('week.allocatePauseApply')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {presenceForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closePresenceEdit()
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="week-presence-title"
          >
            <h2 id="week-presence-title">{t('week.editPresenceTitle')}</h2>
            <p className="muted">{t('week.editPresenceHint')}</p>
            <form className="form-grid" onSubmit={(e) => void handlePresenceSubmit(e)}>
              <div className="field">
                <label htmlFor="week-presence-kommen">{t('week.colKommen')}</label>
                <input
                  id="week-presence-kommen"
                  type="time"
                  value={presenceForm.kommenZeit}
                  onChange={(e) =>
                    setPresenceForm((prev) =>
                      prev ? { ...prev, kommenZeit: e.target.value } : prev
                    )
                  }
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="week-presence-gehen">{t('week.colGehen')}</label>
                <input
                  id="week-presence-gehen"
                  type="time"
                  value={presenceForm.gehenZeit}
                  onChange={(e) =>
                    setPresenceForm((prev) =>
                      prev ? { ...prev, gehenZeit: e.target.value } : prev
                    )
                  }
                />
              </div>
              <div className="field full">
                <label>{t('week.colPauseMin')}</label>
                <input
                  type="text"
                  readOnly
                  value={
                    presencePausePreview == null
                      ? '—'
                      : `${presencePausePreview < 0 ? '−' : ''}${formatDauer(
                          Math.abs(presencePausePreview)
                        )} (${presencePausePreview} Min.)`
                  }
                />
                <p className="muted field-hint">{t('week.presencePauseAuto')}</p>
              </div>
              {presenceError && <p className="error full">{presenceError}</p>}
              <div className="actions full">
                <button
                  className="btn"
                  type="button"
                  onClick={closePresenceEdit}
                  disabled={presenceSaving}
                >
                  {t('week.editCancel')}
                </button>
                <button className="btn btn-primary" type="submit" disabled={presenceSaving}>
                  {t('week.presenceSave')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {verbuchenVorschlag && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget && !verbuchenSaving) closeVerbuchen()
          }}
        >
          <div
            className="modal-card modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="week-verbuchen-title"
          >
            <h2 id="week-verbuchen-title">
              {t('stempel.verbuchenTitle', { percent: verbuchenVorschlag.prozent })}
            </h2>
            <p className="muted">{verbuchenLabel}</p>
            <p className="muted">{t('stempel.verbuchenHint')}</p>
            <div className="table-wrap">
              <table className="verbuchen-table">
                <thead>
                  <tr>
                    <th>{t('stempel.verbuchenColDate')}</th>
                    <th>{t('stempel.verbuchenColTopic')}</th>
                    <th>{t('stempel.verbuchenColIst')}</th>
                    <th>{t('stempel.verbuchenColSoll')}</th>
                  </tr>
                </thead>
                <tbody>
                  {verbuchenVorschlag.zeilen.map((z, index) => (
                    <tr key={`${z.datum ?? selectedDate}::${z.kurztext || '__empty'}::${index}`}>
                      <td>{formatDatumDe(z.datum ?? selectedDate)}</td>
                      <td>{z.kurztext || t('stempel.verbuchenTopicEmpty')}</td>
                      <td>{formatDauer(z.unverbuchtMinuten ?? 0)}</td>
                      <td>
                        <strong>{formatDauer(z.sollMinuten ?? 0)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {sumVerbuchungByKurztext(verbuchenVorschlag.zeilen).map((s) => (
                    <tr key={`sum::${s.kurztext || '__empty'}`} className="verbuchen-sum-row">
                      <td colSpan={2}>
                        {t('stempel.verbuchenSumTopic', {
                          topic: s.kurztext || t('stempel.verbuchenTopicEmpty')
                        })}
                      </td>
                      <td>{formatDauer(s.unverbuchtMinuten)}</td>
                      <td>
                        <strong>{formatDauer(s.sollMinuten)}</strong>
                      </td>
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
            {verbuchenError && <p className="error">{verbuchenError}</p>}
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={verbuchenSaving}
                onClick={closeVerbuchen}
              >
                {t('stempel.verbuchenCancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  verbuchenSaving ||
                  verbuchenVorschlag.zeilen.every((z) => (z.allocations?.length ?? 0) === 0)
                }
                onClick={() => void handleVerbuchenApply()}
              >
                {t('stempel.verbuchenApply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
