import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { getEinstellungen, saveEinstellungen } from './database'
import { getIsQuitting } from './tray'
import type { FloatBarEdge, FloatBarLayout, FloatBarMode } from '../shared/types'

const FREE_WIDTH = 720
const FREE_HEIGHT = 44
/** Sichtbarer Streifen im Slideout; Fenster behält volle Größe (Windows-Mindestmaß). */
const PEEK = 8
/** Seitlicher Slideout: ~3× der früheren 56px-Leiste, Höhe passend zu Layout C */
const VERTICAL_EXPANDED_WIDTH = 168
const VERTICAL_EXPANDED_LENGTH = 340

let floatWindow: BrowserWindow | null = null
let expanded = false

export function getFloatingWindow(): BrowserWindow | null {
  return floatWindow
}

function currentMode(): FloatBarMode {
  return getEinstellungen().floatBarMode === 'slideout' ? 'slideout' : 'free'
}

function currentEdge(): FloatBarEdge {
  const edge = getEinstellungen().floatBarEdge
  return edge === 'left' || edge === 'right' || edge === 'top' ? edge : 'top'
}

function currentEdgeOffset(): number | null {
  const offset = getEinstellungen().floatBarEdgeOffset
  return offset == null || !Number.isFinite(offset) ? null : offset
}

function clampAlong(
  size: number,
  areaStart: number,
  areaSize: number,
  savedOffset: number | null
): number {
  const min = areaStart
  const max = areaStart + areaSize - size
  if (max <= min) return Math.round(min)
  if (savedOffset == null) {
    return Math.round(areaStart + (areaSize - size) / 2)
  }
  return Math.min(Math.max(Math.round(areaStart + savedOffset), min), max)
}

function workAreaForWindow(): Electron.Rectangle {
  if (floatWindow && !floatWindow.isDestroyed()) {
    const bounds = floatWindow.getBounds()
    return screen.getDisplayNearestPoint({
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + Math.max(bounds.height, 1) / 2)
    }).workArea
  }
  return screen.getPrimaryDisplay().workArea
}

/**
 * Slideout: Fenster immer in voller Leistengröße halten und nur verschieben.
 * Windows erlaubt oft keine ~8px-Fensterhöhe — eingeklappt liegt der Großteil
 * außerhalb des Bildschirms, nur PEEK-Pixel bleiben sichtbar.
 */
function computeBounds(
  mode: FloatBarMode,
  edge: FloatBarEdge,
  isExpanded: boolean,
  area: Electron.Rectangle
): { x: number; y: number; width: number; height: number } {
  if (mode === 'free') {
    const width = FREE_WIDTH
    const height = FREE_HEIGHT
    const x = Math.round(area.x + (area.width - width) / 2)
    const y = Math.round(area.y + 12)
    return { x, y, width, height }
  }

  const edgeOffset = currentEdgeOffset()

  if (edge === 'left' || edge === 'right') {
    const width = VERTICAL_EXPANDED_WIDTH
    const height = Math.min(VERTICAL_EXPANDED_LENGTH, area.height - 24)
    const y = clampAlong(height, area.y, area.height, edgeOffset)
    if (isExpanded) {
      const x = edge === 'left' ? area.x : area.x + area.width - width
      return { x, y, width, height }
    }
    const x =
      edge === 'left' ? area.x - (width - PEEK) : area.x + area.width - PEEK
    return { x, y, width, height }
  }

  // top / bottom
  const width = Math.min(FREE_WIDTH, area.width - 24)
  const height = FREE_HEIGHT
  const x = clampAlong(width, area.x, area.width, edgeOffset)
  if (isExpanded) {
    const y = edge === 'top' ? area.y : area.y + area.height - height
    return { x, y, width, height }
  }
  const y =
    edge === 'top' ? area.y - (height - PEEK) : area.y + area.height - PEEK
  return { x, y, width, height }
}

const SLIDE_MS = 220

let slideTimer: ReturnType<typeof setTimeout> | null = null

function cancelSlideAnimation(): void {
  if (slideTimer != null) {
    clearTimeout(slideTimer)
    slideTimer = null
  }
}

function toInt(n: number, fallback = 0): number {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? v : fallback
}

function normalizeBounds(bounds: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } {
  return {
    x: toInt(bounds.x),
    y: toInt(bounds.y),
    width: Math.max(1, toInt(bounds.width, 1)),
    height: Math.max(1, toInt(bounds.height, 1))
  }
}

function applyBounds(bounds: {
  x: number
  y: number
  width: number
  height: number
}): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  cancelSlideAnimation()
  const b = normalizeBounds(bounds)
  try {
    floatWindow.setMinimumSize(1, 1)
    floatWindow.setMaximumSize(10000, 10000)
    // Ein setBounds-Aufruf ist auf Windows/DPI robuster als setSize+setPosition
    floatWindow.setBounds(b)
    floatWindow.setMinimumSize(b.width, b.height)
    floatWindow.setMaximumSize(b.width, b.height)
  } catch {
    // Peek/Slide darf die App nicht crashen
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Weiches Verschieben (Slideout); Größe bleibt gleich. */
function animateBoundsTo(
  target: { x: number; y: number; width: number; height: number },
  durationMs = SLIDE_MS
): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  cancelSlideAnimation()

  const to = normalizeBounds(target)
  const raw = floatWindow.getBounds()
  const startX = toInt(raw.x)
  const startY = toInt(raw.y)
  const dx = to.x - startX
  const dy = to.y - startY

  if (dx === 0 && dy === 0) {
    applyBounds(to)
    return
  }

  // Während der Animation Min/Max lockern, sonst scheitert setBounds unter Windows
  try {
    floatWindow.setMinimumSize(1, 1)
    floatWindow.setMaximumSize(10000, 10000)
  } catch {
    applyBounds(to)
    return
  }

  const started = Date.now()
  const step = (): void => {
    if (!floatWindow || floatWindow.isDestroyed()) {
      slideTimer = null
      return
    }
    const t = Math.min(1, (Date.now() - started) / Math.max(1, durationMs))
    const e = easeOutCubic(t)
    const x = toInt(startX + dx * e, to.x)
    const y = toInt(startY + dy * e, to.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      slideTimer = null
      applyBounds(to)
      return
    }
    try {
      floatWindow.setBounds({ x, y, width: to.width, height: to.height })
    } catch {
      slideTimer = null
      applyBounds(to)
      return
    }
    if (t < 1) {
      slideTimer = setTimeout(step, 16)
    } else {
      slideTimer = null
      applyBounds(to)
    }
  }
  step()
}

function applyModeChrome(mode: FloatBarMode): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  floatWindow.setMovable(mode === 'free')
}

export function getFloatBarLayout(): FloatBarLayout {
  return {
    mode: currentMode(),
    edge: currentEdge(),
    expanded: currentMode() === 'free' ? true : expanded
  }
}

export function setFloatBarExpanded(next: boolean): FloatBarLayout {
  if (!floatWindow || floatWindow.isDestroyed()) {
    return getFloatBarLayout()
  }
  const mode = currentMode()
  if (mode === 'free') {
    expanded = true
    return getFloatBarLayout()
  }
  expanded = Boolean(next)
  const bounds = computeBounds(mode, currentEdge(), expanded, workAreaForWindow())
  // Layout zuerst an Renderer (Fade), dann Fenster gleiten lassen
  floatWindow.webContents.send('floating:layout', getFloatBarLayout())
  animateBoundsTo(bounds)
  return getFloatBarLayout()
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

  const mode = currentMode()
  const edge = currentEdge()
  expanded = mode === 'free'
  const area = screen.getPrimaryDisplay().workArea
  const bounds = computeBounds(mode, edge, expanded, area)

  floatWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 1,
    maxWidth: 10000,
    minHeight: 1,
    maxHeight: 10000,
    x: bounds.x,
    y: bounds.y,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: mode === 'free',
    skipTaskbar: true,
    alwaysOnTop: true,
    // Transparent: Peek bleibt dünn, auch wenn Windows Offscreen-Position klemmt
    transparent: true,
    backgroundColor: '#00000000',
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
  applyModeChrome(mode)
  applyBounds(bounds)

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
    expanded = false
  })

  const hash = '#/float'
  if (process.env.ELECTRON_RENDERER_URL) {
    floatWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash}`)
  } else {
    floatWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/float' })
  }

  floatWindow.once('ready-to-show', () => {
    // Nach show erneut setzen — Windows kann Offscreen-Peek sonst zurückschieben
    applyBounds(bounds)
    floatWindow?.showInactive()
    applyBounds(bounds)
    floatWindow?.webContents.send('floating:layout', getFloatBarLayout())
  })
}

export function hideFloatingBar(): void {
  cancelSlideAnimation()
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.destroy()
  }
  floatWindow = null
  expanded = false
}

export function destroyFloatingBar(): void {
  hideFloatingBar()
}

export function getFloatingBarBounds(): {
  x: number
  y: number
  width: number
  height: number
} | null {
  if (!floatWindow || floatWindow.isDestroyed()) return null
  // getBounds() statt getPosition()+getSize(): unter Windows/DPI sonst Drift
  return normalizeBounds(floatWindow.getBounds())
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

/**
 * Frei: beliebig verschieben.
 * Slideout: nur entlang der Kante; Andocken an den Rand bleibt erhalten.
 */
export function setFloatingBarPosition(x: number, y: number): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  const mode = currentMode()

  if (mode === 'free') {
    const clamped = clampToVisibleWorkArea(x, y, FREE_WIDTH, FREE_HEIGHT)
    applyBounds({
      x: clamped.x,
      y: clamped.y,
      width: FREE_WIDTH,
      height: FREE_HEIGHT
    })
    return
  }

  const edge = currentEdge()
  const area = workAreaForWindow()
  const docked = computeBounds(mode, edge, expanded, area)

  if (edge === 'left' || edge === 'right') {
    const minY = area.y
    const maxY = area.y + area.height - docked.height
    const nextY =
      maxY <= minY ? minY : Math.min(Math.max(Math.round(y), minY), maxY)
    applyBounds({
      x: docked.x,
      y: nextY,
      width: docked.width,
      height: docked.height
    })
    return
  }

  const minX = area.x
  const maxX = area.x + area.width - docked.width
  const nextX =
    maxX <= minX ? minX : Math.min(Math.max(Math.round(x), minX), maxX)
  applyBounds({
    x: nextX,
    y: docked.y,
    width: docked.width,
    height: docked.height
  })
}

/** Speichert den aktuellen Kanten-Versatz nach dem Ziehen im Slideout. */
export function persistFloatingBarEdgeOffset(): number | null {
  if (!floatWindow || floatWindow.isDestroyed()) return currentEdgeOffset()
  if (currentMode() !== 'slideout') return currentEdgeOffset()

  const edge = currentEdge()
  const area = workAreaForWindow()
  const bounds = normalizeBounds(floatWindow.getBounds())
  const offset =
    edge === 'left' || edge === 'right' ? bounds.y - area.y : bounds.x - area.x

  const settings = getEinstellungen()
  saveEinstellungen({
    ...settings,
    floatBarEdgeOffset: Math.round(offset)
  })
  return Math.round(offset)
}
