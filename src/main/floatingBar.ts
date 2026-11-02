import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { getEinstellungen, saveEinstellungen } from './database'
import { getIsQuitting } from './tray'

let floatWindow: BrowserWindow | null = null

export function getFloatingWindow(): BrowserWindow | null {
  return floatWindow
}

export function syncFloatingBar(): void {
  const enabled = getEinstellungen().alwaysOnTopBar
  if (enabled) {
    showFloatingBar()
  } else {
    hideFloatingBar()
  }
}

export function showFloatingBar(): void {
  // Bestehendes Fenster neu aufbauen (Größe/Style-Änderungen greifen sonst nicht)
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.destroy()
    floatWindow = null
  }

  const display = screen.getPrimaryDisplay().workArea
  const width = 820
  const height = 54
  const x = Math.round(display.x + (display.width - width) / 2)
  const y = Math.round(display.y + 12)

  floatWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#0f172a',
    hasShadow: false,
    thickFrame: false,
    title: 'ProjectTimer Leiste',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  floatWindow.setAlwaysOnTop(true, 'screen-saver')
  floatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  floatWindow.setMovable(true)

  floatWindow.on('close', (event) => {
    if (!getIsQuitting()) {
      event.preventDefault()
      const settings = getEinstellungen()
      saveEinstellungen({ ...settings, alwaysOnTopBar: false })
      hideFloatingBar()
    }
  })

  floatWindow.on('closed', () => {
    floatWindow = null
  })

  const hash = '#/float'
  if (process.env.ELECTRON_RENDERER_URL) {
    floatWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash}`)
  } else {
    floatWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/float' })
  }

  floatWindow.once('ready-to-show', () => {
    floatWindow?.show()
  })
}

export function hideFloatingBar(): void {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.destroy()
  }
  floatWindow = null
}

export function destroyFloatingBar(): void {
  hideFloatingBar()
}

export function getFloatingBarBounds(): { x: number; y: number; width: number; height: number } | null {
  if (!floatWindow || floatWindow.isDestroyed()) return null
  const [x, y] = floatWindow.getPosition()
  const [width, height] = floatWindow.getSize()
  return { x, y, width, height }
}

/** Hält die Leiste vollständig im sichtbaren Arbeitsbereich (Taskleiste ausgespart). */
function clampToVisibleWorkArea(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2)
  })
  const area = display.workArea
  const maxX = area.x + area.width - width
  const maxY = area.y + area.height - height
  return {
    x: Math.min(Math.max(Math.round(x), area.x), Math.max(area.x, maxX)),
    y: Math.min(Math.max(Math.round(y), area.y), Math.max(area.y, maxY))
  }
}

export function setFloatingBarPosition(x: number, y: number): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  const [width, height] = floatWindow.getSize()
  const clamped = clampToVisibleWorkArea(x, y, width, height)
  floatWindow.setPosition(clamped.x, clamped.y)
}
