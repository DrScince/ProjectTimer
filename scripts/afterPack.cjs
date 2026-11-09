const path = require('path')
const fs = require('fs')
const rcedit = require('rcedit')

/**
 * Embeddet das App-Icon in die Windows-EXE.
 * Nötig, weil signAndEditExecutable=false das sonst überspringt
 * (winCodeSign braucht lokal Symlink-Rechte).
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const iconPath = path.join(context.packager.projectDir, 'resources', 'icon.ico')

  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] EXE nicht gefunden:', exePath)
    return
  }
  if (!fs.existsSync(iconPath)) {
    console.warn('[afterPack] Icon nicht gefunden:', iconPath)
    return
  }

  try {
    await rcedit(exePath, { icon: iconPath })
    console.log('[afterPack] Icon gesetzt:', exeName)
  } catch (err) {
    // Oft: EXE noch gesperrt (laufende Instanz). Build soll trotzdem weiterlaufen.
    console.warn('[afterPack] Icon konnte nicht gesetzt werden:', err?.message || err)
  }
}
