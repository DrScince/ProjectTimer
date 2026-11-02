import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  closeDatabase,
  createBuchung,
  createProjekt,
  deleteBuchung,
  deleteProjekt,
  gehen,
  getAnwesenheit,
  getEinstellungen,
  getLaufenderTimer,
  initDatabase,
  kommen,
  listBuchungenByDatum,
  listProjekte,
  listProjekteMitZeiten,
  pauseToggle,
  saveEinstellungen,
  setKurztextHeute,
  setProjektAktiv,
  startTimer,
  stopTimer,
  updateBuchung,
  updateProjekt,
  updateProjektKurztext,
  upsertProjekteFromImport,
  markBuchungenSapUeberfuehrt,
  clearBuchungenSapUeberfuehrt,
  getSapTagesStatus,
  markSapByDatum,
  clearSapByDatum,
  markSapByDatumProjekt,
  clearSapByDatumProjekt
} from './database'
import {
  buildCsvContent,
  buildCsvVorschau,
  getWochenUebersicht,
  markExportAsSapTransferred
} from './services'
import {
  destroyFloatingBar,
  getFloatingBarBounds,
  setFloatingBarPosition,
  syncFloatingBar
} from './floatingBar'
import {
  getOpenIdlePrompt,
  resolveOpenIdlePrompt,
  startIdleMonitor,
  stopIdleMonitor
} from './idleMonitor'
import {
  applyAutoStartSetting,
  runStartupStempel,
  startAutoGehenOnShutdown
} from './autoStempel'
import {
  createTray,
  destroyTray,
  getIsQuitting,
  hideToTray,
  setQuitting,
  showMainWindow,
  updateTrayMenu
} from './tray'
import type {
  Einstellungen,
  ExportOptions,
  IdleResolveInput,
  ProjektExport,
  ProjektInput,
  ZeitbuchungInput
} from '../shared/types'
import { resolveLocale, setLocale, t } from '../shared/i18n'

function applyAppLocale(settings?: Einstellungen): void {
  const prefs = settings ?? getEinstellungen()
  setLocale(resolveLocale(prefs.language, app.getLocale()))
  updateTrayMenu()
}

let mainWindow: BrowserWindow | null = null

/** Stempel-Fenster und Floating-Bar auf denselben Stand bringen */
function broadcastStatusChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('status:changed')
    }
  }
}

function sendWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send('window:state', {
    isMaximized: win.isMaximized()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: 'ProjectTimer',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    showMainWindow(mainWindow)
    if (mainWindow) sendWindowState(mainWindow)
  })

  mainWindow.on('maximize', () => {
    if (mainWindow) sendWindowState(mainWindow)
  })
  mainWindow.on('unmaximize', () => {
    if (mainWindow) sendWindowState(mainWindow)
  })

  // Schließen (X) → in Tray legen statt beenden
  mainWindow.on('close', (event) => {
    if (!getIsQuitting()) {
      event.preventDefault()
      hideToTray(mainWindow)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('projekte:list', (_e, nurAktiv?: boolean) => listProjekte(Boolean(nurAktiv)))
  ipcMain.handle('projekte:listMitZeiten', () => listProjekteMitZeiten())
  ipcMain.handle('projekte:create', (_e, input: ProjektInput) => createProjekt(input))
  ipcMain.handle('projekte:update', (_e, id: number, input: ProjektInput) => updateProjekt(id, input))
  ipcMain.handle('projekte:setAktiv', (_e, id: number, aktiv: boolean) => setProjektAktiv(id, aktiv))
  ipcMain.handle('projekte:updateKurztext', (_e, id: number, kurztext: string) =>
    updateProjektKurztext(id, kurztext)
  )
  ipcMain.handle('projekte:delete', (_e, id: number) => {
    deleteProjekt(id)
    return true
  })

  ipcMain.handle('anwesenheit:get', () => getAnwesenheit())
  ipcMain.handle('anwesenheit:kommen', () => {
    const result = kommen()
    broadcastStatusChanged()
    return result
  })
  ipcMain.handle('anwesenheit:gehen', () => {
    const result = gehen()
    broadcastStatusChanged()
    return result
  })
  ipcMain.handle('anwesenheit:pauseToggle', () => {
    const result = pauseToggle()
    broadcastStatusChanged()
    return result
  })

  ipcMain.handle('projekte:export', async () => {
    const projekte = listProjekte(false)
    const payload: ProjektExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      projekte: projekte.map((p) => ({
        name: p.name,
        kuerzel: p.kuerzel,
        auftragsnummer: p.auftragsnummer,
        arbeitsplatz: p.arbeitsplatz,
        kurztext: p.kurztext,
        empfaengerArt: p.empfaengerArt,
        empfaenger: p.empfaenger,
        leistungsart: p.leistungsart,
        aktiv: p.aktiv
      }))
    }

    const result = await dialog.showSaveDialog({
      title: t('dialog.exportProjects'),
      defaultPath: 'projekte.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }

    writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return { canceled: false, path: result.filePath, count: projekte.length }
  })

  ipcMain.handle('projekte:import', async () => {
    const result = await dialog.showOpenDialog({
      title: t('dialog.importProjects'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }

    const raw = readFileSync(result.filePaths[0], 'utf-8')
    const data = JSON.parse(raw) as ProjektExport
    if (!data || !Array.isArray(data.projekte)) {
      throw new Error(t('err.invalidProjectFile'))
    }

    const stats = upsertProjekteFromImport(
      data.projekte.map((p) => ({
        name: p.name,
        kuerzel: p.kuerzel,
        auftragsnummer: p.auftragsnummer ?? '',
        arbeitsplatz: p.arbeitsplatz ?? '',
        kurztext: p.kurztext ?? '',
        empfaengerArt: p.empfaengerArt,
        empfaenger: p.empfaenger ?? '',
        leistungsart: p.leistungsart ?? '',
        aktiv: p.aktiv !== false
      }))
    )

    return { canceled: false, ...stats }
  })

  ipcMain.handle('buchungen:listByDatum', (_e, datum: string) => listBuchungenByDatum(datum))
  ipcMain.handle('buchungen:create', (_e, input: ZeitbuchungInput) => createBuchung(input))
  ipcMain.handle('buchungen:update', (_e, id: number, input: ZeitbuchungInput) =>
    updateBuchung(id, input)
  )
  ipcMain.handle('buchungen:delete', (_e, id: number) => {
    deleteBuchung(id)
    return true
  })
  ipcMain.handle('buchungen:sapStatus', (_e, datum: string) => getSapTagesStatus(datum))
  ipcMain.handle('buchungen:markSap', (_e, ids: number[]) => markBuchungenSapUeberfuehrt(ids ?? []))
  ipcMain.handle('buchungen:clearSap', (_e, ids: number[]) => clearBuchungenSapUeberfuehrt(ids ?? []))
  ipcMain.handle('buchungen:markSapDatum', (_e, datum: string) => markSapByDatum(datum))
  ipcMain.handle('buchungen:clearSapDatum', (_e, datum: string) => clearSapByDatum(datum))
  ipcMain.handle(
    'buchungen:markSapDatumProjekt',
    (_e, datum: string, projektId: number) => markSapByDatumProjekt(datum, projektId)
  )
  ipcMain.handle(
    'buchungen:clearSapDatumProjekt',
    (_e, datum: string, projektId: number) => clearSapByDatumProjekt(datum, projektId)
  )

  ipcMain.handle('timer:get', () => getLaufenderTimer())
  ipcMain.handle('timer:start', (_e, projektId: number, notiz?: string) => {
    const result = startTimer(projektId, notiz)
    broadcastStatusChanged()
    return result
  })
  ipcMain.handle('timer:stop', () => {
    const result = stopTimer()
    broadcastStatusChanged()
    return result
  })

  ipcMain.handle('woche:get', (_e, wochenStart?: string) => getWochenUebersicht(wochenStart))

  ipcMain.handle('einstellungen:get', () => getEinstellungen())
  ipcMain.handle('einstellungen:save', (_e, settings: Einstellungen) => {
    const saved = saveEinstellungen(settings)
    applyAppLocale(saved)
    applyAutoStartSetting(saved)
    syncFloatingBar()
    broadcastStatusChanged()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('einstellungen:changed', saved)
      }
    }
    return saved
  })
  ipcMain.handle('einstellungen:setKurztextHeute', (_e, kurztext: string) => setKurztextHeute(kurztext))

  ipcMain.handle('floating:getStatus', () => ({
    anwesenheit: getAnwesenheit(),
    timer: getLaufenderTimer(),
    projekte: listProjekteMitZeiten(),
    personalnummer: getEinstellungen().personalnummer
  }))
  ipcMain.handle('floating:showMain', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      showMainWindow(mainWindow)
    }
  })
  ipcMain.handle('floating:getBounds', () => getFloatingBarBounds())
  ipcMain.handle('floating:setPosition', (_e, x: number, y: number) => {
    setFloatingBarPosition(x, y)
  })

  ipcMain.handle('idle:getPrompt', () => getOpenIdlePrompt())
  ipcMain.handle('idle:resolve', (_e, input: IdleResolveInput) => {
    resolveOpenIdlePrompt(input)
    broadcastStatusChanged()
    return true
  })

  ipcMain.handle(
    'export:vorschau',
    (_e, von: string, bis: string, options: ExportOptions = {}) =>
      buildCsvVorschau(von, bis, options)
  )
  ipcMain.handle(
    'export:csv',
    async (_e, von: string, bis: string, options: ExportOptions = {}) => {
      const content = buildCsvContent(von, bis, options)
      const result = await dialog.showSaveDialog({
        title: t('dialog.saveCsv'),
        defaultPath: `zeiten_${von}_${bis}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })

      if (result.canceled || !result.filePath) {
        return { canceled: true, marked: 0 }
      }

      writeFileSync(result.filePath, content, 'utf-8')
      let marked = 0
      if (options.markiereUeberfuehrt) {
        marked = markExportAsSapTransferred(von, bis, options)
      }
      return { canceled: false, path: result.filePath, marked }
    }
  )
  ipcMain.handle('export:markSap', (_e, ids: number[]) => markBuchungenSapUeberfuehrt(ids ?? []))
  ipcMain.handle('export:clearSap', (_e, ids: number[]) => clearBuchungenSapUeberfuehrt(ids ?? []))

  ipcMain.handle('window:minimize', () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (win && !win.isDestroyed()) win.minimize()
  })
  ipcMain.handle('window:maximizeToggle', () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (!win || win.isDestroyed()) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('window:close', () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (win && !win.isDestroyed()) win.close()
  })
  ipcMain.handle('window:isMaximized', () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    return Boolean(win && !win.isDestroyed() && win.isMaximized())
  })
}

app.setName('ProjectTimer')

// App bleibt im Tray laufen, auch wenn kein Fenster sichtbar ist
app.on('window-all-closed', () => {
  // bewusst kein app.quit() – Beenden nur über Tray-Menü
})

app.whenReady().then(() => {
  initDatabase()
  applyAppLocale()
  registerIpc()
  createWindow()
  createTray(() => mainWindow)
  updateTrayMenu()
  syncFloatingBar()
  startIdleMonitor(() => mainWindow)
  startAutoGehenOnShutdown()
  applyAutoStartSetting()

  const startup = runStartupStempel()
  if (startup.restartedSession || startup.autoKommen) {
    broadcastStatusChanged()
  }

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      showMainWindow(mainWindow)
    }
  })
})

app.on('before-quit', () => {
  setQuitting(true)
  // Falls Shutdown-Event nicht greift: offene Sitzung beim Beenden schließen
  // (nur wenn Auto-Gehen aktiv – Tray-Quit mit laufendem Tag bleibt manuell)
  stopIdleMonitor()
  destroyFloatingBar()
  destroyTray()
  closeDatabase()
})
