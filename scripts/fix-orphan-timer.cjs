const { app } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')

app.whenReady().then(() => {
  const dbPath = path.join(process.env.APPDATA, 'ProjectTimer', 'projecttimer.db')
  const db = new Database(dbPath)
  const row = db
    .prepare(`SELECT * FROM zeitbuchungen WHERE ende_zeit IS NULL AND quelle = 'timer'`)
    .get()
  if (row) {
    db.prepare(
      `UPDATE zeitbuchungen SET ende_zeit = ?, dauer_minuten = ? WHERE id = ?`
    ).run('10:15', 6, row.id)
    console.log('Offenen Timer geschlossen, id=', row.id)
  } else {
    console.log('Kein offener Timer')
  }
  // Beispiel-Manuellbuchung falls noch keine abgeschlossene existiert
  const done = db
    .prepare(
      `SELECT COUNT(*) AS c FROM zeitbuchungen WHERE dauer_minuten IS NOT NULL AND dauer_minuten > 0`
    )
    .get()
  if (done.c === 0) {
    db.prepare(
      `INSERT INTO zeitbuchungen (projekt_id, datum, dauer_minuten, notiz, quelle, ende_zeit)
       VALUES (1, date('now','localtime'), 60, 'Beispielbuchung', 'manuell', '12:00')`
    ).run()
    console.log('Beispielbuchung 1h angelegt')
  }
  db.close()
  app.exit(0)
})
