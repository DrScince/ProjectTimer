/**
 * Startet die gepackte App mit --pack-smoke.
 * Erfolg: Exit-Code 0 und Logzeile "[pack-smoke] main ready".
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = join(root, 'dist', 'win-unpacked', 'ProjectTimer.exe')
const timeoutMs = Number(process.env.PACK_SMOKE_MS || 45000)

if (!existsSync(exe)) {
  console.error('[pack-smoke] Fehlt:', exe)
  console.error('Zuerst: npm run pack:dir')
  process.exit(1)
}

console.log(`[pack-smoke] Starte ${exe}`)

const child = spawn(exe, ['--pack-smoke'], {
  cwd: dirname(exe),
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
const onData = (d) => {
  const s = d.toString()
  output += s
  process.stdout.write(s)
}
child.stdout.on('data', onData)
child.stderr.on('data', onData)

const killer = setTimeout(() => {
  console.error('[pack-smoke] FAIL – Timeout ohne erfolgreichen Exit')
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
  process.exit(1)
}, timeoutMs)

child.on('exit', (code) => {
  clearTimeout(killer)
  const okReady = /\[pack-smoke\] main ready/.test(output)
  const badModule = /Cannot find module/i.test(output) || /call-bind-apply-helpers/i.test(output)

  if (badModule) {
    console.error('[pack-smoke] FAIL – Modul fehlt')
    process.exit(1)
  }
  if (code === 0 && okReady) {
    console.log('[pack-smoke] OK')
    process.exit(0)
  }
  console.error(`[pack-smoke] FAIL – code=${code}, ready=${okReady}`)
  process.exit(1)
})

child.on('error', (err) => {
  clearTimeout(killer)
  console.error('[pack-smoke] FAIL –', err)
  process.exit(1)
})
