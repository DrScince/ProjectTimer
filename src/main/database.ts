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
  type VerbuchungsVorschlag,
  type VerbuchungsVorschlagZeile,
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
      verbuchungs_prozent INTEGER NOT NULL DEFAULT 100,
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
    if (!names.has('verbuchungs_prozent')) {
      database.exec(`ALTER TABLE projekte ADD COLUMN verbuchungs_prozent INTEGER NOT NULL DEFAULT 100`)
      console.log('[ProjectTimer] Migration: Spalte verbuchungs_prozent hinzugefügt')
    }

    const buchungCols = database
      .prepare('PRAGMA table_info(zeitbuchungen)')
      .all() as Array<{ name: string }>
    const buchungNames = new Set(buchungCols.map((c) => c.name))
    if (!buchungNames.has('sap_ueberfuehrt_am')) {
      database.exec(`ALTER TABLE zeitbuchungen ADD COLUMN sap_ueberfuehrt_am TEXT`)
      console.log('[ProjectTimer] Migration: Spalte sap_ueberfuehrt_am hinzugefügt')
    }
    if (!buchungNames.has('geloescht_am')) {
      database.exec(`ALTER TABLE zeitbuchungen ADD COLUMN geloescht_am TEXT`)
      console.log('[ProjectTimer] Migration: Spalte geloescht_am hinzugefügt')
    }
    if (!buchungNames.has('sap_verbucht_minuten')) {
      database.exec(`ALTER TABLE zeitbuchungen ADD COLUMN sap_verbucht_minuten INTEGER NOT NULL DEFAULT 0`)
      // Bestehende voll markierte Buchungen als vollständig verbucht übernehmen
      database.exec(
        `UPDATE zeitbuchungen
         SET sap_verbucht_minuten = COALESCE(dauer_minuten, 0)
         WHERE sap_ueberfuehrt_am IS NOT NULL`
      )
      console.log('[ProjectTimer] Migration: Spalte sap_verbucht_minuten hinzugefügt')
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

function clampVerbuchungsProzent(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 100
  return Math.min(200, Math.max(1, n))
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
    verbuchungsProzent: clampVerbuchungsProzent(row.verbuchungs_prozent ?? 100),
    aktiv: Boolean(row.aktiv),
    sortOrder: Number(row.sort_order ?? 0),
    erstelltAm: row.erstellt_am as string
  }
}

function mapBuchung(row: Record<string, unknown>): Zeitbuchung {
  const dauer = Math.max(0, Number(row.dauer_minuten ?? 0) || 0)
  const rawVerbucht = Number(row.sap_verbucht_minuten ?? 0)
  let sapVerbuchtMinuten = Number.isFinite(rawVerbucht) ? Math.max(0, rawVerbucht) : 0
  // Legacy: nur sap_ueberfuehrt_am gesetzt → als voll verbucht behandeln
  if (sapVerbuchtMinuten <= 0 && row.sap_ueberfuehrt_am) {
    sapVerbuchtMinuten = dauer
  }
  if (dauer > 0) {
    sapVerbuchtMinuten = Math.min(sapVerbuchtMinuten, dauer)
  }
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
    sapUeberfuehrtAm: (row.sap_ueberfuehrt_am as string) ?? null,
    sapVerbuchtMinuten,
    geloeschtAm: (row.geloescht_am as string) ?? null
  }
}

function buchungDauerMinuten(b: Zeitbuchung): number {
  return Math.max(0, b.dauerMinuten ?? 0)
}

/** Noch nicht verbuchte Minuten einer Buchung. */
export function sapOffenMinuten(b: Zeitbuchung): number {
  return Math.max(0, buchungDauerMinuten(b) - (b.sapVerbuchtMinuten ?? 0))
}

export function istBuchungVollVerbucht(b: Zeitbuchung): boolean {
  const dauer = buchungDauerMinuten(b)
  if (dauer <= 0) return Boolean(b.sapUeberfuehrtAm)
  return (b.sapVerbuchtMinuten ?? 0) >= dauer
}

export function istBuchungTeilweiseVerbucht(b: Zeitbuchung): boolean {
  const v = b.sapVerbuchtMinuten ?? 0
  return v > 0 && !istBuchungVollVerbucht(b)
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
        (name, kuerzel, auftragsnummer, arbeitsplatz, kurztext, empfaenger_art, empfaenger, leistungsart,
         verbuchungs_prozent, aktiv, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      clampVerbuchungsProzent(input.verbuchungsProzent ?? 100),
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
           empfaenger_art = ?, empfaenger = ?, leistungsart = ?, verbuchungs_prozent = ?, aktiv = ?
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
      clampVerbuchungsProzent(input.verbuchungsProzent ?? 100),
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

export function istBuchungAktiv(buchung: Zeitbuchung): boolean {
  return !buchung.geloeschtAm
}

export function istBuchungAbgeschlossen(buchung: Zeitbuchung): boolean {
  if (!istBuchungAktiv(buchung)) return false
  if (buchung.endeZeit != null) return true
  if (buchung.quelle === 'manuell' && buchung.dauerMinuten != null && buchung.dauerMinuten > 0) {
    return true
  }
  return false
}

/** Für SAP-Status/Verbuchung: aktiv, abgeschlossen und mit Dauer > 0. */
export function istBuchungSapRelevant(buchung: Zeitbuchung): boolean {
  return istBuchungAbgeschlossen(buchung) && buchungDauerMinuten(buchung) > 0
}

export function markBuchungenSapUeberfuehrt(
  ids: number[],
  am: string = new Date().toISOString()
): number {
  if (ids.length === 0) return 0
  const database = getDb()
  const getDauer = database.prepare(
    `SELECT dauer_minuten, sap_verbucht_minuten FROM zeitbuchungen WHERE id = ?`
  )
  const stmt = database.prepare(
    `UPDATE zeitbuchungen
     SET sap_ueberfuehrt_am = ?, sap_verbucht_minuten = ?
     WHERE id = ?`
  )
  const tx = database.transaction(() => {
    let count = 0
    for (const id of ids) {
      const row = getDauer.get(id) as
        | { dauer_minuten: number | null; sap_verbucht_minuten: number | null }
        | undefined
      if (!row) continue
      const dauer = Math.max(0, Number(row.dauer_minuten ?? 0) || 0)
      const result = stmt.run(am, dauer, id)
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
    `UPDATE zeitbuchungen SET sap_ueberfuehrt_am = NULL, sap_verbucht_minuten = 0 WHERE id = ?`
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
  const voll = buchungen.filter((b) => istBuchungVollVerbucht(b))
  const teilweise = buchungen.filter((b) => istBuchungTeilweiseVerbucht(b))
  const times = buchungen
    .map((b) => b.sapUeberfuehrtAm)
    .filter((x): x is string => Boolean(x))
    .sort()
  const zuletzt = times[times.length - 1] ?? null
  if (voll.length === 0 && teilweise.length === 0) {
    return { status: 'offen', zuletztUeberfuehrtAm: null }
  }
  if (voll.length === buchungen.length) {
    return { status: 'ueberfuehrt', zuletztUeberfuehrtAm: zuletzt }
  }
  return { status: 'gemischt', zuletztUeberfuehrtAm: zuletzt }
}

export function getSapTagesStatus(datum: string): SapTagesStatus {
  const buchungen = listBuchungenByDatum(datum).filter(istBuchungSapRelevant)
  const offen = buchungen.filter((b) => sapOffenMinuten(b) > 0).length
  const ueberfuehrt = buchungen.filter((b) => istBuchungVollVerbucht(b)).length
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
    .filter((b) => istBuchungAbgeschlossen(b) && sapOffenMinuten(b) > 0)
    .map((b) => b.id)
  return markBuchungenSapUeberfuehrt(ids)
}

/** Verteilt Soll-Minuten chronologisch auf Buchungen; Teilbuchungen erlaubt. */
function selectTeilverbuchungBisSoll(
  buchungen: ZeitbuchungMitProjekt[],
  sollMinuten: number
): { allocations: Array<{ buchungId: number; minuten: number }>; markierbarMinuten: number } {
  const sorted = [...buchungen].sort((a, b) => {
    const as = a.startZeit ?? '99:99'
    const bs = b.startZeit ?? '99:99'
    if (as !== bs) return as.localeCompare(bs)
    return a.id - b.id
  })
  const allocations: Array<{ buchungId: number; minuten: number }> = []
  let rest = Math.max(0, Math.round(sollMinuten))
  for (const b of sorted) {
    if (rest <= 0) break
    const offen = sapOffenMinuten(b)
    if (offen <= 0) continue
    const take = Math.min(offen, rest)
    if (take <= 0) continue
    allocations.push({ buchungId: b.id, minuten: take })
    rest -= take
  }
  const markierbarMinuten = allocations.reduce((sum, a) => sum + a.minuten, 0)
  return { allocations, markierbarMinuten }
}

function listUnverbuchteBuchungenFuerProjekt(
  projektId: number,
  datum: string | null
): ZeitbuchungMitProjekt[] {
  const rows =
    datum && datum.trim()
      ? listBuchungenByDatum(datum.trim()).filter((b) => b.projektId === projektId)
      : (getDb()
          .prepare(
            `${BUCHUNG_SELECT}
             WHERE z.projekt_id = ?
               AND z.geloescht_am IS NULL
               AND (
                 z.ende_zeit IS NOT NULL
                 OR (z.quelle = 'manuell' AND z.dauer_minuten IS NOT NULL AND z.dauer_minuten > 0)
               )
             ORDER BY z.datum, COALESCE(z.start_zeit, '99:99'), z.id`
          )
          .all(projektId) as Record<string, unknown>[]).map(mapBuchungMitProjekt)

  return rows.filter((b) => istBuchungAbgeschlossen(b) && sapOffenMinuten(b) > 0)
}

/**
 * Vorschlag: unverbuchte Zeit × Verbuchungs-% je Tag+Kurztext.
 * Teilbuchungen: Eintragen = Wird markiert.
 */
export function getVerbuchungsVorschlag(
  projektId: number,
  datum: string | null = null
): VerbuchungsVorschlag {
  const projekt = getProjekt(projektId)
  if (!projekt) {
    throw new Error(t('err.projectNotFound'))
  }
  const prozent = clampVerbuchungsProzent(projekt.verbuchungsProzent)
  const scope = datum && String(datum).trim() ? String(datum).trim() : null
  const offen = listUnverbuchteBuchungenFuerProjekt(projektId, scope)

  const byDayTopic = new Map<string, ZeitbuchungMitProjekt[]>()
  for (const b of offen) {
    const key = `${b.datum}::${(b.notiz ?? '').trim()}`
    const list = byDayTopic.get(key) ?? []
    list.push(b)
    byDayTopic.set(key, list)
  }

  const zeilen: VerbuchungsVorschlagZeile[] = Array.from(byDayTopic.entries())
    .map(([key, items]) => {
      const sep = key.indexOf('::')
      const tag = key.slice(0, sep)
      const kurztext = key.slice(sep + 2)
      const unverbuchtMinuten = items.reduce((sum, b) => sum + sapOffenMinuten(b), 0)
      const sollMinuten = Math.round((unverbuchtMinuten * prozent) / 100)
      const { allocations, markierbarMinuten } = selectTeilverbuchungBisSoll(items, sollMinuten)
      return {
        datum: tag,
        kurztext,
        unverbuchtMinuten,
        sollMinuten,
        markierbarMinuten,
        allocations
      }
    })
    .filter((z) => z.unverbuchtMinuten > 0)
    .sort((a, b) => {
      if (a.datum !== b.datum) return a.datum.localeCompare(b.datum)
      return a.kurztext.localeCompare(b.kurztext, 'de')
    })

  return { projektId, datum: scope, prozent, zeilen }
}

/** Wendet Teilverbuchungen an: sap_verbucht_minuten erhöhen, bei voller Dauer sap_ueberfuehrt_am setzen. */
export function applyVerbuchung(projektId: number, datum: string | null = null): number {
  const vorschlag = getVerbuchungsVorschlag(projektId, datum)
  const allocations = vorschlag.zeilen.flatMap((z) => z.allocations)
  if (allocations.length === 0) {
    throw new Error(t('err.verbuchungEmpty'))
  }

  const database = getDb()
  const getRow = database.prepare(
    `SELECT dauer_minuten, sap_verbucht_minuten, sap_ueberfuehrt_am FROM zeitbuchungen WHERE id = ?`
  )
  const upd = database.prepare(
    `UPDATE zeitbuchungen
     SET sap_verbucht_minuten = ?, sap_ueberfuehrt_am = ?
     WHERE id = ?`
  )
  const am = new Date().toISOString()

  const tx = database.transaction(() => {
    let count = 0
    for (const alloc of allocations) {
      const row = getRow.get(alloc.buchungId) as
        | {
            dauer_minuten: number | null
            sap_verbucht_minuten: number | null
            sap_ueberfuehrt_am: string | null
          }
        | undefined
      if (!row) continue
      const dauer = Math.max(0, Number(row.dauer_minuten ?? 0) || 0)
      const bisher = Math.max(0, Number(row.sap_verbucht_minuten ?? 0) || 0)
      const neu = Math.min(dauer, bisher + Math.max(0, alloc.minuten))
      if (neu === bisher) continue
      const stamp = neu >= dauer ? am : row.sap_ueberfuehrt_am ?? am
      upd.run(neu, stamp, alloc.buchungId)
      count += 1
    }
    return count
  })
  return tx()
}

export function clearSapByDatum(datum: string): number {
  const ids = listBuchungenByDatum(datum)
    .filter((b) => istBuchungAbgeschlossen(b) && (b.sapVerbuchtMinuten ?? 0) > 0)
    .map((b) => b.id)
  return clearBuchungenSapUeberfuehrt(ids)
}

export function markSapByDatumProjekt(datum: string, projektId: number): number {
  const ids = listBuchungenByDatum(datum)
    .filter(
      (b) =>
        b.projektId === projektId && istBuchungAbgeschlossen(b) && sapOffenMinuten(b) > 0
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
        (b.sapVerbuchtMinuten ?? 0) > 0
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
        sapOffenMinuten(b) > 0
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
        (b.sapVerbuchtMinuten ?? 0) > 0
    )
    .map((b) => b.id)
  return clearBuchungenSapUeberfuehrt(ids)
}

export function getLaufenderTimer(): ZeitbuchungMitProjekt | null {
  const row = getDb()
    .prepare(
      `${BUCHUNG_SELECT}
       WHERE z.ende_zeit IS NULL AND z.quelle = 'timer' AND z.geloescht_am IS NULL
       ORDER BY z.id DESC LIMIT 1`
    )
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
  const dauerMin = Math.max(0, dauer ?? 0)
  const database = getDb()
  const prev = database
    .prepare(`SELECT sap_verbucht_minuten, sap_ueberfuehrt_am FROM zeitbuchungen WHERE id = ?`)
    .get(id) as
    | { sap_verbucht_minuten: number | null; sap_ueberfuehrt_am: string | null }
    | undefined
  let sapVerbucht = Math.max(0, Number(prev?.sap_verbucht_minuten ?? 0) || 0)
  if (sapVerbucht <= 0 && prev?.sap_ueberfuehrt_am) {
    sapVerbucht = dauerMin
  }
  sapVerbucht = Math.min(sapVerbucht, dauerMin)
  const sapStamp =
    sapVerbucht <= 0
      ? null
      : sapVerbucht >= dauerMin
        ? (prev?.sap_ueberfuehrt_am ?? new Date().toISOString())
        : prev?.sap_ueberfuehrt_am
  database
    .prepare(
      `UPDATE zeitbuchungen
       SET projekt_id = ?, datum = ?, start_zeit = ?, ende_zeit = ?, dauer_minuten = ?, notiz = ?,
           sap_verbucht_minuten = ?, sap_ueberfuehrt_am = ?
       WHERE id = ?`
    )
    .run(
      input.projektId,
      input.datum,
      input.startZeit ?? null,
      input.endeZeit ?? null,
      dauer,
      input.notiz?.trim() ?? '',
      sapVerbucht,
      sapStamp,
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

/** Summe aktiver (nicht soft-gelöschter) abgeschlossener Buchungsminuten eines Tags. */
export function sumAktiveBuchungsMinuten(datum: string): number {
  return listBuchungenByDatum(datum)
    .filter(istBuchungAbgeschlossen)
    .reduce((sum, b) => sum + Math.max(0, b.dauerMinuten ?? 0), 0)
}

/**
 * Pause = Brutto (Kommen→Gehen/jetzt) − gebuchte Zeit (− laufender Timer).
 * Darf negativ sein. Gespeicherte pausen_minuten werden nicht mehr blind übernommen.
 */
function mapAnwesenheit(row: Record<string, unknown>, jetzt = new Date()): Anwesenheit {
  const kommenAm = row.kommen_am as string
  const gehenAm = (row.gehen_am as string) ?? null
  const pauseSeit = (row.pause_seit as string) ?? null
  const kommenMs = new Date(kommenAm).getTime()
  const endeMs = gehenAm ? new Date(gehenAm).getTime() : jetzt.getTime()
  const bruttoSekunden = Math.max(0, Math.floor((endeMs - kommenMs) / 1000))
  const bruttoMinuten = Math.floor(bruttoSekunden / 60)

  const datum = formatDate(new Date(kommenAm))
  let gebuchtMinuten = sumAktiveBuchungsMinuten(datum)
  if (!gehenAm) {
    const laufend = getLaufenderTimer()
    if (laufend && laufend.datum === datum && !laufend.endeZeit) {
      gebuchtMinuten += laufendeTimerMinuten(laufend, jetzt)
    }
  }

  const pausenMinuten = bruttoMinuten - gebuchtMinuten
  const pausenSekunden = pausenMinuten * 60
  const stempelSekunden = bruttoSekunden - pausenSekunden

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

/** Schreibt die abgeleitete Pause zurück, damit DB und Anzeige übereinstimmen. */
function persistDerivedPause(row: Record<string, unknown>, mapped: Anwesenheit): void {
  if (Number(row.pausen_minuten ?? 0) === mapped.pausenMinuten) return
  getDb()
    .prepare('UPDATE anwesenheit SET pausen_minuten = ? WHERE id = ?')
    .run(mapped.pausenMinuten, mapped.id)
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
    persistDerivedPause(row, a)
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
  if (offen) {
    const mapped = mapAnwesenheit(offen, jetzt)
    persistDerivedPause(offen, mapped)
    return mapped
  }

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
  const mapped = mapAnwesenheit(heutige, jetzt)
  persistDerivedPause(heutige, mapped)
  return mapped
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
      `SELECT start_zeit, ende_zeit, dauer_minuten FROM zeitbuchungen
       WHERE datum = ? AND geloescht_am IS NULL`
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
function parseZeitToHms(zeit: string): { h: number; m: number; s: number } {
  const parts = zeit.trim().split(':').map((x) => Number(x))
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(t('err.invalidTime'))
  }
  return { h: parts[0], m: parts[1], s: parts[2] ?? 0 }
}

function localDateTimeToIso(datum: string, zeit: string): string {
  const [y, m, d] = datum.split('-').map(Number)
  if (!y || !m || !d) throw new Error(t('err.invalidDate'))
  const { h, m: min, s } = parseZeitToHms(zeit)
  return new Date(y, m - 1, d, h, min, s).toISOString()
}

/** Anwesenheitssitzung eines Kalendertags (nach lokalem Kommen-Datum). */
export function getAnwesenheitByDatum(datum: string, jetzt = new Date()): Anwesenheit | null {
  const rows = getDb()
    .prepare(`SELECT * FROM anwesenheit ORDER BY id DESC`)
    .all() as Array<Record<string, unknown>>
  const matches = rows.filter((row) => formatDate(new Date(row.kommen_am as string)) === datum)
  if (matches.length === 0) return null
  const offen = matches.find((row) => row.gehen_am == null)
  const row = offen ?? matches[0]
  const mapped = mapAnwesenheit(row, jetzt)
  persistDerivedPause(row, mapped)
  return mapped
}

/**
 * Anwesenheit eines Tags anlegen oder Zeiten korrigieren.
 * Gehen leer + Datum = heute → Sitzung bleibt/wird offen.
 * Pause wird immer als Brutto (Kommen→Gehen/jetzt) − gebuchte Zeit gesetzt und darf negativ sein.
 */
export function upsertAnwesenheitForDatum(
  datum: string,
  input: { kommenZeit: string; gehenZeit: string | null; pausenMinuten?: number },
  jetzt = new Date()
): Anwesenheit {
  const kommenZeit = input.kommenZeit?.trim()
  if (!kommenZeit) throw new Error(t('err.kommenRequired'))

  const gehenZeit = input.gehenZeit?.trim() ? input.gehenZeit.trim() : null
  const heute = formatDate(jetzt)

  if (!gehenZeit && datum !== heute) {
    throw new Error(t('err.gehenRequiredPast'))
  }

  const kommenIso = localDateTimeToIso(datum, kommenZeit)
  let gehenIso: string | null = null
  if (gehenZeit) {
    gehenIso = localDateTimeToIso(datum, gehenZeit)
    if (new Date(gehenIso).getTime() < new Date(kommenIso).getTime()) {
      throw new Error(t('err.gehenBeforeKommen'))
    }
  }

  const endeMs = gehenIso ? new Date(gehenIso).getTime() : jetzt.getTime()
  const bruttoMinuten = Math.max(
    0,
    Math.round((endeMs - new Date(kommenIso).getTime()) / 60_000)
  )
  const gebuchtMinuten = sumAktiveBuchungsMinuten(datum)
  const pausenMinuten = bruttoMinuten - gebuchtMinuten

  const existing = getAnwesenheitByDatum(datum, jetzt)
  if (existing) {
    getDb()
      .prepare(
        `UPDATE anwesenheit
         SET kommen_am = ?, gehen_am = ?, pause_seit = NULL, pausen_minuten = ?, last_seen_am = ?
         WHERE id = ?`
      )
      .run(kommenIso, gehenIso, pausenMinuten, gehenIso ?? jetzt.toISOString(), existing.id)

    const row = getDb()
      .prepare('SELECT * FROM anwesenheit WHERE id = ?')
      .get(existing.id) as Record<string, unknown>
    return mapAnwesenheit(row, jetzt)
  }

  // Keine zweite offene Sitzung erlauben, wenn wir heute offen anlegen
  if (!gehenIso) {
    const offen = getOffeneAnwesenheitRow()
    if (offen) {
      throw new Error(t('err.alreadyCheckedIn'))
    }
  }

  const result = getDb()
    .prepare(
      `INSERT INTO anwesenheit (kommen_am, gehen_am, pause_seit, pausen_minuten, last_seen_am)
       VALUES (?, ?, NULL, ?, ?)`
    )
    .run(kommenIso, gehenIso, pausenMinuten, gehenIso ?? jetzt.toISOString())

  const row = getDb()
    .prepare('SELECT * FROM anwesenheit WHERE id = ?')
    .get(result.lastInsertRowid) as Record<string, unknown>
  return mapAnwesenheit(row, jetzt)
}

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
    const sapRelevant = completed.filter(istBuchungSapRelevant)
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
    const sap = sapStatusFromBuchungen(sapRelevant)
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
  const softDeleteStmt = getDb().prepare(
    `UPDATE zeitbuchungen SET geloescht_am = ? WHERE id = ? AND geloescht_am IS NULL`
  )
  const jetztIso = new Date().toISOString()

  const tx = getDb().transaction(() => {
    // Pool aus leeren Buchungen von hinten aufbrauchen; Originale soft-löschen
    let remaining = want
    const pool = emptyCompleted.map((b) => ({
      id: b.id,
      minuten: b.dauerMinuten ?? 0,
      notiz: b.notiz ?? ''
    }))

    for (let i = pool.length - 1; i >= 0 && remaining > 0; i -= 1) {
      const entry = pool[i]
      if (entry.minuten <= 0) continue
      const take = Math.min(entry.minuten, remaining)
      entry.minuten -= take
      remaining -= take
      softDeleteStmt.run(jetztIso, entry.id)
      if (entry.minuten > 0) {
        insertStmt.run(projektId, datum, entry.minuten, entry.notiz)
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
       WHERE geloescht_am IS NULL
         AND dauer_minuten IS NOT NULL
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
         AND geloescht_am IS NULL
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
    if (!istBuchungSapRelevant(b)) continue
    const list = sapByProjekt.get(b.projektId) ?? []
    list.push(b)
    sapByProjekt.set(b.projektId, list)
  }

  // Verbucht / Unverbucht (Teilverbuchung berücksichtigt), alle Tage
  const unverbuchtMap = new Map<number, number>()
  const verbuchtMap = new Map<number, number>()
  const alleOffen = getDb()
    .prepare(
      `${BUCHUNG_SELECT}
       WHERE z.geloescht_am IS NULL
         AND (
           z.ende_zeit IS NOT NULL
           OR (z.quelle = 'manuell' AND z.dauer_minuten IS NOT NULL AND z.dauer_minuten > 0)
         )`
    )
    .all() as Record<string, unknown>[]
  for (const row of alleOffen) {
    const b = mapBuchungMitProjekt(row)
    if (!istBuchungAbgeschlossen(b)) continue
    const verbucht = Math.max(0, b.sapVerbuchtMinuten ?? 0)
    if (verbucht > 0) {
      verbuchtMap.set(b.projektId, (verbuchtMap.get(b.projektId) ?? 0) + verbucht)
    }
    const offen = sapOffenMinuten(b)
    if (offen > 0) {
      unverbuchtMap.set(b.projektId, (unverbuchtMap.get(b.projektId) ?? 0) + offen)
    }
  }

  return projekte.map((p) => {
    let gesamtMinuten = sumMap.get(p.id) ?? 0
    const heuteAbgeschlossenMinuten = heuteMap.get(p.id) ?? 0
    const verbuchtMinuten = verbuchtMap.get(p.id) ?? 0
    const unverbuchtMinuten = unverbuchtMap.get(p.id) ?? 0
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
      verbuchtMinuten,
      unverbuchtMinuten,
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

/** Verfügbare Pausenminuten einer Anwesenheitssitzung (inkl. laufender Pause). */
function pausenMinutenVerfuegbar(
  row: Record<string, unknown>,
  jetzt = new Date()
): number {
  let pausenMinuten = Number(row.pausen_minuten ?? 0)
  const pauseSeit = (row.pause_seit as string | null) ?? null
  if (pauseSeit) {
    pausenMinuten += Math.max(
      0,
      Math.round((jetzt.getTime() - new Date(pauseSeit).getTime()) / 60_000)
    )
  }
  return Math.max(0, pausenMinuten)
}

/**
 * Nachträgliche Korrektur einer Buchung im Kalender:
 * Original wird soft-gelöscht (bleibt sichtbar, zählt nicht),
 * Rest/Zuwachs als Dauer-Buchung ohne Uhrzeit; Pause wird angepasst.
 */
export function adjustBuchungNachtraeglich(
  id: number,
  input: {
    projektId: number
    notiz?: string
    behaltenMinuten: number
    ausPauseMinuten?: number
  },
  jetzt = new Date()
): ZeitbuchungMitProjekt | null {
  const original = getBuchungMitProjekt(id)
  if (original.geloeschtAm) {
    throw new Error(t('err.bookingAlreadyDeleted'))
  }
  if (!istBuchungAbgeschlossen(original)) {
    throw new Error(t('err.bookingStillRunning'))
  }

  const originalMinuten = Math.max(0, Math.round(original.dauerMinuten ?? 0))
  if (originalMinuten <= 0) {
    throw new Error(t('err.bookingNoDuration'))
  }

  const behalten = Math.max(0, Math.round(Number(input.behaltenMinuten) || 0))
  const ausPause = Math.max(0, Math.round(Number(input.ausPauseMinuten) || 0))
  if (behalten > originalMinuten) {
    throw new Error(
      t('err.adjustKeepTooMuch', { want: behalten, available: originalMinuten })
    )
  }

  const zuPause = originalMinuten - behalten
  const neueDauer = behalten + ausPause
  const notiz = input.notiz?.trim() ?? ''
  const projektId = Number(input.projektId)
  if (!Number.isFinite(projektId)) {
    throw new Error(t('err.projectNotFound'))
  }

  const projekt = getProjekt(projektId)
  if (!projekt?.auftragsnummer || !projekt.arbeitsplatz) {
    throw new Error(t('err.orderNeedsFields'))
  }

  const anw = getAnwesenheitByDatum(original.datum, jetzt)
  if ((zuPause > 0 || ausPause > 0) && !anw) {
    throw new Error(t('err.attendanceNotFound'))
  }

  let anwRow: Record<string, unknown> | null = null
  if (anw) {
    anwRow = getDb()
      .prepare('SELECT * FROM anwesenheit WHERE id = ?')
      .get(anw.id) as Record<string, unknown>
  }

  if (ausPause > 0 && anwRow) {
    const verfuegbar = pausenMinutenVerfuegbar(anwRow, jetzt)
    if (ausPause > verfuegbar) {
      throw new Error(
        t('err.pauseAllocateTooMuch', { want: ausPause, available: verfuegbar })
      )
    }
  }

  const jetztIso = jetzt.toISOString()
  const tx = getDb().transaction(() => {
    getDb()
      .prepare(
        `UPDATE zeitbuchungen SET geloescht_am = ? WHERE id = ? AND geloescht_am IS NULL`
      )
      .run(jetztIso, id)

    let created: ZeitbuchungMitProjekt | null = null
    if (neueDauer > 0) {
      created = createBuchung({
        projektId,
        datum: original.datum,
        startZeit: null,
        endeZeit: null,
        dauerMinuten: neueDauer,
        notiz,
        quelle: 'manuell'
      })
    } else if (notiz) {
      getDb()
        .prepare(
          `INSERT OR IGNORE INTO tages_themen (datum, projekt_id, kurztext) VALUES (?, ?, ?)`
        )
        .run(original.datum, projektId, notiz)
    }

    if (anwRow && (zuPause !== 0 || ausPause !== 0)) {
      const pauseSeit = (anwRow.pause_seit as string | null) ?? null
      const wasInLivePause = Boolean(pauseSeit) && anwRow.gehen_am == null
      let pausenMinuten = pausenMinutenVerfuegbar(anwRow, jetzt)
      // Negativ erlaubt (Anwesenheit < Gebucht)
      pausenMinuten = pausenMinuten + zuPause - ausPause
      getDb()
        .prepare(
          `UPDATE anwesenheit
           SET pausen_minuten = ?, pause_seit = ?
           WHERE id = ?`
        )
        .run(pausenMinuten, wasInLivePause ? jetztIso : null, anwRow.id)
    }

    return created
  })

  return tx()
}

/**
 * Bucht angesammelte Pausenzeit nachträglich auf Aufträge um.
 * Verringert pausen_minuten entsprechend; Rest bleibt Pause.
 */
export function allocatePauseToProjekte(
  datum: string,
  allocations: Array<{ projektId: number; minuten: number; notiz?: string }>,
  jetzt = new Date()
): number {
  const anw = getAnwesenheitByDatum(datum, jetzt)
  if (!anw) {
    throw new Error(t('err.attendanceNotFound'))
  }

  const want = allocations
    .map((a) => ({
      projektId: a.projektId,
      minuten: Math.max(0, Math.round(Number(a.minuten) || 0)),
      notiz: a.notiz?.trim() ?? ''
    }))
    .filter((a) => a.minuten > 0)

  const summe = want.reduce((acc, a) => acc + a.minuten, 0)
  if (summe <= 0) {
    throw new Error(t('err.pauseAllocateEmpty'))
  }

  const row = getDb()
    .prepare('SELECT * FROM anwesenheit WHERE id = ?')
    .get(anw.id) as Record<string, unknown>

  let pausenMinuten = Number(row.pausen_minuten ?? 0)
  const pauseSeit = (row.pause_seit as string | null) ?? null
  const wasInLivePause = Boolean(pauseSeit) && row.gehen_am == null
  if (pauseSeit) {
    const extra = Math.max(
      0,
      Math.round((jetzt.getTime() - new Date(pauseSeit).getTime()) / 60_000)
    )
    pausenMinuten += extra
  }

  if (summe > pausenMinuten) {
    throw new Error(
      t('err.pauseAllocateTooMuch', { want: summe, available: pausenMinuten })
    )
  }

  const tx = getDb().transaction(() => {
    for (const alloc of want) {
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
        datum,
        startZeit: null,
        endeZeit: null,
        dauerMinuten: alloc.minuten,
        notiz: alloc.notiz,
        quelle: 'manuell'
      })
    }

    const rest = pausenMinuten - summe
    getDb()
      .prepare(
        `UPDATE anwesenheit
         SET pausen_minuten = ?, pause_seit = ?
         WHERE id = ?`
      )
      .run(rest, wasInLivePause ? jetzt.toISOString() : null, anw.id)
  })
  tx()

  return summe
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
    // Verbucht/Unverbucht nach „stunden“ einfügen (bestehende Einstellungen)
    const insertAfterStunden = (col: string): void => {
      if (csvSpalten.includes(col)) return
      const idx = csvSpalten.indexOf('stunden')
      if (idx >= 0) csvSpalten.splice(idx + 1, 0, col)
      else csvSpalten.push(col)
    }
    insertAfterStunden('stundenUnverbucht')
    insertAfterStunden('stundenVerbucht')
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
