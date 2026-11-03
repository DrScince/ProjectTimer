import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FloatBarLayout, FloatingBarStatus, ProjektMitZeit } from '../../shared/types'
import logoUrl from './assets/logo.png'
import { useI18n } from './i18n'
import { formatDauer, formatSekunden, laufendeSekunden } from './utils'

type TopicOption = {
  key: string
  projektId: number
  kurztext: string
  kuerzel: string
  subtitle: string
  label: string
  heuteMinuten: number
  gesamtMinuten: number
  timerLaeuft: boolean
}

function topicKey(projektId: number, kurztext: string): string {
  return `${projektId}::${kurztext}`
}

function buildTopicOptions(projekte: ProjektMitZeit[]): TopicOption[] {
  const options: TopicOption[] = []
  for (const p of projekte) {
    const themen = p.themen ?? []
    const empty = themen.find((th) => !th.kurztext.trim())
    const orderRunning =
      Boolean(empty?.timerLaeuft) ||
      Boolean(p.timerLaeuft && !themen.some((th) => th.timerLaeuft))

    options.push({
      key: topicKey(p.id, ''),
      projektId: p.id,
      kurztext: '',
      kuerzel: p.kuerzel,
      subtitle: p.name,
      label: `${p.auftragsnummer ? `${p.auftragsnummer} · ` : ''}${p.kuerzel} – ${p.name}`,
      heuteMinuten: p.heuteMinuten,
      gesamtMinuten: p.gesamtMinuten,
      timerLaeuft: orderRunning
    })

    for (const thema of themen) {
      if (!thema.kurztext.trim()) continue
      options.push({
        key: topicKey(p.id, thema.kurztext),
        projektId: p.id,
        kurztext: thema.kurztext,
        kuerzel: p.kuerzel,
        subtitle: thema.kurztext,
        label: `${p.auftragsnummer ? `${p.auftragsnummer} · ` : ''}${p.kuerzel} – ${thema.kurztext}`,
        heuteMinuten: thema.heuteMinuten,
        gesamtMinuten: p.gesamtMinuten,
        timerLaeuft: thema.timerLaeuft
      })
    }
  }
  return options
}

const COLLAPSE_DELAY_MS = 400

export default function FloatingBar() {
  const { t } = useI18n()
  const [status, setStatus] = useState<FloatingBarStatus | null>(null)
  const [layout, setLayout] = useState<FloatBarLayout>({
    mode: 'free',
    edge: 'top',
    expanded: true
  })
  const [selectedKey, setSelectedKey] = useState('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [dragging, setDragging] = useState(false)
  const dragOffset = useRef<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const pendingDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    target: HTMLDivElement
  } | null>(null)
  const activePointerId = useRef<number | null>(null)
  const collapseTimer = useRef<number | null>(null)
  const DRAG_THRESHOLD_PX = 6

  const load = useCallback(async () => {
    const [data, nextLayout] = await Promise.all([
      window.api.floating.getStatus(),
      window.api.floating.getLayout()
    ])
    setStatus(data)
    setLayout(nextLayout)
    const options = buildTopicOptions(data.projekte)
    setSelectedKey((prev) => {
      if (data.timer) {
        return topicKey(data.timer.projektId, (data.timer.notiz ?? '').trim())
      }
      if (prev && options.some((o) => o.key === prev)) return prev
      return options[0]?.key ?? ''
    })
  }, [])

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
    const unsubscribe = window.api.onStatusChanged(() => {
      void load().catch(() => undefined)
    })
    const unsubLayout = window.api.floating.onLayout((next) => setLayout(next))
    const poll = window.setInterval(() => {
      void load().catch(() => undefined)
    }, 2000)
    const tick = window.setInterval(() => setNow(new Date()), 1000)
    return () => {
      unsubscribe()
      unsubLayout()
      window.clearInterval(poll)
      window.clearInterval(tick)
      if (collapseTimer.current != null) window.clearTimeout(collapseTimer.current)
    }
  }, [load])

  const laufend = status?.timer ?? null
  const topicOptions = useMemo(
    () => buildTopicOptions(status?.projekte ?? []),
    [status?.projekte]
  )
  const isSlideout = layout.mode === 'slideout'
  const isVertical = isSlideout && (layout.edge === 'left' || layout.edge === 'right')
  const isCollapsed = isSlideout && !layout.expanded

  const liveSekunden = useMemo(() => {
    if (!laufend?.startZeit) return 0
    return laufendeSekunden(laufend.startZeit, now)
  }, [laufend, now])

  const selected = useMemo(() => {
    if (laufend) {
      return (
        topicOptions.find(
          (o) =>
            o.projektId === laufend.projektId &&
            o.kurztext === (laufend.notiz ?? '').trim()
        ) ?? null
      )
    }
    return topicOptions.find((o) => o.key === selectedKey) ?? topicOptions[0] ?? null
  }, [topicOptions, selectedKey, laufend])

  function clearCollapseTimer(): void {
    if (collapseTimer.current != null) {
      window.clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
  }

  async function expandBar(): Promise<void> {
    if (!isSlideout) return
    clearCollapseTimer()
    const next = await window.api.floating.setExpanded(true)
    setLayout(next)
  }

  function scheduleCollapse(): void {
    if (!isSlideout) return
    clearCollapseTimer()
    collapseTimer.current = window.setTimeout(() => {
      void window.api.floating.setExpanded(false).then(setLayout)
    }, COLLAPSE_DELAY_MS)
  }

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

      const target = selected ?? topicOptions[0]
      if (!target) {
        setError(t('float.noTopic'))
        return
      }
      await window.api.timer.start(target.projektId, target.kurztext)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('float.errStart'))
    }
  }

  async function handleSelect(key: string) {
    setSelectedKey(key)
    setError('')
    const option = topicOptions.find((o) => o.key === key)
    if (!option || !laufend) return
    if (
      laufend.projektId === option.projektId &&
      (laufend.notiz ?? '').trim() === option.kurztext
    ) {
      return
    }
    try {
      await window.api.timer.start(option.projektId, option.kurztext)
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

  function openMainApp() {
    void window.api.floating.showMain()
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    // Slideout: entlang der Kante ziehen – nur echte Controls blockieren
    if (isSlideout) {
      return Boolean(target.closest('select, button'))
    }
    return Boolean(
      target.closest(
        'select, button, .float-timer, .float-chip, .float-error, .float-project-pick, .float-status-header'
      )
    )
  }

  function clearPendingDrag(): void {
    pendingDragRef.current = null
  }

  function stopDragging(pointerId?: number, currentTarget?: HTMLDivElement) {
    const wasDragging = draggingRef.current
    const pending = pendingDragRef.current
    const target = currentTarget ?? pending?.target
    const id = pointerId ?? pending?.pointerId ?? activePointerId.current

    draggingRef.current = false
    dragOffset.current = null
    activePointerId.current = null
    clearPendingDrag()
    setDragging(false)

    if (target && id != null && target.hasPointerCapture(id)) {
      target.releasePointerCapture(id)
    }
    if (wasDragging && isSlideout) {
      void window.api.floating.persistEdgeOffset()
    }
  }

  async function handleDragStart(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return
    // Noch kein Drag: Doppelklick/Klick bleiben möglich, bis Schwelle überschritten ist
    if (draggingRef.current || pendingDragRef.current) return

    const pointerId = event.pointerId
    const screenX = event.screenX
    const screenY = event.screenY
    const target = event.currentTarget
    activePointerId.current = pointerId

    let releasedDuringWait = false
    const markReleased = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointerId) releasedDuringWait = true
    }
    window.addEventListener('pointerup', markReleased, true)
    window.addEventListener('pointercancel', markReleased, true)

    try {
      const bounds = await window.api.floating.getBounds()
      if (!bounds || releasedDuringWait || activePointerId.current !== pointerId) {
        activePointerId.current = null
        return
      }

      pendingDragRef.current = {
        pointerId,
        startX: screenX,
        startY: screenY,
        offsetX: screenX - bounds.x,
        offsetY: screenY - bounds.y,
        target
      }
    } finally {
      window.removeEventListener('pointerup', markReleased, true)
      window.removeEventListener('pointercancel', markReleased, true)
    }
  }

  function activateDrag(pending: NonNullable<typeof pendingDragRef.current>): void {
    pending.target.setPointerCapture(pending.pointerId)
    dragOffset.current = { x: pending.offsetX, y: pending.offsetY }
    draggingRef.current = true
    clearPendingDrag()
    setDragging(true)
    if (isSlideout) clearCollapseTimer()
  }

  function handleDragMove(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.buttons & 1) === 0) {
      if (draggingRef.current || pendingDragRef.current) {
        stopDragging(event.pointerId, event.currentTarget)
      }
      return
    }

    const pending = pendingDragRef.current
    if (pending && pending.pointerId === event.pointerId && !draggingRef.current) {
      const dx = event.screenX - pending.startX
      const dy = event.screenY - pending.startY
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        activateDrag(pending)
      } else {
        return
      }
    }

    if (!draggingRef.current || !dragOffset.current) return
    void window.api.floating.setPosition(
      event.screenX - dragOffset.current.x,
      event.screenY - dragOffset.current.y
    )
  }

  function handleDragEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointerId.current != null && event.pointerId !== activePointerId.current) {
      return
    }
    // Nur Pending ohne echten Drag → Klick/Doppelklick ungestört
    if (!draggingRef.current) {
      clearPendingDrag()
      activePointerId.current = null
      return
    }
    stopDragging(event.pointerId, event.currentTarget)
  }

  return (
    <div
      className={[
        'float-shell',
        error ? 'has-error' : '',
        dragging ? 'is-dragging' : '',
        isSlideout ? 'mode-slideout' : 'mode-free',
        `edge-${layout.edge}`,
        isCollapsed ? 'is-collapsed' : 'is-expanded',
        isVertical ? 'is-vertical' : 'is-horizontal'
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={() => void expandBar()}
      onMouseLeave={() => {
        if (!draggingRef.current) scheduleCollapse()
      }}
      onPointerDown={(e) => void handleDragStart(e)}
      onPointerMove={handleDragMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
    >
      {isSlideout && (
        <div
          className={`float-peek state-${statusTone}`}
          title={`${t('float.slideoutPeek')} · ${t('float.drag')}`}
        >
          <div className="float-peek-pill" aria-hidden="true">
            <span className="float-peek-shine" />
            <span className="float-peek-grip">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      )}
      <div
        className={`float-bar state-${statusTone}${dragging ? ' is-dragging' : ''}${
          isVertical ? ' layout-status-first' : ''
        }`}
        title={isSlideout ? t('float.drag') : t('float.drag')}
      >
        {isVertical ? (
          <>
            <div
              className={`float-status-header ${statusTone}`}
              title={t('float.openApp')}
              onDoubleClick={openMainApp}
            >
              <span className="float-chip-dot" aria-hidden="true" />
              <span className="float-status-text">{statusText}</span>
              <img className="float-logo" src={logoUrl} alt="" width={18} height={18} />
            </div>

            <div
              className="float-timer"
              title={t('float.timerTitle')}
              onDoubleClick={openMainApp}
            >
              {formatSekunden(liveSekunden)}
            </div>

            <div className="float-totals float-totals-inline" title={selected?.label ?? ''}>
              <span>
                {t('float.todayTime')} <strong>{formatDauer(selected?.heuteMinuten ?? 0)}</strong>
              </span>
              <span className="float-totals-sep" aria-hidden="true">
                ·
              </span>
              <span>
                {t('float.totalTime')} <strong>{formatDauer(selected?.gesamtMinuten ?? 0)}</strong>
              </span>
            </div>

            <div className="float-project-pick">
              <div className="float-project-lines" aria-hidden="true">
                <strong>{selected?.kuerzel || t('float.noOrder')}</strong>
                <span>{selected?.subtitle || '–'}</span>
              </div>
              <select
                className="float-select float-select-ghost"
                value={selected?.key ?? ''}
                onChange={(e) => void handleSelect(e.target.value)}
                disabled={topicOptions.length === 0}
                title={selected?.label ?? t('float.selectOrder')}
                aria-label={t('float.selectOrder')}
              >
                {topicOptions.length === 0 ? (
                  <option value="">{t('float.noOrder')}</option>
                ) : (
                  topicOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))
                )}
              </select>
              <span className="float-project-chevron" aria-hidden="true">
                ▾
              </span>
            </div>

            <div className="float-action-wrap">
              {laufend ? (
                <button
                  className="float-btn icon round pause"
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
                  className="float-btn icon round start"
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
          </>
        ) : (
          <>
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

            <div className="float-totals" title={selected?.label ?? ''}>
              <span>
                {t('float.totalTime')}{' '}
                <strong>{formatDauer(selected?.gesamtMinuten ?? 0)}</strong>
              </span>
              <span>
                {t('float.todayTime')}{' '}
                <strong>{formatDauer(selected?.heuteMinuten ?? 0)}</strong>
              </span>
            </div>

            <select
              className="float-select"
              value={selected?.key ?? ''}
              onChange={(e) => void handleSelect(e.target.value)}
              disabled={topicOptions.length === 0}
              title={selected?.label ?? t('float.selectOrder')}
            >
              {topicOptions.length === 0 ? (
                <option value="">{t('float.noOrder')}</option>
              ) : (
                topicOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))
              )}
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
          </>
        )}
      </div>
      {error && !isCollapsed && <div className="float-error">{error}</div>}
    </div>
  )
}
