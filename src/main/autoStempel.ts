import { app, powerMonitor } from 'electron'
import {
  clearShutdownGehenMarker,
  formatDate,
  gehen,
  getAnwesenheit,
  getEinstellungen,
  getShutdownGehenMarker,
  kommen,
  reopenAnwesenheitAfterRestart,
  setShutdownGehenMarker
} from './database'
import type { Anwesenheit, Einstellungen } from '../shared/types'

let shutdownHooked = false

export type StartupStempelResult = {
  restartedSession: boolean
  autoKommen: Anwesenheit | null
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
      // Offene Sitzung vom Vortag ohne Shutdown-Marker → schließen, dann neu kommen
      try {
        gehen()
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

/** Startsequenz: Restart-Gehen auflösen, danach ggf. Auto-Kommen */
export function runStartupStempel(): StartupStempelResult {
  const restartedSession = resolvePendingShutdownGehen()
  if (restartedSession) {
    return { restartedSession: true, autoKommen: null }
  }
  return { restartedSession: false, autoKommen: tryAutoKommenHeute() }
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

export function startAutoGehenOnShutdown(): void {
  if (shutdownHooked) return
  shutdownHooked = true

  powerMonitor.on('shutdown', () => {
    tryAutoGehenOnShutdown()
  })
}

/** Windows-/OS-Autostart mit Login */
export function applyAutoStartSetting(settings?: Einstellungen): void {
  const enabled = (settings ?? getEinstellungen()).autoStartEnabled
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      path: process.execPath,
      args: []
    })
  } catch (err) {
    console.warn('[ProjectTimer] Autostart konnte nicht gesetzt werden:', err)
  }
}
