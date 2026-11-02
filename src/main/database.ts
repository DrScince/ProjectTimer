import Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_CSV_SPALTEN,
  type Anwesenheit,
  type Einstellungen,
  type EmpfaengerArt,
  type IdleResolveInput,
  type Projekt,
  type ProjektInput,
  type ProjektMitZeit,
  type SapTagesStatus,
  type SapTransferStatus,
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
      pausen_minuten INTEGER NOT NULL DEFAULT 0
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

    const buchungCols = database
      .prepare('PRAGMA table_info(zeitbuchungen)')
      .all() as Array<{ name: string }>
    const buchungNames = new Set(buchungCols.map((c) => c.name))
    if (!buchungNames.has('sap_ueberfuehrt_am')) {
      database.exec(`ALTER TABLE zeitbuchungen ADD COLUMN sap_ueberfuehrt_am TEXT`)
      console.log('[ProjectTimer] Migration: Spalte sap_ueberfuehrt_am hinzugefügt')
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
    ? 'SELECT * FROM projekte WHERE aktiv = 1 ORDER BY name COLLATE NOCASE'
    : 'SELECT * FROM projekte ORDER BY aktiv DESC, name COLLATE NOCASE'
  return getDb().prepare(sql).all().map((row) => mapProjekt(row as Record<string, unknown>))
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
        (name, kuerzel, auftragsnummer, arbeitsplatz, kurztext, empfaenger_art, empfaenger, leistungsart, aktiv)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      input.aktiv === false ? 0 : 1
    )
  return getProjekt(Number(result.lastInsertRowid))!
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
  const settings = getEinstellungen()
  if (!settings.personalnummer.trim()) {
    throw new Error(t('err.personalRequired'))
  }

  const dauer = berechneDauerMinuten(input.startZeit, input.endeZeit, input.dauerMinuten)
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
      input.notiz?.trim() ?? '',
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

/** Anwesend ohne Auftrag = Pause */
export function kommen(): Anwesenheit {
  const offen = getOffeneAnwesenheitRow()
  if (offen) {
    throw new Error(t('err.alreadyCheckedIn'))
  }
  const jetzt = new Date().toISOString()
  const result = getDb()
    .prepare(
      `INSERT INTO anwesenheit (kommen_am, gehen_am, pause_seit, pausen_minuten)
       VALUES (?, NULL, ?, 0)`
    )
    .run(jetzt, jetzt)
  const row = getDb()
    .prepare('SELECT * FROM anwesenheit WHERE id = ?')
    .get(result.lastInsertRowid) as Record<string, unknown>
  return mapAnwesenheit(row)
}

export function gehen(): Anwesenheit {
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

  let pausenMinuten = Number(aktuell.pausen_minuten ?? 0)
  const pauseSeit = aktuell.pause_seit as string | null
  if (pauseSeit) {
    const extra = Math.max(
      0,
      Math.round((Date.now() - new Date(pauseSeit).getTime()) / 60000)
    )
    pausenMinuten += extra
  }

  const gehenAm = new Date().toISOString()
  getDb()
    .prepare(
      `UPDATE anwesenheit
       SET gehen_am = ?, pause_seit = NULL, pausen_minuten = ?
       WHERE id = ?`
    )
    .run(gehenAm, pausenMinuten, aktuell.id)

  const row = getDb()
    .prepare('SELECT * FROM anwesenheit WHERE id = ?')
    .get(aktuell.id) as Record<string, unknown>
  return mapAnwesenheit(row)
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
       SET gehen_am = NULL, pausen_minuten = ?, pause_seit = ?
       WHERE id = ?`
    )
    .run(pausenMinuten, pauseSeit, anwesenheitId)

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
  const heuteBuchungen = listBuchungenByDatum(heute).filter(istBuchungAbgeschlossen)
  const sapByProjekt = new Map<number, Zeitbuchung[]>()
  for (const b of heuteBuchungen) {
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
      const [sh, sm] = laufend.startZeit.split(':').map(Number)
      const now = new Date()
      let diff = now.getHours() * 60 + now.getMinutes() - (sh * 60 + sm)
      if (diff < 0) diff += 24 * 60
      gesamtMinuten += diff
      // Laufender Timer zählt für „heute“, wenn er am heutigen Datum gestartet wurde
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

  const settings = getEinstellungen()
  if (!settings.personalnummer.trim()) {
    throw new Error(t('err.personalRequired'))
  }

  // Pause (Zeit ohne Auftrag) beenden, sobald wieder auf einen Auftrag gebucht wird
  endPauseIfAny(anwesenheit)

  const laufend = getLaufenderTimer()
  if (laufend) {
    if (laufend.projektId === projektId) {
      return laufend
    }
    // Wechsel: alten Timer stoppen, ohne dazwischen Pause zu öffnen
    stopTimerInternal({ enterPause: false })
  }

  const now = new Date()
  const datum = formatDate(now)
  const startZeit = formatTime(now)

  const result = getDb()
    .prepare(
      `INSERT INTO zeitbuchungen
        (projekt_id, datum, start_zeit, ende_zeit, dauer_minuten, notiz, quelle)
       VALUES (?, ?, ?, NULL, NULL, ?, 'timer')`
    )
    .run(projektId, datum, startZeit, notiz.trim())

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
        notiz: projekt.kurztext?.trim() ?? '',
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
    const projekt = getProjekt(input.fortsetzenProjektId)
    startTimer(input.fortsetzenProjektId, projekt?.kurztext?.trim() ?? '')
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
    for (const col of ['auftragsnummer', 'arbeitsplatz', 'kurztext'] as const) {
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

export function minutenZuStundenCsv(minuten: number): string {
  const hours = minuten / 60
  return hours.toFixed(2).replace('.', ',')
}
