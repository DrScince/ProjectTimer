export type EmpfaengerArt = 'Kostenstelle' | 'Innenauftrag' | 'PSP-Element'

export type BuchungQuelle = 'timer' | 'manuell'

export type SapTransferStatus = 'offen' | 'ueberfuehrt' | 'gemischt'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'not-available'
  | 'error'

export type UpdateChannel = 'installer' | 'portable'

export interface AppUpdateInfo {
  status: UpdateStatus
  channel: UpdateChannel
  currentVersion: string
  availableVersion: string | null
  progressPercent: number | null
  downloadUrl: string | null
  error: string | null
}

export interface Projekt {
  id: number
  name: string
  kuerzel: string
  auftragsnummer: string
  arbeitsplatz: string
  /** Optionaler SAP-Kurztext je Auftrag */
  kurztext: string
  empfaengerArt: EmpfaengerArt
  empfaenger: string
  leistungsart: string
  aktiv: boolean
  /** Anzeigereihenfolge (kleiner = weiter oben) */
  sortOrder: number
  erstelltAm: string
}

export interface ProjektInput {
  name: string
  kuerzel: string
  auftragsnummer: string
  arbeitsplatz: string
  kurztext?: string
  empfaengerArt: EmpfaengerArt
  empfaenger: string
  leistungsart: string
  aktiv?: boolean
}

export interface Zeitbuchung {
  id: number
  projektId: number
  datum: string
  startZeit: string | null
  endeZeit: string | null
  dauerMinuten: number | null
  /** Täglicher SAP-Kurztext */
  notiz: string
  quelle: BuchungQuelle
  erstelltAm: string
  /** ISO-Zeitpunkt der SAP-Überführung; null = noch nicht überführt */
  sapUeberfuehrtAm: string | null
}

export interface ZeitbuchungMitProjekt extends Zeitbuchung {
  projektName: string
  projektKuerzel: string
  auftragsnummer: string
  arbeitsplatz: string
  empfaengerArt: EmpfaengerArt
  empfaenger: string
  leistungsart: string
}

export interface ZeitbuchungInput {
  projektId: number
  datum: string
  startZeit?: string | null
  endeZeit?: string | null
  dauerMinuten?: number | null
  notiz?: string
  quelle?: BuchungQuelle
}

/** system = OS-Sprache, sonst fest de/en */
export type LanguagePreference = 'system' | 'de' | 'en'

export type FloatBarMode = 'free' | 'slideout'
export type FloatBarEdge = 'top' | 'left' | 'right'

export interface FloatBarLayout {
  mode: FloatBarMode
  edge: FloatBarEdge
  expanded: boolean
}

export interface Einstellungen {
  anzeigename: string
  personalnummer: string
  csvTrennzeichen: string
  csvSpalten: string[]
  /** Kompakte Always-on-Top-Leiste anzeigen */
  alwaysOnTopBar: boolean
  /** Frei schwebend oder an Kante als Slideout */
  floatBarMode: FloatBarMode
  /** Kante für Slideout-Modus */
  floatBarEdge: FloatBarEdge
  /**
   * Versatz entlang der Kante in Pixeln (vom Work-Area-Ursprung).
   * null = zentriert.
   */
  floatBarEdgeOffset: number | null
  /** Dunkles Erscheinungsbild der Hauptanwendung */
  darkMode: boolean
  /** PC-Sperre / Inaktivität erkennen */
  idleDetectionEnabled: boolean
  /** Inaktivitätsschwelle in Minuten (Sperre ab 1 Min. fest) */
  idleThresholdMinutes: number
  /** Beim ersten App-Start des Tages automatisch Kommen */
  autoKommenEnabled: boolean
  /** Beim Herunterfahren des PCs automatisch Gehen (bei Restart am selben Tag wird es zurückgenommen) */
  autoGehenOnShutdown: boolean
  /** App mit Windows starten (Autostart) */
  autoStartEnabled: boolean
  /** UI-Sprache: System oder fest */
  language: LanguagePreference
  /** Zuletzt gesetzter Tages-Kurztext (für Floating-Bar) */
  kurztextHeute: string
  kurztextDatum: string
}

export type IdleAwayReason = 'lock' | 'idle'

export interface IdlePromptProjekt {
  id: number
  name: string
  kuerzel: string
  auftragsnummer: string
}

export interface IdlePrompt {
  id: string
  reason: IdleAwayReason
  von: string
  bis: string
  dauerMinuten: number
  previousProjektId: number | null
  /** Kurztext/Topic des zuvor laufenden Timers */
  previousNotiz: string
  projekte: IdlePromptProjekt[]
}

export interface IdleResolveAllocation {
  /** null = Pause */
  projektId: number | null
  minuten: number
}

export interface IdleResolveInput {
  promptId: string
  allocations: IdleResolveAllocation[]
  /** Nach dem Buchen diesen Auftrag starten; null = Pause */
  fortsetzenProjektId: number | null
  /** Topic/Kurztext beim Fortsetzen */
  fortsetzenNotiz?: string
}

export interface FloatingBarStatus {
  anwesenheit: Anwesenheit | null
  timer: ZeitbuchungMitProjekt | null
  projekte: ProjektMitZeit[]
  personalnummer: string
}

export interface Anwesenheit {
  id: number
  kommenAm: string
  gehenAm: string | null
  pauseSeit: string | null
  pausenMinuten: number
  imPause: boolean
  /** Stempelzeit in Sekunden: seit Kommen abzüglich Pausen */
  stempelSekunden: number
  /** Bruttozeit in Sekunden: seit Kommen inkl. Pausen */
  bruttoSekunden: number
  istOffen: boolean
}

/** Summierte Anwesenheit (Stempelzeit) je Kalendertag */
export interface AnwesenheitTagSumme {
  datum: string
  stempelMinuten: number
}

/** Tages-Topic unter einem Auftrag (Kurztext mit eigener Zeit) */
export interface TagesThema {
  projektId: number
  kurztext: string
  heuteMinuten: number
  /** Abgeschlossene Minuten heute (ohne laufenden Timer) */
  heuteAbgeschlossenMinuten: number
  timerLaeuft: boolean
  sapStatus: SapTransferStatus | 'leer'
  sapUeberfuehrtAm: string | null
}

/** Nachträgliche Verteilung von Zeit ohne Kurztext auf Topics */
export interface TopicVerteilung {
  kurztext: string
  minuten: number
}

export interface ProjektMitZeit extends Projekt {
  /** Gesamte gebuchte Zeit auf den Auftrag (alle Tage) */
  gesamtMinuten: number
  /** Heute auf den Auftrag gebuchte Zeit */
  heuteMinuten: number
  /** Abgeschlossene Minuten heute (ohne laufenden Timer) – relevant für SAP */
  heuteAbgeschlossenMinuten: number
  /** SAP-Status der abgeschlossenen heutigen Buchungen dieses Auftrags */
  heuteSapStatus: SapTransferStatus | 'leer'
  /** Letzter SAP-Überführungszeitpunkt der heutigen Buchungen */
  heuteSapUeberfuehrtAm: string | null
  /** Heutige Topics/Kurztexte dieses Auftrags */
  themen: TagesThema[]
  timerLaeuft: boolean
  timerStartZeit: string | null
}

/** Tagesübersicht: welche abgeschlossenen Buchungen schon in SAP sind */
export interface SapTagesStatus {
  datum: string
  gesamt: number
  offen: number
  ueberfuehrt: number
  status: SapTransferStatus | 'leer'
  zuletztUeberfuehrtAm: string | null
}

export interface ProjektExport {
  version: 1
  exportedAt: string
  projekte: Array<{
    name: string
    kuerzel: string
    auftragsnummer: string
    arbeitsplatz: string
    kurztext: string
    empfaengerArt: EmpfaengerArt
    empfaenger: string
    leistungsart: string
    aktiv: boolean
  }>
}

export interface WochenTag {
  datum: string
  wochenTag: string
  gesamtMinuten: number
  buchungen: ZeitbuchungMitProjekt[]
}

export interface WochenUebersicht {
  wochenStart: string
  wochenEnde: string
  tage: WochenTag[]
  summenProProjekt: Array<{
    projektId: number
    projektName: string
    projektKuerzel: string
    auftragsnummer: string
    gesamtMinuten: number
  }>
  gesamtMinuten: number
}

export interface CsvVorschauZeile {
  personalnummer: string
  datum: string
  stunden: string
  auftragsnummer: string
  arbeitsplatz: string
  projektKuerzel: string
  empfaengerArt: string
  empfaenger: string
  leistungsart: string
  kurztext: string
  /** CSV-Feld: ja / nein / teilweise */
  sapUeberfuehrt: string
  buchungIds: number[]
  sapStatus: SapTransferStatus
  /** Einheitlicher Überführungszeitpunkt, sonst null */
  sapUeberfuehrtAm: string | null
}

export interface ExportOptions {
  /** @deprecated Immer alle Einträge; Filter entfernt */
  nurOffen?: boolean
  /** Nach erfolgreichem CSV-Speichern als überführt markieren */
  markiereUeberfuehrt?: boolean
  /** Excel: speichern, direkt öffnen, oder nachfragen */
  excelMode?: 'save' | 'open' | 'ask'
}

export const DEFAULT_CSV_SPALTEN = [
  'personalnummer',
  'datum',
  'stunden',
  'auftragsnummer',
  'arbeitsplatz',
  'projektKuerzel',
  'kurztext',
  'sapUeberfuehrt'
] as const

export const CSV_SPALTEN_LABELS: Record<string, string> = {
  personalnummer: 'Personalnummer',
  datum: 'Datum',
  stunden: 'Stunden',
  auftragsnummer: 'Auftragsnummer',
  arbeitsplatz: 'Arbeitsplatz',
  projektKuerzel: 'Projektkürzel',
  empfaengerArt: 'Empfängerart',
  empfaenger: 'Empfänger',
  leistungsart: 'Leistungsart',
  kurztext: 'Kurztext',
  notiz: 'Kurztext',
  sapUeberfuehrt: 'SAP überführt'
}
