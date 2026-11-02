import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { t } from '../shared/i18n'

let tray: Tray | null = null
let isQuitting = false
let getMainWindow: (() => BrowserWindow | null) | null = null
/** Ob der Nutzer das Hauptfenster sichtbar haben will (unabhängig von OS-Unlock-Quirks) */
let mainWindowUserVisible = false

export function setQuitting(value: boolean): void {
  isQuitting = value
}

export function getIsQuitting(): boolean {
  return isQuitting
}

export function getMainWindowUserVisible(): boolean {
  return mainWindowUserVisible
}

function resolveTrayIconPath(): string {
  const candidates = [
    join(__dirname, '../../resources/tray.png'),
    join(process.resourcesPath, 'tray.png'),
    join(app.getAppPath(), 'resources/tray.png')
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return candidates[0]
}

function loadTrayImage(): Electron.NativeImage {
  const iconPath = resolveTrayIconPath()
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    const fallback = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVQ4T2NkYGD4z0ABYBw1gGE0DBhGwwAEADEYAG1o6b4dAAAAAElFTkSuQmCC',
      'base64'
    )
    image = nativeImage.createFromBuffer(fallback)
  }
  return image.resize({ width: 16, height: 16 })
}

export function showMainWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  mainWindowUserVisible = true
}

export function hideToTray(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  win.hide()
  mainWindowUserVisible = false
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: t('tray.show'),
      click: () => showMainWindow(getMainWindow?.() ?? null)
    },
    { type: 'separator' },
    {
      label: t('tray.quit'),
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
}

export function updateTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(buildTrayMenu())
}

export function createTray(getWindow: () => BrowserWindow | null): Tray {
  if (tray) return tray

  getMainWindow = getWindow
  tray = new Tray(loadTrayImage())
  tray.setToolTip('ProjectTimer')
  tray.setContextMenu(buildTrayMenu())

  tray.on('click', () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isVisible()) {
      hideToTray(win)
    } else {
      showMainWindow(win)
    }
  })

  tray.on('double-click', () => {
    showMainWindow(getWindow())
  })

  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
  getMainWindow = null
}
