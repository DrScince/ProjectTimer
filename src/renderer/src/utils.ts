export function heuteIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatDatumDe(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** ISO-Zeitstempel lokal formatiert (Datum + Uhrzeit) */
export function formatDateTimeLocal(iso: string | null | undefined, locale = 'de-DE'): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatDauer(minuten: number): string {
  const total = Math.max(0, Math.round(minuten))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}:${String(m).padStart(2, '0')} h`
}

export function formatSekunden(sekunden: number): string {
  const total = Math.max(0, Math.floor(sekunden))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(3, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatStundenDezimal(minuten: number): string {
  return (minuten / 60).toFixed(2).replace('.', ',')
}

export function laufendeMinuten(startZeit: string | null, jetzt = new Date()): number {
  return Math.floor(laufendeSekunden(startZeit, jetzt) / 60)
}

/** startZeit als HH:MM oder HH:MM:SS */
export function laufendeSekunden(startZeit: string | null, jetzt = new Date()): number {
  if (!startZeit) return 0
  const parts = startZeit.split(':').map(Number)
  const sh = parts[0] ?? 0
  const sm = parts[1] ?? 0
  const ss = parts[2] ?? 0
  const start = sh * 3600 + sm * 60 + ss
  const now = jetzt.getHours() * 3600 + jetzt.getMinutes() * 60 + jetzt.getSeconds()
  let diff = now - start
  if (diff < 0) diff += 24 * 3600
  return diff
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** YYYY-MM aus ISO-Datum */
export function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7)
}

export function monthStartIso(monthKey: string): string {
  return `${monthKey}-01`
}

export function monthEndIso(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${monthKey}-${String(last).padStart(2, '0')}`
}

export function addMonthsKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** HH:MM:SS oder HH:MM → HH:MM */
export function formatZeitHm(zeit: string | null | undefined): string {
  if (!zeit) return '–'
  const parts = zeit.split(':')
  if (parts.length < 2) return zeit
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
}

export type CalendarCell = {
  datum: string | null
  inMonth: boolean
}

/** Kalenderzellen Mo–So für einen Monat (YYYY-MM) */
export function buildMonthCells(monthKey: string): CalendarCell[] {
  const [y, m] = monthKey.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const daysInMonth = new Date(y, m, 0).getDate()
  // Mo=0 … So=6
  const startPad = (first.getDay() + 6) % 7
  const cells: CalendarCell[] = []
  for (let i = 0; i < startPad; i += 1) {
    cells.push({ datum: null, inMonth: false })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      datum: `${monthKey}-${String(day).padStart(2, '0')}`,
      inMonth: true
    })
  }
  while (cells.length % 7 !== 0) {
    cells.push({ datum: null, inMonth: false })
  }
  return cells
}
