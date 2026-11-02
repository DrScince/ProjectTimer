const { app } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')

app.whenReady().then(() => {
  const candidates = [
    path.join(process.env.APPDATA, 'ProjectTimer', 'projecttimer.db'),
    path.join(process.env.APPDATA, 'project-timer', 'projecttimer.db'),
    path.join(process.env.APPDATA, 'project-timer', 'ProjectTimer', 'projecttimer.db')
  ]
  for (const dbPath of candidates) {
    try {
      const db = new Database(dbPath, { readonly: true })
      console.log('===', dbPath)
      console.log('cols', db.prepare('PRAGMA table_info(projekte)').all().map((c) => c.name))
      console.log('rows', db.prepare('SELECT * FROM projekte').all())
      db.close()
    } catch (err) {
      console.log('skip', dbPath, err.message)
    }
  }
  app.exit(0)
})
