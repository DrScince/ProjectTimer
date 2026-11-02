import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'projecttimer-smoke-'))
const dbPath = join(dir, 'test.db')
const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE projekte (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kuerzel TEXT NOT NULL UNIQUE,
    empfaenger_art TEXT NOT NULL,
    empfaenger TEXT NOT NULL DEFAULT '',
    leistungsart TEXT NOT NULL DEFAULT '',
    aktiv INTEGER NOT NULL DEFAULT 1,
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE zeitbuchungen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projekt_id INTEGER NOT NULL,
    datum TEXT NOT NULL,
    start_zeit TEXT,
    ende_zeit TEXT,
    dauer_minuten INTEGER,
    notiz TEXT NOT NULL DEFAULT '',
    quelle TEXT NOT NULL DEFAULT 'manuell',
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (projekt_id) REFERENCES projekte(id)
  );
  CREATE TABLE einstellungen (
    schluessel TEXT PRIMARY KEY,
    wert TEXT NOT NULL
  );
`)

db.prepare(
  `INSERT INTO einstellungen (schluessel, wert) VALUES
    ('anzeigename', 'Tester'),
    ('personalnummer', '4711'),
    ('csvTrennzeichen', ';'),
    ('csvSpalten', ?)`
).run(JSON.stringify([
  'personalnummer',
  'datum',
  'stunden',
  'projektKuerzel',
  'empfaengerArt',
  'empfaenger',
  'leistungsart',
  'notiz'
]))

const projekt = db
  .prepare(
    `INSERT INTO projekte (name, kuerzel, empfaenger_art, empfaenger, leistungsart, aktiv)
     VALUES ('Demo Projekt', 'DEMO', 'Kostenstelle', '123456', '9001', 1)`
  )
  .run()

const projektId = Number(projekt.lastInsertRowid)
const today = new Date()
const y = today.getFullYear()
const m = String(today.getMonth() + 1).padStart(2, '0')
const d = String(today.getDate()).padStart(2, '0')
const datum = `${y}-${m}-${d}`

db.prepare(
  `INSERT INTO zeitbuchungen (projekt_id, datum, start_zeit, ende_zeit, dauer_minuten, notiz, quelle)
   VALUES (?, ?, NULL, NULL, 90, 'Manuell', 'manuell')`
).run(projektId, datum)

db.prepare(
  `INSERT INTO zeitbuchungen (projekt_id, datum, start_zeit, ende_zeit, dauer_minuten, notiz, quelle)
   VALUES (?, ?, '09:00', '10:30', 90, 'Mit Zeiten', 'manuell')`
).run(projektId, datum)

const rows = db
  .prepare(
    `SELECT z.*, p.kuerzel, p.empfaenger_art, p.empfaenger, p.leistungsart
     FROM zeitbuchungen z JOIN projekte p ON p.id = z.projekt_id
     WHERE z.datum = ?`
  )
  .all(datum)

function istAbgeschlossen(b) {
  if (b.ende_zeit != null) return true
  if (b.quelle === 'manuell' && b.dauer_minuten != null && b.dauer_minuten > 0) return true
  return false
}

const abgeschlossen = rows.filter(istAbgeschlossen)
if (abgeschlossen.length !== 2) {
  throw new Error(`Erwartet 2 abgeschlossene Buchungen, gefunden ${abgeschlossen.length}`)
}

const settings = Object.fromEntries(
  db.prepare('SELECT schluessel, wert FROM einstellungen').all().map((r) => [r.schluessel, r.wert])
)
const cols = JSON.parse(settings.csvSpalten)
const delim = settings.csvTrennzeichen
const header = cols.join(delim)
const csvRows = abgeschlossen.map((b) => {
  const stunden = (b.dauer_minuten / 60).toFixed(2).replace('.', ',')
  const [yy, mm, dd] = b.datum.split('-')
  const record = {
    personalnummer: settings.personalnummer,
    datum: `${dd}.${mm}.${yy}`,
    stunden,
    projektKuerzel: b.kuerzel,
    empfaengerArt: b.empfaenger_art,
    empfaenger: b.empfaenger,
    leistungsart: b.leistungsart,
    notiz: b.notiz
  }
  return cols.map((c) => record[c]).join(delim)
})
const csv = `\uFEFF${[header, ...csvRows].join('\r\n')}`
const csvPath = join(dir, 'export.csv')
writeFileSync(csvPath, csv, 'utf-8')
const content = readFileSync(csvPath, 'utf-8')
if (!content.includes('4711') || !content.includes('1,50') || !content.includes('DEMO')) {
  throw new Error('CSV-Inhalt unerwartet:\n' + content)
}

const exportJson = {
  version: 1,
  exportedAt: new Date().toISOString(),
  projekte: db
    .prepare('SELECT name, kuerzel, empfaenger_art as empfaengerArt, empfaenger, leistungsart, aktiv FROM projekte')
    .all()
    .map((p) => ({ ...p, aktiv: Boolean(p.aktiv) }))
}
const jsonPath = join(dir, 'projekte.json')
writeFileSync(jsonPath, JSON.stringify(exportJson, null, 2))
const loaded = JSON.parse(readFileSync(jsonPath, 'utf-8'))
if (loaded.projekte.length !== 1 || loaded.projekte[0].kuerzel !== 'DEMO') {
  throw new Error('JSON Export/Import-Struktur fehlerhaft')
}

db.close()
rmSync(dir, { recursive: true, force: true })
console.log('Smoke-Test OK: Projekte, Buchungen, CSV und JSON')
