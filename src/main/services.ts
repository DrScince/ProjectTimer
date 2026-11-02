import {
  formatDate,
  formatDateDe,
  getEinstellungen,
  istBuchungAbgeschlossen,
  listBuchungenByRange,
  markBuchungenSapUeberfuehrt,
  minutenZuStundenCsv
} from './database'
import type {
  CsvVorschauZeile,
  ExportOptions,
  SapTransferStatus,
  WochenTag,
  WochenUebersicht,
  ZeitbuchungMitProjekt
} from '../shared/types'

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(iso: string, days: number): string {
  const date = parseIsoDate(iso)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

export function getMontagDerWoche(bezug?: string): string {
  const date = bezug ? parseIsoDate(bezug) : new Date()
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return formatDate(date)
}

export function istAbgeschlossen(buchung: ZeitbuchungMitProjekt): boolean {
  return istBuchungAbgeschlossen(buchung)
}

export function effektiveMinuten(buchung: ZeitbuchungMitProjekt, jetzt = new Date()): number {
  if (buchung.dauerMinuten != null && istAbgeschlossen(buchung)) {
    return buchung.dauerMinuten
  }
  if (buchung.startZeit && !buchung.endeZeit && buchung.quelle === 'timer') {
    const [sh, sm] = buchung.startZeit.split(':').map(Number)
    const startMinutes = sh * 60 + sm
    const nowMinutes = jetzt.getHours() * 60 + jetzt.getMinutes()
    let diff = nowMinutes - startMinutes
    if (diff < 0) diff += 24 * 60
    return diff
  }
  return 0
}

export function getWochenUebersicht(wochenStart?: string): WochenUebersicht {
  const start = wochenStart ? getMontagDerWoche(wochenStart) : getMontagDerWoche()
  const ende = addDays(start, 6)
  const buchungen = listBuchungenByRange(start, ende)

  const tage: WochenTag[] = []
  for (let i = 0; i < 7; i += 1) {
    const datum = addDays(start, i)
    const date = parseIsoDate(datum)
    const dayBuchungen = buchungen.filter((b) => b.datum === datum)
    const gesamtMinuten = dayBuchungen.reduce((sum, b) => sum + effektiveMinuten(b), 0)
    tage.push({
      datum,
      wochenTag: WOCHENTAGE[date.getDay()],
      gesamtMinuten,
      buchungen: dayBuchungen
    })
  }

  const summenMap = new Map<
    number,
    {
      projektId: number
      projektName: string
      projektKuerzel: string
      auftragsnummer: string
      gesamtMinuten: number
    }
  >()
  for (const b of buchungen) {
    const minutes = effektiveMinuten(b)
    if (minutes <= 0) continue
    const current = summenMap.get(b.projektId) ?? {
      projektId: b.projektId,
      projektName: b.projektName,
      projektKuerzel: b.projektKuerzel,
      auftragsnummer: b.auftragsnummer,
      gesamtMinuten: 0
    }
    current.gesamtMinuten += minutes
    summenMap.set(b.projektId, current)
  }

  const summenProProjekt = [...summenMap.values()].sort((a, b) =>
    a.projektKuerzel.localeCompare(b.projektKuerzel, 'de')
  )
  const gesamtMinuten = summenProProjekt.reduce((sum, p) => sum + p.gesamtMinuten, 0)

  return {
    wochenStart: start,
    wochenEnde: ende,
    tage,
    summenProProjekt,
    gesamtMinuten
  }
}

function sapStatusForIds(
  buchungen: ZeitbuchungMitProjekt[]
): { sapStatus: SapTransferStatus; sapUeberfuehrtAm: string | null } {
  if (buchungen.length === 0) {
    return { sapStatus: 'offen', sapUeberfuehrtAm: null }
  }
  const transferred = buchungen.filter((b) => Boolean(b.sapUeberfuehrtAm))
  if (transferred.length === 0) {
    return { sapStatus: 'offen', sapUeberfuehrtAm: null }
  }
  if (transferred.length === buchungen.length) {
    const times = Array.from(new Set(transferred.map((b) => b.sapUeberfuehrtAm as string)))
    return {
      sapStatus: 'ueberfuehrt',
      sapUeberfuehrtAm: times.length === 1 ? times[0] : null
    }
  }
  return { sapStatus: 'gemischt', sapUeberfuehrtAm: null }
}

export function buildCsvVorschau(
  von: string,
  bis: string,
  options: ExportOptions = {}
): CsvVorschauZeile[] {
  const settings = getEinstellungen()
  const nurOffen = Boolean(options.nurOffen)
  let buchungen = listBuchungenByRange(von, bis).filter((b) => istAbgeschlossen(b))
  if (nurOffen) {
    buchungen = buchungen.filter((b) => !b.sapUeberfuehrtAm)
  }

  const groups = new Map<
    string,
    { buchung: ZeitbuchungMitProjekt; minuten: number; items: ZeitbuchungMitProjekt[] }
  >()

  for (const b of buchungen) {
    const key = [b.datum, b.projektId, b.notiz].join('|')
    const existing = groups.get(key)
    const minutes = effektiveMinuten(b)
    if (existing) {
      existing.minuten += minutes
      existing.items.push(b)
    } else {
      groups.set(key, { buchung: b, minuten: minutes, items: [b] })
    }
  }

  return [...groups.values()]
    .filter((g) => g.minuten > 0)
    .sort((a, b) => {
      const byDate = a.buchung.datum.localeCompare(b.buchung.datum)
      if (byDate !== 0) return byDate
      return a.buchung.projektKuerzel.localeCompare(b.buchung.projektKuerzel, 'de')
    })
    .map(({ buchung, minuten, items }) => {
      const sap = sapStatusForIds(items)
      return {
        personalnummer: settings.personalnummer,
        datum: formatDateDe(buchung.datum),
        stunden: minutenZuStundenCsv(minuten),
        auftragsnummer: buchung.auftragsnummer,
        arbeitsplatz: buchung.arbeitsplatz,
        projektKuerzel: buchung.projektKuerzel,
        empfaengerArt: buchung.empfaengerArt,
        empfaenger: buchung.empfaenger,
        leistungsart: buchung.leistungsart,
        kurztext: buchung.notiz,
        buchungIds: items.map((item: ZeitbuchungMitProjekt) => item.id),
        sapStatus: sap.sapStatus,
        sapUeberfuehrtAm: sap.sapUeberfuehrtAm
      }
    })
}

function escapeCsvField(value: string, delimiter: string): string {
  const needsQuotes =
    value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
  if (!needsQuotes) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function buildCsvContent(von: string, bis: string, options: ExportOptions = {}): string {
  const settings = getEinstellungen()
  const delimiter = settings.csvTrennzeichen || ';'
  const rows = buildCsvVorschau(von, bis, options)
  const columns = settings.csvSpalten

  const header = columns.join(delimiter)
  const lines = rows.map((row) => {
    const record = row as unknown as Record<string, string>
    return columns.map((col) => escapeCsvField(record[col] ?? '', delimiter)).join(delimiter)
  })

  return `\uFEFF${[header, ...lines].join('\r\n')}`
}

export function collectExportBuchungIds(
  von: string,
  bis: string,
  options: ExportOptions = {}
): number[] {
  const rows = buildCsvVorschau(von, bis, options)
  return Array.from(new Set(rows.flatMap((r) => r.buchungIds)))
}

export function markExportAsSapTransferred(
  von: string,
  bis: string,
  options: ExportOptions = {}
): number {
  const ids = collectExportBuchungIds(von, bis, options)
  return markBuchungenSapUeberfuehrt(ids)
}
