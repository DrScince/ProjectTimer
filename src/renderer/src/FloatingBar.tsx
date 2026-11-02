import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FloatingBarStatus } from '../../shared/types'
import { useI18n } from './i18n'
import { formatDauer, formatSekunden, laufendeSekunden } from './utils'

export default function FloatingBar() {
  const { t } = useI18n()
  const [status, setStatus] = useState<FloatingBarStatus | null>(null)
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [dragging, setDragging] = useState(false)
  const dragOffset = useRef<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const activePointerId = useRef<number | null>(null)

  const load = useCallback(async () => {
    const data = await window.api.floating.getStatus()
    setStatus(data)
    setSelectedId((prev) => {
      if (data.timer) return data.timer.projektId
      if (prev !== '') return prev
      return data.projekte[0]?.id ?? ''
    })
  }, [])

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
    const unsubscribe = window.api.onStatusChanged(() => {
      void load().catch(() => undefined)
    })
    const poll = window.setInterval(() => {
      void load().catch(() => undefined)
    }, 2000)
    const tick = window.setInterval(() => setNow(new Date()), 1000)
    return () => {
      unsubscribe()
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
  }, [load])

  const laufend = status?.timer ?? null
  const liveSekunden = useMemo(() => {
    if (!laufend?.startZeit) return 0
    return laufendeSekunden(laufend.startZeit, now)
  }, [laufend, now])

  async function handlePause() {
    setError('')
    try {
      if (laufend) {
        await window.api.timer.stop()
      } else {
        await window.api.anwesenheit.pauseToggle()
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('float.errPause'))
    }
  }

  async function handleStart() {
    setError('')
    try {
      if (!status?.anwesenheit?.istOffen) {
        await window.api.anwesenheit.kommen()
      } else if (status.anwesenheit.imPause) {
        await window.api.anwesenheit.pauseToggle()
      }

      const projektId = selectedId === '' ? status?.projekte[0]?.id : selectedId
      if (!projektId) {
        setError(t('float.noOrder'))
        return
      }
      const projekt = status?.projekte.find((p) => p.id === projektId)
      await window.api.timer.start(projektId, projekt?.kurztext?.trim() ?? '')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('float.errStart'))
    }
  }

  async function handleSelect(projektId: number) {
    setSelectedId(projektId)
    setError('')
    if (!laufend) return
    if (laufend.projektId === projektId) return
    try {
      const projekt = status?.projekte.find((p) => p.id === projektId)
      await window.api.timer.start(projektId, projekt?.kurztext?.trim() ?? '')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('float.errSwitch'))
    }
  }

  const statusTone = laufend ? 'running' : status?.anwesenheit?.imPause ? 'pause' : 'idle'
  const statusText = laufend
    ? t('float.running')
    : status?.anwesenheit?.imPause
      ? t('float.paused')
      : t('float.ready')

  const selectedProjekt = useMemo(() => {
    if (!status?.projekte.length) return null
    if (laufend) {
      return status.projekte.find((p) => p.id === laufend.projektId) ?? null
    }
    if (selectedId === '') return status.projekte[0] ?? null
    return status.projekte.find((p) => p.id === selectedId) ?? null
  }, [status, laufend, selectedId])

  function openMainApp() {
    void window.api.floating.showMain()
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    return Boolean(target.closest('select, button, .float-timer, .float-chip, .float-error'))
  }

  function stopDragging(pointerId?: number, currentTarget?: HTMLDivElement) {
    if (!draggingRef.current) return
    draggingRef.current = false
    dragOffset.current = null
    activePointerId.current = null
    setDragging(false)
    if (
      currentTarget &&
      pointerId != null &&
      currentTarget.hasPointerCapture(pointerId)
    ) {
      currentTarget.releasePointerCapture(pointerId)
    }
  }

  async function handleDragStart(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return

    const pointerId = event.pointerId
    const screenX = event.screenX
    const screenY = event.screenY
    const target = event.currentTarget

    // Sofort capturen, solange die Taste noch unten ist
    target.setPointerCapture(pointerId)
    activePointerId.current = pointerId

    // Während await: Loslassen der Taste merken (event.buttons ist nach await unzuverlässig)
    let releasedDuringWait = false
    const markReleased = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointerId) releasedDuringWait = true
    }
    window.addEventListener('pointerup', markReleased, true)
    window.addEventListener('pointercancel', markReleased, true)

    try {
      const bounds = await window.api.floating.getBounds()
      if (!bounds || releasedDuringWait || activePointerId.current !== pointerId) {
        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId)
        }
        activePointerId.current = null
        return
      }

      dragOffset.current = {
        x: screenX - bounds.x,
        y: screenY - bounds.y
      }
      draggingRef.current = true
      setDragging(true)
    } finally {
      window.removeEventListener('pointerup', markReleased, true)
      window.removeEventListener('pointercancel', markReleased, true)
    }
  }

  function handleDragMove(event: React.PointerEvent<HTMLDivElement>) {
    // Nur bei gedrückter linker Taste verschieben
    if (!draggingRef.current || !dragOffset.current) return
    if ((event.buttons & 1) === 0) {
      stopDragging(event.pointerId, event.currentTarget)
      return
    }
    void window.api.floating.setPosition(
      event.screenX - dragOffset.current.x,
      event.screenY - dragOffset.current.y
    )
  }

  function handleDragEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointerId.current != null && event.pointerId !== activePointerId.current) {
      return
    }
    stopDragging(event.pointerId, event.currentTarget)
  }

  return (
    <div className={`float-shell${error ? ' has-error' : ''}${dragging ? ' is-dragging' : ''}`}>
      <div
        className={`float-bar state-${statusTone}${dragging ? ' is-dragging' : ''}`}
        title={t('float.drag')}
        onPointerDown={(e) => void handleDragStart(e)}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <div
          className="float-timer"
          title={t('float.timerTitle')}
          onDoubleClick={openMainApp}
        >
          {formatSekunden(liveSekunden)}
        </div>

        <span
          className={`float-chip ${statusTone}`}
          title={t('float.openApp')}
          onDoubleClick={openMainApp}
        >
          <span className="float-chip-dot" aria-hidden="true" />
          {statusText}
        </span>

        <div className="float-totals" title={selectedProjekt?.name ?? ''}>
          <span>
            {t('float.totalTime')}{' '}
            <strong>{formatDauer(selectedProjekt?.gesamtMinuten ?? 0)}</strong>
          </span>
          <span>
            {t('float.todayTime')}{' '}
            <strong>{formatDauer(selectedProjekt?.heuteMinuten ?? 0)}</strong>
          </span>
        </div>

        <select
          className="float-select"
          value={selectedId}
          onChange={(e) => void handleSelect(Number(e.target.value))}
          disabled={!status?.projekte.length}
          title={laufend?.projektName ?? t('float.selectOrder')}
        >
          {status?.projekte.map((p) => (
            <option key={p.id} value={p.id}>
              {p.auftragsnummer ? `${p.auftragsnummer} · ` : ''}
              {p.kuerzel} – {p.name}
            </option>
          ))}
        </select>

        {laufend ? (
          <button
            className="float-btn icon pause"
            type="button"
            aria-label={t('float.pause')}
            title={t('float.pause')}
            onClick={() => void handlePause()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="6" y="5" width="4" height="14" rx="1.2" />
              <rect x="14" y="5" width="4" height="14" rx="1.2" />
            </svg>
          </button>
        ) : (
          <button
            className="float-btn icon start"
            type="button"
            aria-label={t('float.start')}
            title={t('float.start')}
            onClick={() => void handleStart()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8.2 5.2a1.2 1.2 0 0 1 1.85-.98l10.1 6.3a1.2 1.2 0 0 1 0 2.06l-10.1 6.3A1.2 1.2 0 0 1 8.2 17.9V5.2Z" />
            </svg>
          </button>
        )}
      </div>
      {error && <div className="float-error">{error}</div>}
    </div>
  )
}
