/**
 * Zuverlässige Electron-Binary-Installation für Windows.
 * extract-zip kann in manchen Umgebungen unvollständig extrahieren;
 * daher Fallback über PowerShell Expand-Archive.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { downloadArtifact } = require('@electron/get')

async function main() {
  const electronDir = path.resolve(__dirname, '../node_modules/electron')
  const version = require(path.join(electronDir, 'package.json')).version
  const distDir = path.join(electronDir, 'dist')
  const exePath = path.join(distDir, 'electron.exe')

  if (fs.existsSync(exePath) && fs.existsSync(path.join(electronDir, 'path.txt'))) {
    console.log('Electron bereits installiert:', exePath)
    return
  }

  console.log('Lade Electron', version, '...')
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: 'win32',
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    force: false
  })
  console.log('Heruntergeladen:', zipPath)

  fs.rmSync(distDir, { recursive: true, force: true })
  fs.mkdirSync(distDir, { recursive: true })

  const ps = `
    Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distDir.replace(/'/g, "''")}' -Force
  `
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' })

  if (!fs.existsSync(exePath)) {
    throw new Error('electron.exe fehlt nach Extraktion')
  }

  fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe')
  console.log('Electron installiert:', exePath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
