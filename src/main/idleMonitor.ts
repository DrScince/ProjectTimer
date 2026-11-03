import { BrowserWindow, powerMonitor } from 'electron'
import { randomUUID } from 'crypto'
import {
  ensurePauseIfAnwesend,
  freezeTimerForAway,
  getAnwesenheit,
  getEinstellungen,
  getLaufenderTimer,
  listProjekte,
  resolveIdleGap,
  startTimer
} from './database'
import { getMainWindowUserVisible, hideToTray, showMainWindow } from './tray'
import type { IdleAwayReason, IdlePrompt, IdleResolveInput } from '../shared/types'
import { t } from '../shared/i18n'

const LOCK_MIN_MINUTES = 1

type PendingAway = {
  reason: IdleAwayReason
  since: Date
  previousProjektId: number | null
  previousNotiz: string
}

type OpenPrompt = IdlePrompt

let pending: PendingAway | null = null
let openPrompt: OpenPrompt | null = null
/**
 * Nutzer-Fensterzustand vor der Idle-/Sperre-Abfrage.
 * Wird beim Weggehen gesetzt (nicht erst nach Unlock – sonst ist das Fenster oft schon „sichtbar“).
 */
let windowWasVisibleBeforePrompt: boolean | null = null
let pollTimer: NodeJS.Timeout | null = null
let started = false
let getMainWindow: (() => BrowserWindow | null) | null = null

function rememberWindowStateBeforeAway(): void {
  if (windowWasVisibleBeforePrompt != null) return
  const win = getMainWindow?.() ?? null
  if (win && !win.isDestroyed()) {
    windowWasVisibleBeforePrompt =
      getMainWindowUserVisible() && win.isVisible() && !win.isMinimized()
  } else {
    windowWasVisibleBeforePrompt = getMainWindowUserVisible()
  }
}

function sendPrompt(prompt: IdlePrompt): void {
  const win = getMainWindow?.() ?? null
  if (!win || win.isDestroyed()) return

  // Falls noch nicht beim Away gesetzt (Sicherheitsnetz)
  rememberWindowStateBeforeAway()

  showMainWindow(win)
  win.webContents.send('idle:prompt', prompt)
}

function restoreWindowAfterPrompt(): void {
  const win = getMainWindow?.() ?? null
  const wasVisible = windowWasVisibleBeforePrompt
  windowWasVisibleBeforePrompt = null
  if (!win || win.isDestroyed() || wasVisible == null) return
  if (!wasVisible) {
    // Kurz verzögern, damit der Dialog erst schließen kann
    setTimeout(() => {
      if (!win.isDestroyed()) hideToTray(win)
    }, 50)
  }
}

function shouldMonitor(): boolean {
  const settings = getEinstellungen()
  if (!settings.idleDetectionEnabled) return false
  const anwesenheit = getAnwesenheit()
  return Boolean(anwesenheit?.istOffen)
}

function listPromptProjekte(): IdlePrompt['projekte'] {
  return listProjekte(true).map((p) => ({
    id: p.id,
    name: p.name,
    kuerzel: p.kuerzel,
    auftragsnummer: p.auftragsnummer
  }))
}

function beginAway(reason: IdleAwayReason): void {
  if (!shouldMonitor()) return
  if (pending) return

  const anwesenheit = getAnwesenheit()
  if (!anwesenheit?.istOffen) return

  const laufend = getLaufenderTimer()
  // Ohne offene Abfrage: reine Pause ohne Timer ignorieren
  if (!openPrompt && !laufend && anwesenheit.imPause) return

  // Zustand merken, bevor Unlock/Prompt das Fenster einblendet
  if (!openPrompt) {
    rememberWindowStateBeforeAway()
  }

  const previousProjektId =
    laufend?.projektId ?? openPrompt?.previousProjektId ?? null
  const previousNotiz =
    (laufend?.notiz ?? '').trim() || openPrompt?.previousNotiz || ''
  if (laufend) {
    freezeTimerForAway()
  }

  pending = {
    reason,
    since: new Date(),
    previousProjektId,
    previousNotiz
  }
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000))
}

function thresholdFor(reason: IdleAwayReason): number {
  if (reason === 'lock') return LOCK_MIN_MINUTES
  return Math.max(1, getEinstellungen().idleThresholdMinutes || 5)
}

function resumePreviousOrPause(
  previousProjektId: number | null,
  previousNotiz = ''
): void {
  if (previousProjektId != null) {
    try {
      startTimer(previousProjektId, previousNotiz)
      return
    } catch {
      // fällt auf Pause zurück
    }
  }
  ensurePauseIfAnwesend()
}

function mergeOrCreatePrompt(away: PendingAway, ended: Date, dauerMinuten: number): void {
  if (openPrompt) {
    // Weitere Abwesenheit zur offenen Abfrage addieren
    openPrompt = {
      ...openPrompt,
      reason: away.reason === 'lock' || openPrompt.reason === 'lock' ? 'lock' : away.reason,
      bis: ended.toISOString(),
      dauerMinuten: openPrompt.dauerMinuten + dauerMinuten,
      previousProjektId: openPrompt.previousProjektId ?? away.previousProjektId,
      previousNotiz: openPrompt.previousNotiz || away.previousNotiz,
      projekte: listPromptProjekte()
    }
  } else {
    openPrompt = {
      id: randomUUID(),
      reason: away.reason,
      von: away.since.toISOString(),
      bis: ended.toISOString(),
      dauerMinuten,
      previousProjektId: away.previousProjektId,
      previousNotiz: away.previousNotiz,
      projekte: listPromptProjekte()
    }
  }

  ensurePauseIfAnwesend()
  sendPrompt(openPrompt)
}

function finishAway(): void {
  if (!pending) return

  const away = pending
  pending = null
  const ended = new Date()
  const dauerMinuten = minutesBetween(away.since, ended)
  const minRequired = thresholdFor(away.reason)

  if (dauerMinuten < minRequired) {
    // Kurze Sperre/Idle: bei offener Abfrage nichts ändern
    if (!openPrompt) {
      resumePreviousOrPause(away.previousProjektId, away.previousNotiz)
    }
    return
  }

  mergeOrCreatePrompt(away, ended, dauerMinuten)
}

export function getOpenIdlePrompt(): IdlePrompt | null {
  return openPrompt
}

export function resolveOpenIdlePrompt(input: IdleResolveInput): void {
  if (!openPrompt || openPrompt.id !== input.promptId) {
    throw new Error(t('err.noIdlePrompt'))
  }
  if (pending) {
    throw new Error(t('err.idlePending'))
  }
  const prompt = openPrompt
  openPrompt = null
  resolveIdleGap(prompt.von, prompt.bis, prompt.dauerMinuten, {
    allocations: input.allocations,
    fortsetzenProjektId: input.fortsetzenProjektId,
    fortsetzenNotiz: input.fortsetzenNotiz ?? prompt.previousNotiz
  })
  restoreWindowAfterPrompt()
}

function pollIdle(): void {
  if (!shouldMonitor()) return

  const idleSeconds = powerMonitor.getSystemIdleTime()
  const thresholdMinutes = Math.max(1, getEinstellungen().idleThresholdMinutes || 5)
  const thresholdSeconds = thresholdMinutes * 60

  if (!pending) {
    if (idleSeconds >= thresholdSeconds) {
      beginAway('idle')
    }
    return
  }

  if (pending.reason === 'idle' && idleSeconds < 3) {
    finishAway()
  }
}

export function startIdleMonitor(getWindow: () => BrowserWindow | null): void {
  if (started) return
  started = true
  getMainWindow = getWindow

  powerMonitor.on('lock-screen', () => {
    beginAway('lock')
  })

  powerMonitor.on('unlock-screen', () => {
    if (pending?.reason === 'lock') {
      finishAway()
    }
  })

  pollTimer = setInterval(() => {
    try {
      pollIdle()
    } catch {
      // Monitor darf die App nicht killen
    }
  }, 5000)
}

export function stopIdleMonitor(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  started = false
  pending = null
  openPrompt = null
  windowWasVisibleBeforePrompt = null
  getMainWindow = null
}
