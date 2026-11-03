import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { buildCsvVorschau } from './services'
import { formatDateDe, getEinstellungen } from './database'
import type { CsvVorschauZeile, ExportOptions } from '../shared/types'
import { t } from '../shared/i18n'

const EXCEL_COLUMNS: Array<{
  key: keyof CsvVorschauZeile | 'sapUeberfuehrt'
  header: string
  width: number
}> = [
  { key: 'personalnummer', header: 'personalnummer', width: 14 },
  { key: 'datum', header: 'datum', width: 12 },
  { key: 'stunden', header: 'stunden', width: 12 },
  { key: 'auftragsnummer', header: 'auftragsnummer', width: 14 },
  { key: 'arbeitsplatz', header: 'arbeitsplatz', width: 14 },
  { key: 'projektKuerzel', header: 'projektKuerzel', width: 14 },
  { key: 'kurztext', header: 'kurztext', width: 28 },
  { key: 'sapUeberfuehrt', header: 'sapUeberfuehrt', width: 14 }
]

function loadRows(von: string, bis: string, options: ExportOptions = {}): CsvVorschauZeile[] {
  return buildCsvVorschau(von, bis, options)
}

export async function buildExcelBuffer(
  von: string,
  bis: string,
  options: ExportOptions = {}
): Promise<Buffer> {
  const rows = loadRows(von, bis, options)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'ProjectTimer'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Zeiten', {
    views: [{ state: 'frozen', ySplit: 1 }]
  })

  sheet.columns = EXCEL_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width
  }))

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2F6B4F' }
  }
  headerRow.alignment = { vertical: 'middle' }

  for (const row of rows) {
    const excelRow = sheet.addRow({
      personalnummer: row.personalnummer,
      datum: row.datum,
      stunden: row.stunden,
      auftragsnummer: row.auftragsnummer,
      arbeitsplatz: row.arbeitsplatz,
      projektKuerzel: row.projektKuerzel,
      kurztext: row.kurztext,
      sapUeberfuehrt: row.sapUeberfuehrt
    })
    // Dauer als Text, damit Excel nicht in Uhrzeit umwandelt
    excelRow.getCell('stunden').numFmt = '@'
    excelRow.getCell('datum').numFmt = '@'
    excelRow.getCell('personalnummer').numFmt = '@'
    excelRow.getCell('auftragsnummer').numFmt = '@'
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: EXCEL_COLUMNS.length }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

export async function buildPdfBuffer(
  von: string,
  bis: string,
  options: ExportOptions = {}
): Promise<Buffer> {
  const rows = loadRows(von, bis, options)
  const settings = getEinstellungen()

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
      info: {
        Title: `ProjectTimer ${von} – ${bis}`,
        Author: 'ProjectTimer'
      }
    })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(16).fillColor('#1f2937').text(t('export.pdfTitle'), { continued: false })
    doc.moveDown(0.35)
    doc
      .fontSize(10)
      .fillColor('#4b5563')
      .text(
        `${t('export.from')}: ${formatDateDe(von)}  ·  ${t('export.to')}: ${formatDateDe(bis)}  ·  ${t('export.colPersonal')}: ${settings.personalnummer || '–'}  ·  ${rows.length} ${t('export.pdfEntries')}`
      )
    doc.moveDown(0.8)

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const cols = [
      { key: 'datum' as const, label: t('export.colDate'), width: 0.1 },
      { key: 'stunden' as const, label: t('export.colHours'), width: 0.1 },
      { key: 'auftragsnummer' as const, label: t('export.colOrder'), width: 0.12 },
      { key: 'arbeitsplatz' as const, label: t('export.colWorkplace'), width: 0.12 },
      { key: 'projektKuerzel' as const, label: t('export.colProject'), width: 0.1 },
      { key: 'kurztext' as const, label: t('export.colText'), width: 0.28 },
      { key: 'sapUeberfuehrt' as const, label: t('export.colSap'), width: 0.1 }
    ]
    const colWidths = cols.map((c) => c.width * pageWidth)
    const startX = doc.page.margins.left
    const rowHeight = 18

    function drawHeader(y: number): number {
      doc.save()
      doc.rect(startX, y, pageWidth, rowHeight).fill('#2F6B4F')
      doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
      let x = startX
      cols.forEach((col, i) => {
        doc.text(col.label, x + 4, y + 5, {
          width: colWidths[i] - 8,
          ellipsis: true
        })
        x += colWidths[i]
      })
      doc.restore()
      return y + rowHeight
    }

    let y = drawHeader(doc.y)

    doc.font('Helvetica').fontSize(8).fillColor('#111827')
    for (const row of rows) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage()
        y = drawHeader(doc.page.margins.top)
        doc.font('Helvetica').fontSize(8).fillColor('#111827')
      }

      const values = [
        row.datum,
        row.stunden,
        row.auftragsnummer || '–',
        row.arbeitsplatz || '–',
        row.projektKuerzel,
        row.kurztext || '–',
        row.sapUeberfuehrt
      ]

      let x = startX
      values.forEach((value, i) => {
        doc.text(String(value), x + 4, y + 5, {
          width: colWidths[i] - 8,
          ellipsis: true,
          lineBreak: false
        })
        x += colWidths[i]
      })
      y += rowHeight
      doc
        .moveTo(startX, y)
        .lineTo(startX + pageWidth, y)
        .strokeColor('#e5e7eb')
        .lineWidth(0.5)
        .stroke()
    }

    if (rows.length === 0) {
      doc.fontSize(10).fillColor('#6b7280').text(t('export.empty'), startX, y + 12)
    }

    doc.end()
  })
}
