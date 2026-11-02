const { app } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')

app.whenReady().then(() => {
  const dbPath = path.join(process.env.APPDATA, 'ProjectTimer', 'projecttimer.db')
  const db = new Database(dbPath, { readonly: true })
  console.log('DB:', dbPath)
  console.log('Projekte:', db.prepare('SELECT id, kuerzel, name, aktiv FROM projekte').all())
  console.log(
    'Buchungen:',
    db.prepare('SELECT id, projekt_id, datum, dauer_minuten, quelle, ende_zeit FROM zeitbuchungen').all()
  )
  db.close()
  app.exit(0)
})
