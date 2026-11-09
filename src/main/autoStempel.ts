import { app, powerMonitor } from 'electron'
import {
  clearShutdownGehenMarker,
  closeStaleOpenAnwesenheit,
  formatDate,
  gehen,
  getAnwesenheit,
  getEinstellungen,
  getShutdownGehenMarker,
  kommen,
  reopenAnwesenheitAfterRestart,
  repairCrossDayAnwesenheit,
  setShutdownGehenMarker,
  touchAnwesenheitLastSeen
} from './database'
import type { Anwesenheit, Einstellungen } from '../shared/types'

let shutdownHooked = false
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

export type StartupStempelResult = {
  restartedSession: boolean
  autoKommen: Anwesenheit | null
  repairedSessions: number
  closedStale: boolean
}

/**
 * Nach Boot: War das letzte Gehen nur wegen Restart?
 * - Gleicher Tag → Gehen zurücknehmen, Sitzung fortsetzen (kein neues Kommen)
 * - Neuer Tag → Gehen bleibt (letztes Herunterfahren des Vortags), Marker löschen
 */
export function resolvePendingShutdownGehen(): boolean {
  const marker = getShutdownGehenMarker()
  if (!marker) return false

  const heute = formatDate(new Date())
  const gehenTag = formatDate(new Date(marker.gehenAm))

  if (gehenTag === heute) {
    // Restart / Updates am selben Tag → Gehen resetten
    const reopened = reopenAnwesenheitAfterRestart(marker.anwesenheitId, marker.gehenAm)
    if (reopened) {
      console.log('[ProjectTimer] Restart erkannt: Shutdown-Gehen zurückgenommen')
      return true
    }
    clearShutdownGehenMarker()
    return false
  }

  // Anderer Tag: Gehen war das letzte Herunterfahren des Vortags → behalten
  clearShutdownGehenMarker()
  return false
}

/**
 * Erster sinnvoller Start am Tag: automatisch Kommen.
 * Nicht nach Restart-Fortsetzung und nicht wenn heute schon eine Sitzung existiert.
 */
export function tryAutoKommenHeute(): Anwesenheit | null {
  const settings = getEinstellungen()
  if (!settings.autoKommenEnabled) return null

  const heute = formatDate(new Date())
  const aktuell = getAnwesenheit()

  if (aktuell?.istOffen) {
    const kommenTag = formatDate(new Date(aktuell.kommenAm))
    if (kommenTag < heute) {
      // Offene Sitzung vom Vortag → am Vortag schließen (nicht mit „jetzt“!)
      try {
        closeStaleOpenAnwesenheit()
      } catch (err) {
        console.warn('[ProjectTimer] Auto-Gehen (Vortag) fehlgeschlagen:', err)
        return null
      }
    } else {
      return null
    }
  } else if (aktuell && !aktuell.istOffen) {
    // Heute schon gekommen und (endgültig) gegangen
    return null
  }

  try {
    return kommen()
  } catch (err) {
    console.warn('[ProjectTimer] Auto-Kommen fehlgeschlagen:', err)
    return null
  }
}

/** Startsequenz: Daten reparieren, Restart-Gehen auflösen, Stale schließen, ggf. Auto-Kommen */
export function runStartupStempel(): StartupStempelResult {
  const repairedSessions = repairCrossDayAnwesenheit()
  if (repairedSessions > 0) {
    console.log(`[ProjectTimer] ${repairedSessions} Anwesenheits-Sitzung(en) über Tagesgrenze korrigiert`)
  }

  const restartedSession = resolvePendingShutdownGehen()
  if (restartedSession) {
    return { restartedSession: true, autoKommen: null, repairedSessions, closedStale: false }
  }

  const stale = closeStaleOpenAnwesenheit()
  const closedStale = Boolean(stale)
  return {
    restartedSession: false,
    autoKommen: tryAutoKommenHeute(),
    repairedSessions,
    closedStale
  }
}

/**
 * Vorläufiges Gehen bei Shutdown/Restart.
 * Bleibt nur bestehen, wenn der PC am selben Tag nicht wieder startet.
 */
export function tryAutoGehenOnShutdown(): Anwesenheit | null {
  const settings = getEinstellungen()
  if (!settings.autoGehenOnShutdown) return null

  const heute = getAnwesenheit()
  if (!heute?.istOffen) return null

  try {
    touchAnwesenheitLastSeen()
    const closed = gehen()
    if (closed.gehenAm) {
      setShutdownGehenMarker({
        anwesenheitId: closed.id,
        gehenAm: closed.gehenAm
      })
    }
    return closed
  } catch (err) {
    console.warn('[ProjectTimer] Auto-Gehen (Shutdown) fehlgeschlagen:', err)
    return null
  }
}

export function startAnwesenheitHeartbeat(): void {
  if (heartbeatTimer) return
  touchAnwesenheitLastSeen()
  heartbeatTimer = setInterval(() => {
    try {
      touchAnwesenheitLastSeen()
    } catch (err) {
      console.warn('[ProjectTimer] Anwesenheit-Heartbeat fehlgeschlagen:', err)
    }
  }, 60_000)
  // Timer darf Electron am Beenden nicht blockieren
  if (typeof heartbeatTimer === 'object' && 'unref' in heartbeatTimer) {
    heartbeatTimer.unref?.()
  }
}

export function stopAnwesenheitHeartbeat(): void {
  if (!heartbeatTimer) return
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
  try {
    touchAnwesenheitLastSeen()
  } catch {
    /* ignore */
  }
}

export function startAutoGehenOnShutdown(): void {
  if (shutdownHooked) return
  shutdownHooked = true

  // Windows: shutdown ist oft zu kurz – zusätzlich Heartbeat + Startup-Repair
  powerMonitor.on('shutdown', () => {
    tryAutoGehenOnShutdown()
  })

  // Suspend/Hibernate: zumindest Last-Seen setzen (kein Gehen – Nutzer kommt oft zurück)
  powerMonitor.on('suspend', () => {
    try {
      touchAnwesenheitLastSeen()
    } catch {
      /* ignore */
    }
  })
}

/** Windows-/OS-Autostart mit Login */
export function applyAutoStartSetting(settings?: Einstellungen): void {
  const enabled = (settings ?? getEinstellungen()).autoStartEnabled
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
      args: []
    })
  } catch (err) {
    console.warn('[ProjectTimer] Autostart konnte nicht gesetzt werden:', err)
  }
}
