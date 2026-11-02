const { app } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')

app.whenReady().then(() => {
  const dbPath = path.join(process.env.APPDATA, 'ProjectTimer', 'projecttimer.db')
  const db = new Database(dbPath)
  const cols = db.prepare('PRAGMA table_info(projekte)').all().map((c) => c.name)
  if (!cols.includes('auftragsnummer')) {
    db.exec(`ALTER TABLE projekte ADD COLUMN auftragsnummer TEXT DEFAULT ''`)
    console.log('Spalte auftragsnummer hinzugefügt')
  }
  if (!cols.includes('arbeitsplatz')) {
    db.exec(`ALTER TABLE projekte ADD COLUMN arbeitsplatz TEXT DEFAULT ''`)
    console.log('Spalte arbeitsplatz hinzugefügt')
  }
  console.log('cols', db.prepare('PRAGMA table_info(projekte)').all().map((c) => c.name))
  console.log('rows', db.prepare('SELECT id, kuerzel, auftragsnummer, arbeitsplatz FROM projekte').all())
  db.close()
  app.exit(0)
})
