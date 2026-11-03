import { BrowserWindow, app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateInfo, UpdateChannel, UpdateStatus } from '../shared/types'
import { setQuitting } from './tray'

const GITHUB_OWNER = 'DrScince'
const GITHUB_REPO = 'ProjectTimer'
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

let started = false
let status: UpdateStatus = 'idle'
let channel: UpdateChannel = 'installer'
let availableVersion: string | null = null
let progressPercent: number | null = null
let downloadUrl: string | null = null
let lastError: string | null = null

export function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE)
}

function broadcast(win?: BrowserWindow | null): void {
  const payload = getUpdateInfo()
  const targets = win
    ? [win]
    : BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  for (const target of targets) {
    target.webContents.send('updater:status', payload)
  }
}

export function getUpdateInfo(): AppUpdateInfo {
  return {
    status,
    channel,
    currentVersion: app.getVersion(),
    availableVersion,
    progressPercent,
    downloadUrl,
    error: lastError
  }
}

export function installDownloadedUpdate(): boolean {
  if (channel === 'portable') return false
  if (status !== 'ready') return false
  // Tray-App: sonst fängt close → hideToTray das Install ab
  setQuitting(true)
  // false, true = nach Quit installieren, auch wenn Fenster schließen blockiert
  autoUpdater.quitAndInstall(false, true)
  return true
}

export async function openPortableDownload(): Promise<boolean> {
  if (channel !== 'portable' || status !== 'available') return false
  const url = downloadUrl || RELEASES_PAGE
  await shell.openExternal(url)
  return true
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

function pickPortableAssetUrl(
  assets: Array<{ name: string; browser_download_url: string }>
): string | null {
  const lower = (name: string) => name.toLowerCase()
  const portable =
    assets.find((a) => lower(a.name).includes('portable') && lower(a.name).endsWith('.exe')) ||
    assets.find((a) => lower(a.name).includes('portable')) ||
    assets.find((a) => lower(a.name).endsWith('.zip'))
  return portable?.browser_download_url ?? null
}

async function checkPortableUpdate(getMainWindow: () => BrowserWindow | null): Promise<void> {
  status = 'checking'
  lastError = null
  broadcast(getMainWindow())

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ProjectTimer'
        }
      }
    )
    if (!res.ok) {
      throw new Error(`GitHub Release-Check fehlgeschlagen (${res.status})`)
    }

    const data = (await res.json()) as {
      tag_name?: string
      html_url?: string
      assets?: Array<{ name: string; browser_download_url: string }>
    }

    const remoteVersion = (data.tag_name || '').replace(/^v/i, '')
    const current = app.getVersion()

    if (!remoteVersion || compareSemver(remoteVersion, current) <= 0) {
      status = 'not-available'
      availableVersion = null
      downloadUrl = null
      progressPercent = null
      lastError = null
      broadcast(getMainWindow())
      return
    }

    status = 'available'
    availableVersion = remoteVersion
    downloadUrl = pickPortableAssetUrl(data.assets ?? []) || data.html_url || RELEASES_PAGE
    progressPercent = null
    lastError = null
    broadcast(getMainWindow())
  } catch (err) {
    status = 'error'
    lastError = err instanceof Error ? err.message : String(err)
    broadcast(getMainWindow())
  }
}

function startInstallerUpdater(getMainWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    status = 'checking'
    lastError = null
    broadcast(getMainWindow())
  })

  autoUpdater.on('update-available', (info) => {
    status = 'available'
    availableVersion = info.version
    progressPercent = 0
    downloadUrl = null
    lastError = null
    broadcast(getMainWindow())
  })

  autoUpdater.on('download-progress', (progress) => {
    status = 'downloading'
    progressPercent = Math.round(progress.percent)
    broadcast(getMainWindow())
  })

  autoUpdater.on('update-downloaded', (info) => {
    status = 'ready'
    availableVersion = info.version
    progressPercent = 100
    lastError = null
    broadcast(getMainWindow())
  })

  autoUpdater.on('update-not-available', () => {
    status = 'not-available'
    availableVersion = null
    progressPercent = null
    downloadUrl = null
    lastError = null
    broadcast(getMainWindow())
  })

  autoUpdater.on('error', (err) => {
    status = 'error'
    lastError = err?.message || String(err)
    broadcast(getMainWindow())
  })

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err: Error) => {
      status = 'error'
      lastError = err.message
      broadcast(getMainWindow())
    })
  }, 5000)
}

export function startAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (started || !app.isPackaged) return
  started = true

  channel = isPortableBuild() ? 'portable' : 'installer'

  if (channel === 'portable') {
    setTimeout(() => {
      void checkPortableUpdate(getMainWindow)
    }, 5000)
    return
  }

  startInstallerUpdater(getMainWindow)
}
