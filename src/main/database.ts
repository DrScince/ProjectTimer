import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_CSV_SPALTEN,
  type Anwesenheit,
  type AnwesenheitTagSumme,
  type Einstellungen,
  type EmpfaengerArt,
  type IdleResolveInput,
  type Projekt,
  type ProjektInput,
  type ProjektMitZeit,
  type SapTagesStatus,
  type SapTransferStatus,
  type TagesThema,
  type TopicVerteilung,
  type Zeitbuchung,
  type ZeitbuchungInput,
  type ZeitbuchungMitProjekt
} from '../shared/types'
import { t } from '../shared/i18n'

let db: Database.Database | null = null

function getDbPath(): string {
  // userData ist nach app.setName('ProjectTimer') = %AppData%\ProjectTimer
  const dir = app.getPath('userData')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'projecttimer.db')
}

export function initDatabase(): void {
  db = new Database(getDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS projekte (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kuerzel TEXT NOT NULL UNIQUE,
      auftragsnummer TEXT NOT NULL DEFAULT '',
      arbeitsplatz TEXT NOT NULL DEFAULT '',
      kurztext TEXT NOT NULL DEFAULT '',
      empfaenger_art TEXT NOT NULL,
      empfaenger TEXT NOT NULL DEFAULT '',
      leistungsart TEXT NOT NULL DEFAULT '',
      aktiv INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      erstellt_am TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS zeitbuchungen (
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

    CREATE TABLE IF NOT EXISTS einstellungen (
      schluessel TEXT PRIMARY KEY,
      wert TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anwesenheit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kommen_am TEXT NOT NULL,
      gehen_am TEXT,
      pause_seit TEXT,
      pausen_minuten INTEGER NOT NULL DEFAULT 0,
      last_seen_am TEXT
    );

    CREATE TABLE IF NOT EXISTS tages_themen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      datum TEXT NOT NULL,
      projekt_id INTEGER NOT NULL,
      kurztext TEXT NOT NULL,
      erstellt_am TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(datum, projekt_id, kurztext),
      FOREIGN KEY (projekt_id) REFERENCES projekte(id)
    );
  `)

  migrateSchema()
  seedEinstellungen()
}

function migrateSchema(): void {
  try {
    const database = getDb()
    const cols = database.prepare('PRAGMA table_info(projekte)').all() as Array<{ name: string }>
    const names = new Set(cols.map((c) => c.name))
    // Ohne NOT NULL: ältere SQLite-Versionen können sonst bei ALTER scheitern
    if (!names.has('auftragsnummer')) {
      database.exec(`ALTER TABLE projekte ADD COLUMN auftragsnummer TEXT DEFAULT ''`)
      console.log('[ProjectTimer] Migration: Spalte auftragsnummer hinzugefügt')
    }
    if (!names.has('arbeitsplatz')) {
      database.exec(`ALTER TABLE projekte ADD COLUMN arbeitsplatz TEXT DEFAULT ''`)
      console.log('[ProjectTimer] Migration: Spalte arbeitsplatz hinzugefügt')
    }
    if (!names.has('kurztext')) {
      database.exec(`ALTER TABLE projekte ADD COLUMN kurztext TEXT DEFAULT ''`)
      console.log('[ProjectTimer] Migration: Spalte kurztext hinzugefügt')
    }
    if (!names.has('sort_order')) {
      database.exec(`ALTER TABLE projekte ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
      // Bestehende Projekte alphabetisch als Startreihenfolge übernehmen
      const rows = database
        .prepare(`SELECT id FROM projekte ORDER BY name COLLATE NOCASE, id`)
        .all() as Array<{ id: number }>
      const update = database.prepare(`UPDATE projekte SET sort_order = ? WHERE id = ?`)
      const tx = database.transaction(() => {
        rows.forEach((row, index) => update.run(index, row.id))
      })
      tx()
      console.log('[ProjectTimer] Migration: Spalte sort_order hinzugefügt')
    }

    const buchungCols = database
      .prepare('PRAGMA table_info(zeitbuchungen)')
      .all() as Array<{ name: string }>
    const buchungNames = new Set(buchungCols.map((c) => c.name))
    if (!buchungNames.has('sap_ueberfuehrt_am')) {
      database.exec(`ALTER TABLE zeitbuchungen ADD COLUMN sap_ueberfuehrt_am TEXT`)
      console.log('[ProjectTimer] Migration: Spalte sap_ueberfuehrt_am hinzugefügt')
    }

    const anwCols = database
      .prepare('PRAGMA table_info(anwesenheit)')
      .all() as Array<{ name: string }>
    const anwNames = new Set(anwCols.map((c) => c.name))
    if (!anwNames.has('last_seen_am')) {
      database.exec(`ALTER TABLE anwesenheit ADD COLUMN last_seen_am TEXT`)
      console.log('[ProjectTimer] Migration: Spalte anwesenheit.last_seen_am hinzugefügt')
    }
  } catch (err) {
    console.error('[ProjectTimer] Schema-Migration fehlgeschlagen:', err)
    throw err
  }
}

function getDb(): Database.Database {
  if (!db) {
    throw new Error(t('err.dbNotInit'))
  }
  return db
}

function seedEinstellungen(): void {
  const database = getDb()
  const defaults: Record<string, string> = {
    anzeigename: '',
    personalnummer: '',
    csvTrennzeichen: ';',
    csvSpalten: JSON.stringify([...DEFAULT_CSV_SPALTEN]),
    alwaysOnTopBar: '0',
    floatBarMode: 'free',
    floatBarEdge: 'top',
    floatBarEdgeOffset: '',
    darkMode: '0',
    idleDetectionEnabled: '1',
    idleThresholdMinutes: '5',
    language: 'system',
    kurztextHeute: '',
    kurztextDatum: ''
  }

  const insert = database.prepare(
    'INSERT OR IGNORE INTO einstellungen (schluessel, wert) VALUES (?, ?)'
  )
  const tx = database.transaction(() => {
    for (const [key, value] of Object.entries(defaults)) {
      insert.run(key, value)
    }
  })
  tx()
}

function mapProjekt(row: Record<string, unknown>): Projekt {
  return {
    id: row.id as number,
    name: row.name as string,
    kuerzel: row.kuerzel as string,
    auftragsnummer: (row.auftragsnummer as string) ?? '',
    arbeitsplatz: (row.arbeitsplatz as string) ?? '',
    kurztext: (row.kurztext as string) ?? '',
    empfaengerArt: row.empfaenger_art as EmpfaengerArt,
    empfaenger: row.empfaenger as string,
    leistungsart: row.leistungsart as string,
    aktiv: Boolean(row.aktiv),
    sortOrder: Number(row.sort_order ?? 0),
    erstelltAm: row.erstellt_am as string
  }
}

function mapBuchung(row: Record<string, unknown>): Zeitbuchung {
  return {
    id: row.id as number,
    projektId: row.projekt_id as number,
    datum: row.datum as string,
    startZeit: (row.start_zeit as string) ?? null,
    endeZeit: (row.ende_zeit as string) ?? null,
    dauerMinuten: (row.dauer_minuten as number) ?? null,
    notiz: row.notiz as string,
    quelle: row.quelle as Zeitbuchung['quelle'],
    erstelltAm: row.erstellt_am as string,
    sapUeberfuehrtAm: (row.sap_ueberfuehrt_am as string) ?? null
  }
}

function mapBuchungMitProjekt(row: Record<string, unknown>): ZeitbuchungMitProjekt {
  return {
    ...mapBuchung(row),
    projektName: row.projekt_name as string,
    projektKuerzel: row.projekt_kuerzel as string,
    auftragsnummer: (row.auftragsnummer as string) ?? '',
    arbeitsplatz: (row.arbeitsplatz as string) ?? '',
    empfaengerArt: row.empfaenger_art as EmpfaengerArt,
    empfaenger: row.empfaenger as string,
    leistungsart: row.leistungsart as string
  }
}

const BUCHUNG_SELECT = `
  SELECT
    z.*,
    p.name AS projekt_name,
    p.kuerzel AS projekt_kuerzel,
    p.auftragsnummer,
    p.arbeitsplatz,
    p.empfaenger_art,
    p.empfaenger,
    p.leistungsart
  FROM zeitbuchungen z
  JOIN projekte p ON p.id = z.projekt_id
`

export function listProjekte(nurAktiv = false): Projekt[] {
  const sql = nurAktiv
    ? 'SELECT * FROM projekte WHERE aktiv = 1 ORDER BY sort_order ASC, name COLLATE NOCASE, id'
    : 'SELECT * FROM projekte ORDER BY sort_order ASC, name COLLATE NOCASE, id'
  return getDb().prepare(sql).all().map((row) => mapProjekt(row as Record<string, unknown>))
}

function nextSortOrder(): number {
  const row = getDb().prepare(`SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM projekte`).get() as {
    maxOrder: number
  }
  return Number(row.maxOrder) + 1
}

export function getProjekt(id: number): Projekt | null {
  const row = getDb().prepare('SELECT * FROM projekte WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? mapProjekt(row) : null
}

export function createProjekt(input: ProjektInput): Projekt {
  if (!input.auftragsnummer.trim()) {
    throw new Error(t('err.orderNoRequired'))
  }
  if (!input.arbeitsplatz.trim()) {
    throw new Error(t('err.workplaceRequired'))
  }
  const result = getDb()
    .prepare(
      `INSERT INTO projekte
        (name, kuerzel, auftragsnummer, arbeitsplatz, kurztext, empfaenger_art, empfaenger, leistungsart, aktiv, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name.trim(),
      input.kuerzel.trim().toUpperCase(),
      input.auftragsnummer.trim(),
      input.arbeitsplatz.trim().toUpperCase(),
      input.kurztext?.trim() ?? '',
      input.empfaengerArt,
      input.empfaenger.trim(),
      input.leistungsart.trim(),
      input.aktiv === false ? 0 : 1,
      nextSortOrder()
    )
  return getProjekt(Number(result.lastInsertRowid))!
}

/** Reihenfolge setzen: IDs in gewünschter Anzeigereihenfolge */
export function reorderProjekte(orderedIds: number[]): Projekt[] {
  const uniqueIds = [...new Set(orderedIds.filter((id) => Number.isFinite(id)))]
  if (uniqueIds.length === 0) return listProjekte(false)

  const database = getDb()
  const stmt = database.prepare(`UPDATE projekte SET sort_order = ? WHERE id = ?`)
  const tx = database.transaction(() => {
    uniqueIds.forEach((id, index) => stmt.run(index, id))
  })
  tx()
  return listProjekte(false)
}

export function moveProjekt(id: number, direction: 'up' | 'down'): Projekt[] {
  const list = listProjekte(false)
  const index = list.findIndex((p) => p.id === id)
  if (index < 0) return list
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= list.length) return list

  const next = [...list]
  const tmp = next[index]
  next[index] = next[swapWith]
  next[swapWith] = tmp
  return reorderProjekte(next.map((p) => p.id))
}

export function updateProjekt(id: number, input: ProjektInput): Projekt {
  if (!input.auftragsnummer.trim()) {
    throw new Error(t('err.orderNoRequired'))
  }
  if (!input.arbeitsplatz.trim()) {
    throw new Error(t('err.workplaceRequired'))
  }
  getDb()
    .prepare(
      `UPDATE projekte
       SET name = ?, kuerzel = ?, auftragsnummer = ?, arbeitsplatz = ?, kurztext = ?,
           empfaenger_art = ?, empfaenger = ?, leistungsart = ?, aktiv = ?
       WHERE id = ?`
    )
    .run(
      input.name.trim(),
      input.kuerzel.trim().toUpperCase(),
      input.auftragsnummer.trim(),
      input.arbeitsplatz.trim().toUpperCase(),
      input.kurztext?.trim() ?? '',
      input.empfaengerArt,
      input.empfaenger.trim(),
      input.leistungsart.trim(),
      input.aktiv === false ? 0 : 1,
      id
    )
  return getProjekt(id)!
}

export function updateProjektKurztext(id: number, kurztext: string): Projekt {
  getDb()
    .prepare('UPDATE projekte SET kurztext = ? WHERE id = ?')
    .run(kurztext.trim(), id)
  return getProjekt(id)!
}

export function setProjektAktiv(id: number, aktiv: boolean): Projekt {
  getDb().prepare('UPDATE projekte SET aktiv = ? WHERE id = ?').run(aktiv ? 1 : 0, id)
  return getProjekt(id)!
}

export function deleteProjekt(id: number): void {
  const laufend = getLaufenderTimer()
  if (laufend?.projektId === id) {
    throw new Error(t('err.timerRunning'))
  }
  const database = getDb()
  const tx = database.transaction(() => {
    database.prepare('DELETE FROM zeitbuchungen WHERE projekt_id = ?').run(id)
    database.prepare('DELETE FROM projekte WHERE id = ?').run(id)
  })
  tx()
}

export function upsertProjekteFromImport(
  items: ProjektInput[]
): { created: number; updated: number } {
  const database = getDb()
  const find = database.prepare('SELECT id FROM projekte WHERE kuerzel = ? COLLATE NOCASE')
  let created = 0
  let updated = 0

  const tx = database.transaction(() => {
    for (const item of items) {
      const existing = find.get(item.kuerzel.trim().toUpperCase()) as { id: number } | undefined
      if (existing) {
        updateProjekt(existing.id, { ...item, aktiv: item.aktiv !== false })
        updated += 1
      } else {
        createProjekt({ ...item, aktiv: item.aktiv !== false })
        created += 1
      }
    }
  })
  tx()
  return { created, updated }
}

export function listBuchungenByDatum(datum: string): ZeitbuchungMitProjekt[] {
  return getDb()
    .prepare(`${BUCHUNG_SELECT} WHERE z.datum = ? ORDER BY COALESCE(z.start_zeit, '99:99'), z.id`)
    .all(datum)
    .map((row) => mapBuchungMitProjekt(row as Record<string, unknown>))
}

export function listBuchungenByRange(von: string, bis: string): ZeitbuchungMitProjekt[] {
  return getDb()
    .prepare(
      `${BUCHUNG_SELECT}
       WHERE z.datum >= ? AND z.datum <= ?
       ORDER BY z.datum, COALESCE(z.start_zeit, '99:99'), z.id`
    )
    .all(von, bis)
    .map((row) => mapBuchungMitProjekt(row as Record<string, unknown>))
}

export function istBuchungAbgeschlossen(buchung: Zeitbuchung): boolean {
  if (buchung.endeZeit != null) return true
  if (buchung.quelle === 'manuell' && buchung.dauerMinuten != null && buchung.dauerMinuten > 0) {
    return true
  }
  return false
}

export function markBuchungenSapUeberfuehrt(
  ids: number[],
  am: string = new Date().toISOString()
): number {
  if (ids.length === 0) return 0
  const database = getDb()
  const stmt = database.prepare(
    `UPDATE zeitbuchungen SET sap_ueberfuehrt_am = ? WHERE id = ? AND sap_ueberfuehrt_am IS NULL`
  )
  const tx = database.transaction(() => {
    let count = 0
    for (const id of ids) {
      const result = stmt.run(am, id)
      count += result.changes
    }
    return count
  })
  return tx()
}

export function clearBuchungenSapUeberfuehrt(ids: number[]): number {
  if (ids.length === 0) return 0
  const database = getDb()
  const stmt = database.prepare(
    `UPDATE zeitbuchungen SET sap_ueberfuehrt_am = NULL WHERE id = ?`
  )
  const tx = database.transaction(() => {
    let count = 0
    for (const id of ids) {
      const result = stmt.run(id)
      count += result.changes
    }
    return count
  })
  return tx()
}

function sapStatusFromBuchungen(
  buchungen: Zeitbuchung[]
): { status: SapTransferStatus | 'leer'; zuletztUeberfuehrtAm: string | null } {
  if (buchungen.length === 0) {
    return { status: 'leer', zuletztUeberfuehrtAm: null }
  }
  const transferred = buchungen.filter((b) => Boolean(b.sapUeberfuehrtAm))
  if (transferred.length === 0) {
    return { status: 'offen', zuletztUeberfuehrtAm: null }
  }
  const times = transferred
    .map((b) => b.sapUeberfuehrtAm as string)
    .sort()
  const zuletzt = times[times.length - 1] ?? null
  if (transferred.length === buchungen.length) {
    return { status: 'ueberfuehrt', zuletztUeberfuehrtAm: zuletzt }
  }
  return { status: 'gemischt', zuletztUeberfuehrtAm: zuletzt }
}

export function getSapTagesStatus(datum: string): SapTagesStatus {
  const buchungen = listBuchungenByDatum(datum).filter(istBuchungAbgeschlossen)
  const offen = buchungen.filter((b) => !b.sapUeberfuehrtAm).length
  const ueberfuehrt = buchungen.length - offen
  const { status, zuletztUeberfuehrtAm } = sapStatusFromBuchungen(buchungen)
  return {
    datum,
    gesamt: buchungen.length,
    offen,
    ueberfuehrt,
    status,
    zuletztUeberfuehrtAm
  }
}

export function markSapByDatum(datum: string): number {
  const ids = listBuchungenByDatum(datum)
    .filter((b) => istBuchungAbgeschlossen(b) && !b.sapUeberfuehrtAm)
    .map((b) => b.id)
  return markBuchungenSapUeberfuehrt(ids)
}

export function clearSapByDatum(datum: string): number {
  const ids = listBuchungenByDatum(datum)
    .filter((b) => istBuchungAbgeschlossen(b) && Boolean(b.sapUeberfuehrtAm))
    .map((b) => b.id)
  return clearBuchungenSapUeberfuehrt(ids)
}

export function markSapByDatumProjekt(datum: string, projektId: number): number {
  const ids = listBuchungenByDatum(datum)
    .filter(
      (b) =>
        b.projektId === projektId && istBuchungAbgeschlossen(b) && !b.sapUeberfuehrtAm
    )
    .map((b) => b.id)
  return markBuchungenSapUeberfuehrt(ids)
}

export function clearSapByDatumProjekt(datum: string, projektId: number): number {
  const ids = listBuchungenByDatum(datum)
    .filter(
      (b) =>
        b.projektId === projektId &&
        istBuchungAbgeschlossen(b) &&
        Boolean(b.sapUeberfuehrtAm)
    )
    .map((b) => b.id)
  return clearBuchungenSapUeberfuehrt(ids)
}

export function markSapByDatumProjektNotiz(
  datum: string,
  projektId: number,
  kurztext: string
): number {
  const topic = kurztext.trim()
  const ids = listBuchungenByDatum(datum)
    .filter(
      (b) =>
        b.projektId === projektId &&
        (b.notiz ?? '').trim() === topic &&
        istBuchungAbgeschlossen(b) &&
        !b.sapUeberfuehrtAm
    )
    .map((b) => b.id)
  return markBuchungenSapUeberfuehrt(ids)
}

export function clearSapByDatumProjektNotiz(
  datum: string,
  projektId: number,
  kurztext: string
): number {
  const topic = kurztext.trim()
  const ids = listBuchungenByDatum(datum)
    .filter(
      (b) =>
        b.projektId === projektId &&
        (b.notiz ?? '').trim() === topic &&
        istBuchungAbgeschlossen(b) &&
        Boolean(b.sapUeberfuehrtAm)
    )
    .map((b) => b.id)
  return clearBuchungenSapUeberfuehrt(ids)
}

export function getLaufenderTimer(): ZeitbuchungMitProjekt | null {
  const row = getDb()
    .prepare(`${BUCHUNG_SELECT} WHERE z.ende_zeit IS NULL AND z.quelle = 'timer' ORDER BY z.id DESC LIMIT 1`)
    .get() as Record<string, unknown> | undefined
  return row ? mapBuchungMitProjekt(row) : null
}

function berechneDauerMinuten(
  startZeit: string | null | undefined,
  endeZeit: string | null | undefined,
  dauerMinuten: number | null | undefined
): number | null {
  if (dauerMinuten != null && dauerMinuten > 0 && (!startZeit || !endeZeit)) {
    return Math.round(dauerMinuten)
  }
  if (startZeit && endeZeit) {
    const [sh, sm] = startZeit.split(':').map(Number)
    const [eh, em] = endeZeit.split(':').map(Number)
    let minutes = eh * 60 + em - (sh * 60 + sm)
    if (minutes < 0) minutes += 24 * 60
    return minutes
  }
  return dauerMinuten ?? null
}

function getBuchungMitProjekt(id: number): ZeitbuchungMitProjekt {
  const row = getDb()
    .prepare(`${BUCHUNG_SELECT} WHERE z.id = ?`)
    .get(id) as Record<string, unknown> | undefined
  if (!row) {
    throw new Error(t('err.bookingNotFound'))
  }
  return mapBuchungMitProjekt(row)
}

export function createBuchung(input: ZeitbuchungInput): ZeitbuchungMitProjekt {
  const projekt = getProjekt(input.projektId)
  if (!projekt?.auftragsnummer || !projekt.arbeitsplatz) {
    throw new Error(t('err.orderNeedsFields'))
  }
  const dauer = berechneDauerMinuten(input.startZeit, input.endeZeit, input.dauerMinuten)
  const notiz = input.notiz?.trim() ?? ''
  if (notiz) {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO tages_themen (datum, projekt_id, kurztext) VALUES (?, ?, ?)`
      )
      .run(input.datum, input.projektId, notiz)
  }
  const result = getDb()
    .prepare(
      `INSERT INTO zeitbuchungen
        (projekt_id, datum, start_zeit, ende_zeit, dauer_minuten, notiz, quelle)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.projektId,
      input.datum,
      input.startZeit ?? null,
      input.endeZeit ?? null,
      dauer,
      notiz,
      input.quelle ?? 'manuell'
    )

  return getBuchungMitProjekt(Number(result.lastInsertRowid))
}

export function updateBuchung(id: number, input: ZeitbuchungInput): ZeitbuchungMitProjekt {
  const dauer = berechneDauerMinuten(input.startZeit, input.endeZeit, input.dauerMinuten)
  getDb()
    .prepare(
      `UPDATE zeitbuchungen
       SET projekt_id = ?, datum = ?, start_zeit = ?, ende_zeit = ?, dauer_minuten = ?, notiz = ?
       WHERE id = ?`
    )
    .run(
      input.projektId,
      input.datum,
      input.startZeit ?? null,
      input.endeZeit ?? null,
      dauer,
      input.notiz?.trim() ?? '',
      id
    )

  return getBuchungMitProjekt(id)
}

export function deleteBuchung(id: number): void {
  getDb().prepare('DELETE FROM zeitbuchungen WHERE id = ?').run(id)
}

function getOffeneAnwesenheitRow(): Record<string, unknown> | undefined {
  return getDb()
    .prepare('SELECT * FROM anwesenheit WHERE gehen_am IS NULL ORDER BY id DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined
}

function mapAnwesenheit(row: Record<string, unknown>, jetzt = new Date()): Anwesenheit {
  const kommenAm = row.kommen_am as string
  const gehenAm = (row.gehen_am as string) ?? null
  const pauseSeit = (row.pause_seit as string) ?? null
  const pausenMinuten = Number(row.pausen_minuten ?? 0)
  const kommenMs = new Date(kommenAm).getTime()
  const endeMs = gehenAm ? new Date(gehenAm).getTime() : jetzt.getTime()
  const bruttoSekunden = Math.max(0, Math.floor((endeMs - kommenMs) / 1000))

  let pausenSekunden = pausenMinuten * 60
  if (pauseSeit) {
    pausenSekunden += Math.max(0, Math.floor((jetzt.getTime() - new Date(pauseSeit).getTime()) / 1000))
  }

  const stempelSekunden = Math.max(0, bruttoSekunden - pausenSekunden)

  return {
    id: row.id as number,
    kommenAm,
    gehenAm,
    pauseSeit,
    pausenMinuten,
    imPause: Boolean(pauseSeit),
    stempelSekunden,
    bruttoSekunden,
    istOffen: gehenAm == null
  }
}

/**
 * Stempelzeiten (ohne Pause) je Kalendertag im Bereich, gruppiert nach Kommen-Datum (lokal).
 */
export function listAnwesenheitMinutenByRange(von: string, bis: string): AnwesenheitTagSumme[] {
  const padStart = (() => {
    const [y, m, d] = von.split('-').map(Number)
    const date = new Date(y, m - 1, d - 1)
    return formatDate(date)
  })()
  const padEnd = (() => {
    const [y, m, d] = bis.split('-').map(Number)
    const date = new Date(y, m - 1, d + 2)
    return formatDate(date)
  })()

  const rows = getDb()
    .prepare(
      `SELECT * FROM anwesenheit
       WHERE kommen_am >= ? AND kommen_am < ?
       ORDER BY kommen_am`
    )
    .all(`${padStart}T00:00:00.000Z`, `${padEnd}T00:00:00.000Z`) as Record<string, unknown>[]

  const jetzt = new Date()
  const map = new Map<string, number>()
  for (const row of rows) {
    const a = mapAnwesenheit(row, jetzt)
    const datum = formatDate(new Date(a.kommenAm))
    if (datum < von || datum > bis) continue
    map.set(datum, (map.get(datum) ?? 0) + Math.floor(a.stempelSekunden / 60))
  }

  return Array.from(map.entries()).map(([datum, stempelMinuten]) => ({
    datum,
    stempelMinuten
  }))
}

export function getAnwesenheit(jetzt = new Date()): Anwesenheit | null {
  const offen = getOffeneAnwesenheitRow()
  if (offen) return mapAnwesenheit(offen, jetzt)

  // Nach Gehen: letzte heutige Sitzung anzeigen (Kommen/Gehen-Uhrzeiten)
  const heute = formatDate(jetzt)
  const geschlossen = getDb()
    .prepare(
      `SELECT * FROM anwesenheit
       WHERE gehen_am IS NOT NULL
       ORDER BY id DESC
       LIMIT 5`
    )
    .all() as Array<Record<string, unknown>>
  const heutige = geschlossen.find((row) => formatDate(new Date(row.kommen_am as string)) === heute)
  if (!heutige) return null
  return mapAnwesenheit(heutige, jetzt)
}

function endPauseIfAny(row: Record<string, unknown>): void {
  const pauseSeit = row.pause_seit as string | null
  if (!pauseSeit) return
  const extra = Math.max(0, Math.round((Date.now() - new Date(pauseSeit).getTime()) / 60000))
  const pausenMinuten = Number(row.pausen_minuten ?? 0) + extra
  getDb()
    .prepare('UPDATE anwesenheit SET pause_seit = NULL, pausen_minuten = ? WHERE id = ?')
    .run(pausenMinuten, row.id)
}

function beginPauseIfNeeded(anwesenheitId: number): void {
  const row = getDb()
    .prepare('SELECT pause_seit FROM anwesenheit WHERE id = ?')
    .get(anwesenheitId) as { pause_seit: string | null } | undefined
  if (!row || row.pause_seit) return
  getDb()
    .prepare('UPDATE anwesenheit SET pause_seit = ? WHERE id = ?')
    .run(new Date().toISOString(), anwesenheitId)
}

/** Anwesend ohne Timer → Pause sicherstellen */
export function ensurePauseIfAnwesend(): void {
  const offen = getOffeneAnwesenheitRow()
  if (!offen) return
  if (getLaufenderTimer()) return
  beginPauseIfNeeded(offen.id as number)
}

function getLetzteGeschlosseneAnwesenheitHeute(jetzt = new Date()): Record<string, unknown> | undefined {
  const heute = formatDate(jetzt)
  const geschlossen = getDb()
    .prepare(
      `SELECT * FROM anwesenheit
       WHERE gehen_am IS NOT NULL
       ORDER BY id DESC
       LIMIT 10`
    )
    .all() as Array<Record<string, unknown>>
  return geschlossen.find((row) => formatDate(new Date(row.kommen_am as string)) === heute)
}

/**
 * Kommen: neue Tages-Sitzung oder – wenn heute schon gekommen/gegangen –
 * bestehende Sitzung fortsetzen (ursprüngliche Kommen-Zeit bleibt, Lücke = Pause).
 */
export function kommen(): Anwesenheit {
  const offen = getOffeneAnwesenheitRow()
  if (offen) {
    throw new Error(t('err.alreadyCheckedIn'))
  }

  const jetztDate = new Date()
  const jetzt = jetztDate.toISOString()
  const heutige = getLetzteGeschlosseneAnwesenheitHeute(jetztDate)

  if (heutige) {
    const gehenAm = heutige.gehen_am as string
    const gapMinuten = Math.max(
      0,
      Math.round((jetztDate.getTime() - new Date(gehenAm).getTime()) / 60000)
    )
    const pausenMinuten = Number(heutige.pausen_minuten ?? 0) + gapMinuten
    getDb()
      .prepare(
        `UPDATE anwesenheit
         SET gehen_am = NULL, pause_seit = ?, pausen_minuten = ?, last_seen_am = ?
         WHERE id = ?`
      )
      .run(jetzt, pausenMinuten, jetzt, heutige.id)

    const row = getDb()
      .prepare('SELECT * FROM anwesenheit WHERE id = ?')
      .get(heutige.id) as Record<string, unknown>
    return mapAnwesenheit(row, jetztDate)
  }

  const result = getDb()
    .prepare(
      `INSERT INTO anwesenheit (kommen_am, gehen_am, pause_seit, pausen_minuten, last_seen_am)
       VALUES (?, NULL, ?, 0, ?)`
    )
    .run(jetzt, jetzt, jetzt)
  const row = getDb()
    .prepare('SELECT * FROM anwesenheit WHERE id = ?')
    .get(result.lastInsertRowid) as Record<string, unknown>
  return mapAnwesenheit(row, jetztDate)
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

/** Letzte sinnvolle Gehen-Zeit für einen Kommen-Tag (Heartbeat, letzte Buchung, sonst 23:59). */
function inferGehenAmForKommenTag(kommenAm: string, lastSeenAm: string | null): Date {
  const kommenDate = new Date(kommenAm)
  const tag = formatDate(kommenDate)
  const dayEnd = endOfLocalDay(kommenDate)

  let best: Date | null = null

  if (lastSeenAm) {
    const seen = new Date(lastSeenAm)
    if (formatDate(seen) === tag && seen.getTime() >= kommenDate.getTime()) {
      best = seen
    }
  }

  const buchungen = getDb()
    .prepare(
      `SELECT start_zeit, ende_zeit, dauer_minuten FROM zeitbuchungen WHERE datum = ?`
    )
    .all(tag) as Array<{
    start_zeit: string | null
    ende_zeit: string | null
    dauer_minuten: number | null
  }>

  for (const b of buchungen) {
    let endLocal: Date | null = null
    if (b.ende_zeit && /^\d{2}:\d{2}/.test(b.ende_zeit)) {
      const [hh, mm, ss] = b.ende_zeit.split(':').map((x) => Number(x) || 0)
      endLocal = new Date(
        kommenDate.getFullYear(),
        kommenDate.getMonth(),
        kommenDate.getDate(),
        hh,
        mm,
        ss || 0
      )
    } else if (b.start_zeit && b.dauer_minuten != null) {
      const [hh, mm, ss] = b.start_zeit.split(':').map((x) => Number(x) || 0)
      const startLocal = new Date(
        kommenDate.getFullYear(),
        kommenDate.getMonth(),
        kommenDate.getDate(),
        hh,
        mm,
        ss || 0
      )
      endLocal = new Date(startLocal.getTime() + Number(b.dauer_minuten) * 60_000)
    }
    if (endLocal && (!best || endLocal.getTime() > best.getTime())) {
      best = endLocal
    }
  }

  if (!best || best.getTime() < kommenDate.getTime()) {
    return dayEnd
  }
  if (best.getTime() > dayEnd.getTime()) {
    return dayEnd
  }
  return best
}

/**
 * Schließt die offene Anwesenheit zum angegebenen Zeitpunkt (ISO/local Date).
 * Standard: jetzt (manuelles Gehen).
 */
export function gehen(at?: Date): Anwesenheit {
  const offen = getOffeneAnwesenheitRow()
  if (!offen) {
    throw new Error(t('err.noOpenCheckIn'))
  }

  // Timer stoppen, aber keine neue Pause öffnen – wir schließen die Sitzung
  stopTimerInternal({ enterPause: false })

  const aktuell = getOffeneAnwesenheitRow()
  if (!aktuell) {
    throw new Error(t('err.attendanceNotFound'))
  }

  const gehenDate = at ?? new Date()
  const gehenMs = gehenDate.getTime()
  const kommenMs = new Date(aktuell.kommen_am as string).getTime()
  const cappedGehen = new Date(Math.max(kommenMs, gehenMs))

  let pausenMinuten = Number(aktuell.pausen_minuten ?? 0)
  const pauseSeit = aktuell.pause_seit as string | null
  if (pauseSeit) {
    const pauseStart = new Date(pauseSeit).getTime()
    const extra = Math.max(0, Math.round((cappedGehen.getTime() - pauseStart) / 60000))
    pausenMinuten += extra
  }

  const gehenAm = cappedGehen.toISOString()
  getDb()
    .prepare(
      `UPDATE anwesenheit
       SET gehen_am = ?, pause_seit = NULL, pausen_minuten = ?, last_seen_am = COALESCE(last_seen_am, ?)
       WHERE id = ?`
    )
    .run(gehenAm, pausenMinuten, gehenAm, aktuell.id)

  const row = getDb()
    .prepare('SELECT * FROM anwesenheit WHERE id = ?')
    .get(aktuell.id) as Record<string, unknown>
  return mapAnwesenheit(row, cappedGehen)
}

/** Heartbeat: merkt letzte Lebenszeichen-Zeit der offenen Sitzung (für Crash/Shutdown). */
export function touchAnwesenheitLastSeen(jetzt = new Date()): void {
  const offen = getOffeneAnwesenheitRow()
  if (!offen) return
  getDb()
    .prepare('UPDATE anwesenheit SET last_seen_am = ? WHERE id = ? AND gehen_am IS NULL')
    .run(jetzt.toISOString(), offen.id)
}

/**
 * Offene Sitzung von einem früheren Kalendertag schließen (nicht mit „jetzt“!).
 * Verhindert 65h-Anwesenheit nach Wochenende ohne Shutdown-Gehen.
 */
export function closeStaleOpenAnwesenheit(jetzt = new Date()): Anwesenheit | null {
  const offen = getOffeneAnwesenheitRow()
  if (!offen) return null

  const kommenAm = offen.kommen_am as string
  const kommenTag = formatDate(new Date(kommenAm))
  const heute = formatDate(jetzt)
  if (kommenTag >= heute) return null

  const lastSeen = (offen.last_seen_am as string | null) ?? null
  const gehenAt = inferGehenAmForKommenTag(kommenAm, lastSeen)
  console.log(
    `[ProjectTimer] Stale Anwesenheit geschlossen: kommen=${kommenTag} gehen=${gehenAt.toISOString()}`
  )
  return gehen(gehenAt)
}

/**
 * Repariert bereits gespeicherte Sitzungen, die über Mitternacht hinaus geschlossen wurden
 * (typisch: Shutdown-Gehen fehlte, Gehen erst beim nächsten Start).
 */
export function repairCrossDayAnwesenheit(): number {
  const rows = getDb()
    .prepare(`SELECT * FROM anwesenheit WHERE gehen_am IS NOT NULL`)
    .all() as Array<Record<string, unknown>>

  let fixed = 0
  for (const row of rows) {
    const kommenAm = row.kommen_am as string
    const gehenAm = row.gehen_am as string
    const kommenTag = formatDate(new Date(kommenAm))
    const gehenTag = formatDate(new Date(gehenAm))
    if (gehenTag <= kommenTag) continue

    const lastSeen = (row.last_seen_am as string | null) ?? null
    const corrected = inferGehenAmForKommenTag(kommenAm, lastSeen)
    getDb()
      .prepare('UPDATE anwesenheit SET gehen_am = ? WHERE id = ?')
      .run(corrected.toISOString(), row.id)
    fixed += 1
    console.log(
      `[ProjectTimer] Anwesenheit #${row.id} korrigiert: ${gehenAm} → ${corrected.toISOString()}`
    )
  }
  return fixed
}

export type ShutdownGehenMarker = {
  anwesenheitId: number
  gehenAm: string
}

function upsertEinstellungWert(schluessel: string, wert: string): void {
  getDb()
    .prepare(
      `INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
       ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert`
    )
    .run(schluessel, wert)
}

export function setShutdownGehenMarker(marker: ShutdownGehenMarker): void {
  upsertEinstellungWert('shutdownGehenPending', '1')
  upsertEinstellungWert('shutdownGehenAnwesenheitId', String(marker.anwesenheitId))
  upsertEinstellungWert('shutdownGehenAt', marker.gehenAm)
}

export function clearShutdownGehenMarker(): void {
  upsertEinstellungWert('shutdownGehenPending', '0')
  upsertEinstellungWert('shutdownGehenAnwesenheitId', '')
  upsertEinstellungWert('shutdownGehenAt', '')
}

export function getShutdownGehenMarker(): ShutdownGehenMarker | null {
  const rows = getDb().prepare('SELECT schluessel, wert FROM einstellungen').all() as Array<{
    schluessel: string
    wert: string
  }>
  const map = Object.fromEntries(rows.map((r) => [r.schluessel, r.wert]))
  if (map.shutdownGehenPending !== '1') return null
  const id = Number(map.shutdownGehenAnwesenheitId)
  const gehenAm = map.shutdownGehenAt ?? ''
  if (!Number.isFinite(id) || id <= 0 || !gehenAm) return null
  return { anwesenheitId: id, gehenAm }
}

/**
 * Vorläufiges Shutdown-Gehen rückgängig machen (Restart am selben Tag).
 * Auszeit seit Gehen wird als Pause angerechnet.
 */
export function reopenAnwesenheitAfterRestart(
  anwesenheitId: number,
  gehenAm: string,
  jetzt = new Date()
): Anwesenheit | null {
  const row = getDb()
    .prepare('SELECT * FROM anwesenheit WHERE id = ?')
    .get(anwesenheitId) as Record<string, unknown> | undefined
  if (!row) return null
  if (row.gehen_am == null) {
    clearShutdownGehenMarker()
    return mapAnwesenheit(row, jetzt)
  }

  const gapMinutes = Math.max(
    0,
    Math.round((jetzt.getTime() - new Date(gehenAm).getTime()) / 60000)
  )
  const pausenMinuten = Number(row.pausen_minuten ?? 0) + gapMinutes
  const pauseSeit = jetzt.toISOString()

  getDb()
    .prepare(
      `UPDATE anwesenheit
       SET gehen_am = NULL, pausen_minuten = ?, pause_seit = ?, last_seen_am = ?
       WHERE id = ?`
    )
    .run(pausenMinuten, pauseSeit, pauseSeit, anwesenheitId)

  clearShutdownGehenMarker()

  const updated = getDb()
    .prepare('SELECT * FROM anwesenheit WHERE id = ?')
    .get(anwesenheitId) as Record<string, unknown>
  return mapAnwesenheit(updated, jetzt)
}

export function pauseToggle(): Anwesenheit {
  const offen = getOffeneAnwesenheitRow()
  if (!offen) {
    throw new Error(t('err.pauseNeedsCheckIn'))
  }

  const laufend = getLaufenderTimer()
  if (laufend) {
    // Auftrag stoppen → Zeit ohne Auftrag zählt als Pause
    stopTimerInternal({ enterPause: true })
  } else if (!(offen.pause_seit as string | null)) {
    beginPauseIfNeeded(offen.id as number)
  }
  // Bereits in Pause ohne Auftrag: Zustand belassen

  const row = getDb()
    .prepare('SELECT * FROM anwesenheit WHERE id = ?')
    .get(offen.id) as Record<string, unknown>
  return mapAnwesenheit(row)
}

function laufendeTimerMinuten(buchung: ZeitbuchungMitProjekt, jetzt = new Date()): number {
  if (!buchung.startZeit || buchung.endeZeit) return 0
  const [sh, sm] = buchung.startZeit.split(':').map(Number)
  let diff = jetzt.getHours() * 60 + jetzt.getMinutes() - (sh * 60 + sm)
  if (diff < 0) diff += 24 * 60
  return Math.max(0, diff)
}

function buildThemenFuerProjekt(
  projektId: number,
  datum: string,
  buchungen: ZeitbuchungMitProjekt[],
  laufend: ZeitbuchungMitProjekt | null
): TagesThema[] {
  const templates = getDb()
    .prepare(
      `SELECT kurztext FROM tages_themen WHERE datum = ? AND projekt_id = ? ORDER BY id`
    )
    .all(datum, projektId) as Array<{ kurztext: string }>

  const groups = new Map<string, ZeitbuchungMitProjekt[]>()
  for (const t of templates) {
    const key = t.kurztext.trim()
    if (!groups.has(key)) groups.set(key, [])
  }
  for (const b of buchungen) {
    if (b.projektId !== projektId) continue
    const key = (b.notiz ?? '').trim()
    const list = groups.get(key) ?? []
    list.push(b)
    groups.set(key, list)
  }

  const themen: TagesThema[] = []
  for (const [kurztext, items] of Array.from(groups.entries())) {
    const completed = items.filter(istBuchungAbgeschlossen)
    const abgeschlossen = completed.reduce(
      (sum: number, b: ZeitbuchungMitProjekt) => sum + (b.dauerMinuten ?? 0),
      0
    )
    let minuten = abgeschlossen
    const running =
      Boolean(laufend) &&
      laufend!.projektId === projektId &&
      (laufend!.notiz ?? '').trim() === kurztext &&
      !laufend!.endeZeit
    if (running && laufend) {
      minuten += laufendeTimerMinuten(laufend)
    }
    const sap = sapStatusFromBuchungen(completed)
    themen.push({
      projektId,
      kurztext,
      heuteMinuten: minuten,
      heuteAbgeschlossenMinuten: abgeschlossen,
      timerLaeuft: running,
      sapStatus: sap.status,
      sapUeberfuehrtAm: sap.zuletztUeberfuehrtAm
    })
  }

  return themen.sort((a, b) => {
    if (a.timerLaeuft !== b.timerLaeuft) return a.timerLaeuft ? -1 : 1
    return a.kurztext.localeCompare(b.kurztext, 'de')
  })
}

export function createTagesThema(projektId: number, kurztext: string): TagesThema {
  const text = kurztext.trim()
  if (!text) {
    throw new Error(t('err.topicRequired'))
  }
  const projekt = getProjekt(projektId)
  if (!projekt) {
    throw new Error(t('err.projectNotFound'))
  }
  const datum = formatDate(new Date())
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO tages_themen (datum, projekt_id, kurztext) VALUES (?, ?, ?)`
    )
    .run(datum, projektId, text)

  const laufend = getLaufenderTimer()
  const buchungen = listBuchungenByDatum(datum)
  const themen = buildThemenFuerProjekt(projektId, datum, buchungen, laufend)
  const found = themen.find((t) => t.kurztext === text)
  return (
    found ?? {
      projektId,
      kurztext: text,
      heuteMinuten: 0,
      heuteAbgeschlossenMinuten: 0,
      timerLaeuft: false,
      sapStatus: 'leer',
      sapUeberfuehrtAm: null
    }
  )
}

/**
 * Entfernt ein Tages-Topic. Getrackte Zeit bleibt am Auftrag und fällt auf „ohne Kurztext“ zurück.
 */
export function deleteTagesThema(projektId: number, kurztext: string): boolean {
  const datum = formatDate(new Date())
  const text = String(kurztext ?? '').trim()
  const pid = Number(projektId)
  if (!text) {
    throw new Error(t('err.topicRequired'))
  }
  if (!Number.isFinite(pid)) {
    throw new Error(t('err.projectNotFound'))
  }

  const laufend = getLaufenderTimer()
  if (
    laufend &&
    laufend.projektId === pid &&
    (laufend.notiz ?? '').trim() === text &&
    !laufend.endeZeit
  ) {
    throw new Error(t('err.topicRunning'))
  }

  const db = getDb()
  // Zeit bleibt am Projekt: Notiz leeren → Bucket „ohne Kurztext“
  const cleared = db
    .prepare(
      `UPDATE zeitbuchungen
       SET notiz = ''
       WHERE projekt_id = ?
         AND datum = ?
         AND TRIM(COALESCE(notiz, '')) = ?`
    )
    .run(pid, datum, text)

  const removed = db
    .prepare(
      `DELETE FROM tages_themen
       WHERE projekt_id = ?
         AND datum = ?
         AND TRIM(kurztext) = ?`
    )
    .run(pid, datum, text)

  if (cleared.changes <= 0 && removed.changes <= 0) {
    throw new Error(t('err.topicNotFound'))
  }

  return true
}

/**
 * Verteilt abgeschlossene Zeit ohne Kurztext eines Auftrags auf Topics.
 * Nicht zugewiesene Minuten bleiben ohne Kurztext. Laufende Timer bleiben unberührt.
 */
export function redistributeOhneKurztext(
  projektId: number,
  datum: string,
  allocations: TopicVerteilung[]
): number {
  const projekt = getProjekt(projektId)
  if (!projekt) {
    throw new Error(t('err.projectNotFound'))
  }

  const cleaned = (allocations ?? [])
    .map((a) => ({
      kurztext: (a.kurztext ?? '').trim(),
      minuten: Math.max(0, Math.floor(Number(a.minuten) || 0))
    }))
    .filter((a) => a.kurztext.length > 0 && a.minuten > 0)

  const want = cleaned.reduce((sum, a) => sum + a.minuten, 0)
  if (want <= 0) {
    return 0
  }

  const emptyCompleted = listBuchungenByDatum(datum)
    .filter(
      (b) =>
        b.projektId === projektId &&
        (b.notiz ?? '').trim() === '' &&
        istBuchungAbgeschlossen(b)
    )
    .sort((a, b) => a.id - b.id)

  const available = emptyCompleted.reduce((sum, b) => sum + (b.dauerMinuten ?? 0), 0)
  if (want > available) {
    throw new Error(t('err.redistributeTooMuch', { want, available }))
  }

  const insertStmt = getDb().prepare(
    `INSERT INTO zeitbuchungen
      (projekt_id, datum, start_zeit, ende_zeit, dauer_minuten, notiz, quelle)
     VALUES (?, ?, NULL, NULL, ?, ?, 'manuell')`
  )
  const themaStmt = getDb().prepare(
    `INSERT OR IGNORE INTO tages_themen (datum, projekt_id, kurztext) VALUES (?, ?, ?)`
  )
  const updateDauerStmt = getDb().prepare(
    `UPDATE zeitbuchungen
     SET dauer_minuten = ?, start_zeit = NULL, ende_zeit = NULL, quelle = 'manuell',
         sap_ueberfuehrt_am = NULL
     WHERE id = ?`
  )
  const deleteStmt = getDb().prepare(`DELETE FROM zeitbuchungen WHERE id = ?`)

  const tx = getDb().transaction(() => {
    // Pool aus leeren Buchungen von hinten aufbrauchen
    let remaining = want
    const pool = emptyCompleted.map((b) => ({
      id: b.id,
      minuten: b.dauerMinuten ?? 0
    }))

    for (let i = pool.length - 1; i >= 0 && remaining > 0; i -= 1) {
      const entry = pool[i]
      if (entry.minuten <= 0) continue
      const take = Math.min(entry.minuten, remaining)
      entry.minuten -= take
      remaining -= take
      if (entry.minuten <= 0) {
        deleteStmt.run(entry.id)
      } else {
        updateDauerStmt.run(entry.minuten, entry.id)
      }
    }

    let moved = 0
    for (const alloc of cleaned) {
      themaStmt.run(datum, projektId, alloc.kurztext)
      insertStmt.run(projektId, datum, alloc.minuten, alloc.kurztext)
      moved += alloc.minuten
    }
    return moved
  })

  return tx()
}

export function listProjekteMitZeiten(): ProjektMitZeit[] {
  const projekte = listProjekte(true)
  const laufend = getLaufenderTimer()
  const heute = formatDate(new Date())
  const summen = getDb()
    .prepare(
      `SELECT projekt_id AS id, COALESCE(SUM(dauer_minuten), 0) AS minuten
       FROM zeitbuchungen
       WHERE dauer_minuten IS NOT NULL
         AND (
           ende_zeit IS NOT NULL
           OR (quelle = 'manuell' AND dauer_minuten > 0)
         )
       GROUP BY projekt_id`
    )
    .all() as Array<{ id: number; minuten: number }>
  const summenHeute = getDb()
    .prepare(
      `SELECT projekt_id AS id, COALESCE(SUM(dauer_minuten), 0) AS minuten
       FROM zeitbuchungen
       WHERE datum = ?
         AND dauer_minuten IS NOT NULL
         AND (
           ende_zeit IS NOT NULL
           OR (quelle = 'manuell' AND dauer_minuten > 0)
         )
       GROUP BY projekt_id`
    )
    .all(heute) as Array<{ id: number; minuten: number }>
  const sumMap = new Map(summen.map((s) => [s.id, Number(s.minuten)]))
  const heuteMap = new Map(summenHeute.map((s) => [s.id, Number(s.minuten)]))
  const alleHeute = listBuchungenByDatum(heute)
  const heuteAbgeschlossen = alleHeute.filter(istBuchungAbgeschlossen)
  const sapByProjekt = new Map<number, Zeitbuchung[]>()
  for (const b of heuteAbgeschlossen) {
    const list = sapByProjekt.get(b.projektId) ?? []
    list.push(b)
    sapByProjekt.set(b.projektId, list)
  }

  return projekte.map((p) => {
    let gesamtMinuten = sumMap.get(p.id) ?? 0
    const heuteAbgeschlossenMinuten = heuteMap.get(p.id) ?? 0
    let heuteMinuten = heuteAbgeschlossenMinuten
    const timerLaeuft = laufend?.projektId === p.id
    if (timerLaeuft && laufend?.startZeit) {
      const diff = laufendeTimerMinuten(laufend)
      gesamtMinuten += diff
      if (laufend.datum === heute) {
        heuteMinuten += diff
      }
    }
    const sap = sapStatusFromBuchungen(sapByProjekt.get(p.id) ?? [])
    return {
      ...p,
      gesamtMinuten,
      heuteMinuten,
      heuteAbgeschlossenMinuten,
      heuteSapStatus: sap.status,
      heuteSapUeberfuehrtAm: sap.zuletztUeberfuehrtAm,
      themen: buildThemenFuerProjekt(p.id, heute, alleHeute, laufend),
      timerLaeuft,
      timerStartZeit: timerLaeuft ? laufend?.startZeit ?? null : null
    }
  })
}

export function startTimer(projektId: number, notiz = ''): ZeitbuchungMitProjekt {
  const anwesenheit = getOffeneAnwesenheitRow()
  if (!anwesenheit) {
    throw new Error(t('err.checkInFirst'))
  }

  const projekt = getProjekt(projektId)
  if (!projekt?.auftragsnummer || !projekt.arbeitsplatz) {
    throw new Error(t('err.orderNeedsFields'))
  }

  // Pause (Zeit ohne Auftrag) beenden, sobald wieder auf einen Auftrag gebucht wird
  endPauseIfAny(anwesenheit)

  const topic = notiz.trim()
  const laufend = getLaufenderTimer()
  if (laufend) {
    if (laufend.projektId === projektId && (laufend.notiz ?? '').trim() === topic) {
      return laufend
    }
    // Wechsel (auch gleiches Projekt, anderes Topic): ohne Pause dazwischen
    stopTimerInternal({ enterPause: false })
  }

  const now = new Date()
  const datum = formatDate(now)
  const startZeit = formatTime(now)

  if (topic) {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO tages_themen (datum, projekt_id, kurztext) VALUES (?, ?, ?)`
      )
      .run(datum, projektId, topic)
  }

  const result = getDb()
    .prepare(
      `INSERT INTO zeitbuchungen
        (projekt_id, datum, start_zeit, ende_zeit, dauer_minuten, notiz, quelle)
       VALUES (?, ?, ?, NULL, NULL, ?, 'timer')`
    )
    .run(projektId, datum, startZeit, topic)

  return getBuchungMitProjekt(Number(result.lastInsertRowid))
}

function stopTimerInternal(options: { enterPause: boolean }): ZeitbuchungMitProjekt | null {
  const laufend = getLaufenderTimer()
  if (!laufend) {
    if (options.enterPause) {
      const offen = getOffeneAnwesenheitRow()
      if (offen) beginPauseIfNeeded(offen.id as number)
    }
    return null
  }

  const now = new Date()
  let endeZeit = formatTime(now)
  let datum = laufend.datum
  const heute = formatDate(now)

  // Wenn der Timer über Mitternacht läuft, Ende auf 23:59 des Starttages setzen
  if (heute !== laufend.datum) {
    endeZeit = '23:59'
    datum = laufend.datum
  }

  const dauer = berechneDauerMinuten(laufend.startZeit, endeZeit, null)
  getDb()
    .prepare(
      `UPDATE zeitbuchungen
       SET ende_zeit = ?, dauer_minuten = ?, datum = ?
       WHERE id = ?`
    )
    .run(endeZeit, dauer, datum, laufend.id)

  if (options.enterPause) {
    const offen = getOffeneAnwesenheitRow()
    if (offen) beginPauseIfNeeded(offen.id as number)
  }

  return getBuchungMitProjekt(laufend.id)
}

export function stopTimer(): ZeitbuchungMitProjekt | null {
  return stopTimerInternal({ enterPause: true })
}

/** Timer stoppen ohne Pause zu öffnen (Lücke wird später verteilt). */
export function freezeTimerForAway(): number | null {
  const laufend = getLaufenderTimer()
  const projektId = laufend?.projektId ?? null
  stopTimerInternal({ enterPause: false })
  return projektId
}

function addMinutesToDate(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

/** Verteilt eine Away-Lücke auf Pause und/oder Aufträge. */
export function resolveIdleGap(
  vonIso: string,
  bisIso: string,
  dauerMinuten: number,
  input: Omit<IdleResolveInput, 'promptId'>
): void {
  const offen = getOffeneAnwesenheitRow()
  if (!offen) {
    throw new Error(t('err.gapNoCheckIn'))
  }

  const allocations = input.allocations.filter((a) => a.minuten > 0)
  const summe = allocations.reduce((acc, a) => acc + a.minuten, 0)
  if (summe !== dauerMinuten) {
    throw new Error(t('err.gapSum', { total: dauerMinuten, sum: summe }))
  }

  let cursor = new Date(vonIso)
  const ende = new Date(bisIso)
  if (!(cursor.getTime() < ende.getTime()) || dauerMinuten <= 0) {
    throw new Error(t('err.invalidGap'))
  }

  let pauseAnteil = 0

  const tx = getDb().transaction(() => {
    for (const alloc of allocations) {
      const sliceStart = cursor
      const sliceEnd = addMinutesToDate(cursor, alloc.minuten)
      cursor = sliceEnd

      if (alloc.projektId == null) {
        pauseAnteil += alloc.minuten
        continue
      }

      const projekt = getProjekt(alloc.projektId)
      if (!projekt?.auftragsnummer || !projekt.arbeitsplatz) {
        throw new Error(
          t('err.orderNeedsFieldsNamed', {
            name: String(projekt?.kuerzel ?? alloc.projektId)
          })
        )
      }

      createBuchung({
        projektId: alloc.projektId,
        datum: formatDate(sliceStart),
        startZeit: formatTime(sliceStart),
        endeZeit: formatTime(sliceEnd > ende ? ende : sliceEnd),
        dauerMinuten: alloc.minuten,
        notiz: '',
        quelle: 'manuell'
      })
    }

    // Offene Pause seit Unlock (Wartezeit auf Dialog) übernehmen, Lücke separat addieren
    const aktuell = getOffeneAnwesenheitRow()
    if (!aktuell) {
      throw new Error(t('err.attendanceNotFound'))
    }
    let pausenMinuten = Number(aktuell.pausen_minuten ?? 0)
    const pauseSeit = aktuell.pause_seit as string | null
    if (pauseSeit) {
      const extra = Math.max(
        0,
        Math.round((Date.now() - new Date(pauseSeit).getTime()) / 60_000)
      )
      pausenMinuten += extra
    }
    pausenMinuten += pauseAnteil
    getDb()
      .prepare('UPDATE anwesenheit SET pause_seit = NULL, pausen_minuten = ? WHERE id = ?')
      .run(pausenMinuten, aktuell.id)
  })
  tx()

  if (input.fortsetzenProjektId != null) {
    startTimer(input.fortsetzenProjektId, input.fortsetzenNotiz?.trim() ?? '')
  } else {
    beginPauseIfNeeded(offen.id as number)
  }
}

export function getEinstellungen(): Einstellungen {
  const rows = getDb().prepare('SELECT schluessel, wert FROM einstellungen').all() as Array<{
    schluessel: string
    wert: string
  }>
  const map = Object.fromEntries(rows.map((r) => [r.schluessel, r.wert]))

  let csvSpalten: string[]
  try {
    csvSpalten = JSON.parse(map.csvSpalten ?? '[]') as string[]
  } catch {
    csvSpalten = [...DEFAULT_CSV_SPALTEN]
  }

  if (!Array.isArray(csvSpalten) || csvSpalten.length === 0) {
    csvSpalten = [...DEFAULT_CSV_SPALTEN]
  } else {
    csvSpalten = csvSpalten.map((c) => (c === 'notiz' ? 'kurztext' : c))
    for (const col of ['auftragsnummer', 'arbeitsplatz', 'kurztext', 'sapUeberfuehrt'] as const) {
      if (!csvSpalten.includes(col)) {
        csvSpalten.push(col)
      }
    }
  }

  return {
    anzeigename: map.anzeigename ?? '',
    personalnummer: map.personalnummer ?? '',
    csvTrennzeichen: map.csvTrennzeichen ?? ';',
    csvSpalten,
    alwaysOnTopBar: map.alwaysOnTopBar === '1' || map.alwaysOnTopBar === 'true',
    floatBarMode: map.floatBarMode === 'slideout' ? 'slideout' : 'free',
    floatBarEdge:
      map.floatBarEdge === 'left' || map.floatBarEdge === 'right' || map.floatBarEdge === 'top'
        ? map.floatBarEdge
        : 'top',
    floatBarEdgeOffset: (() => {
      const raw = map.floatBarEdgeOffset
      if (raw === undefined || raw === null || String(raw).trim() === '') return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    })(),
    darkMode: map.darkMode === '1' || map.darkMode === 'true',
    idleDetectionEnabled:
      map.idleDetectionEnabled === undefined
        ? true
        : map.idleDetectionEnabled === '1' || map.idleDetectionEnabled === 'true',
    idleThresholdMinutes: Math.max(1, Number(map.idleThresholdMinutes ?? 5) || 5),
    autoKommenEnabled:
      map.autoKommenEnabled === undefined
        ? true
        : map.autoKommenEnabled === '1' || map.autoKommenEnabled === 'true',
    autoGehenOnShutdown:
      map.autoGehenOnShutdown === undefined
        ? true
        : map.autoGehenOnShutdown === '1' || map.autoGehenOnShutdown === 'true',
    autoStartEnabled:
      map.autoStartEnabled === undefined
        ? false
        : map.autoStartEnabled === '1' || map.autoStartEnabled === 'true',
    language:
      map.language === 'de' || map.language === 'en' || map.language === 'system'
        ? map.language
        : 'system',
    kurztextHeute: map.kurztextHeute ?? '',
    kurztextDatum: map.kurztextDatum ?? ''
  }
}

export function saveEinstellungen(settings: Einstellungen): Einstellungen {
  const database = getDb()
  const upsert = database.prepare(
    `INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
     ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert`
  )
  const tx = database.transaction(() => {
    upsert.run('anzeigename', settings.anzeigename.trim())
    upsert.run('personalnummer', settings.personalnummer.trim())
    upsert.run('csvTrennzeichen', settings.csvTrennzeichen || ';')
    upsert.run('csvSpalten', JSON.stringify(settings.csvSpalten))
    upsert.run('alwaysOnTopBar', settings.alwaysOnTopBar ? '1' : '0')
    upsert.run('floatBarMode', settings.floatBarMode === 'slideout' ? 'slideout' : 'free')
    upsert.run(
      'floatBarEdge',
      settings.floatBarEdge === 'left' || settings.floatBarEdge === 'right'
        ? settings.floatBarEdge
        : 'top'
    )
    upsert.run(
      'floatBarEdgeOffset',
      settings.floatBarEdgeOffset == null || !Number.isFinite(settings.floatBarEdgeOffset)
        ? ''
        : String(Math.round(settings.floatBarEdgeOffset))
    )
    upsert.run('darkMode', settings.darkMode ? '1' : '0')
    upsert.run('idleDetectionEnabled', settings.idleDetectionEnabled ? '1' : '0')
    upsert.run(
      'idleThresholdMinutes',
      String(Math.max(1, Math.round(settings.idleThresholdMinutes || 5)))
    )
    upsert.run('autoKommenEnabled', settings.autoKommenEnabled ? '1' : '0')
    upsert.run('autoGehenOnShutdown', settings.autoGehenOnShutdown ? '1' : '0')
    upsert.run('autoStartEnabled', settings.autoStartEnabled ? '1' : '0')
    upsert.run(
      'language',
      settings.language === 'de' || settings.language === 'en' ? settings.language : 'system'
    )
    upsert.run('kurztextHeute', settings.kurztextHeute?.trim() ?? '')
    upsert.run('kurztextDatum', settings.kurztextDatum?.trim() ?? '')
  })
  tx()
  return getEinstellungen()
}

export function setKurztextHeute(kurztext: string): Einstellungen {
  const settings = getEinstellungen()
  return saveEinstellungen({
    ...settings,
    kurztextHeute: kurztext.trim(),
    kurztextDatum: formatDate(new Date())
  })
}

export function getKurztextFuerHeute(): string {
  const settings = getEinstellungen()
  if (settings.kurztextDatum === formatDate(new Date())) {
    return settings.kurztextHeute.trim()
  }
  return ''
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export function formatDateDe(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}.${m}.${y}`
}

/** Dauer als hh:mm:ss für CSV (Excel-/SAP-freundlich, ohne Dezimal-Komma). */
export function minutenZuStundenCsv(minuten: number): string {
  const total = Math.max(0, Math.round(minuten))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}
