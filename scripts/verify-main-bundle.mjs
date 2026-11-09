/**
 * Verhindert Installer-Crashes: Pure-JS-Deps dürfen im Main-Bundle
 * nicht als bare require("…") stehen bleiben.
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainJs = join(root, 'out', 'main', 'index.js')

if (!existsSync(mainJs)) {
  console.error('[verify-main-bundle] Fehlt:', mainJs, '– zuerst npm run build')
  process.exit(1)
}

const src = readFileSync(mainJs, 'utf8')
const forbidden = [
  'call-bind-apply-helpers',
  'exceljs',
  'pdfkit'
]

const hits = []
for (const name of forbidden) {
  const re = new RegExp(String.raw`require\(["']${name}(?:\/[^"']*)?["']\)`, 'g')
  const found = src.match(re)
  if (found?.length) hits.push(...found)
}

if (hits.length) {
  console.error('[verify-main-bundle] FAIL – externe Requires im Main-Bundle:')
  for (const h of hits) console.error(' ', h)
  console.error(
    'Diese Module müssen gebündelt werden (externalizeDepsPlugin.exclude), sonst crasht der Installer.'
  )
  process.exit(1)
}

const requiredExternal = ['better-sqlite3', 'electron-updater']
for (const name of requiredExternal) {
  const re = new RegExp(String.raw`require\(["']${name}["']\)`)
  if (!re.test(src)) {
    console.warn(`[verify-main-bundle] Hinweis: kein require("${name}") gefunden (ok falls umbenannt)`)
  }
}

if (/#standard-fonts\//.test(src)) {
  console.error(
    '[verify-main-bundle] FAIL – unresolved pdfkit import "#standard-fonts/…" im Bundle (PDF-Export kaputt).'
  )
  process.exit(1)
}

console.log('[verify-main-bundle] OK – keine verbotenen externen Requires')
