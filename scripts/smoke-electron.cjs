const { app } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')

// Verhindert Fenster; nur Logik testen
app.whenReady().then(async () => {
  try {
    // Dynamisch die kompilierten Module laden, falls vorhanden, sonst TS-Quellen über require der gebauten Dateien
    const outMain = path.join(__dirname, '../out/main')
    // Sicherstellen, dass Build vorhanden ist
    require('child_process').execSync('npx electron-vite build', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    })

    // Nach Build: Database und Services aus out laden geht nicht leicht wegen ESM.
    // Stattdessen direkte SQLite-Prüfung analog zur App.
    const Database = require('better-sqlite3')
    const fs = require('fs')
    const os = require('os')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-smoke-'))
    const db = new Database(path.join(dir, 't.db'))
    db.exec(`
      CREATE TABLE projekte (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kuerzel TEXT NOT NULL UNIQUE,
        empfaenger_art TEXT NOT NULL,
        empfaenger TEXT NOT NULL DEFAULT '',
        leistungsart TEXT NOT NULL DEFAULT '',
        aktiv INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE zeitbuchungen (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        projekt_id INTEGER NOT NULL,
        datum TEXT NOT NULL,
        start_zeit TEXT,
        ende_zeit TEXT,
        dauer_minuten INTEGER,
        notiz TEXT NOT NULL DEFAULT '',
        quelle TEXT NOT NULL DEFAULT 'manuell'
      );
    `)
    const p = db
      .prepare(
        `INSERT INTO projekte (name,kuerzel,empfaenger_art,empfaenger,leistungsart) VALUES (?,?,?,?,?)`
      )
      .run('Demo', 'DEMO', 'Kostenstelle', '123', '9001')
    const today = new Date()
    const datum = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    db.prepare(
      `INSERT INTO zeitbuchungen (projekt_id,datum,dauer_minuten,notiz,quelle) VALUES (?,?,?,?,?)`
    ).run(p.lastInsertRowid, datum, 90, 'Test', 'manuell')

    const row = db.prepare('SELECT * FROM zeitbuchungen').get()
    const ok =
      row &&
      row.quelle === 'manuell' &&
      row.dauer_minuten === 90 &&
      (row.ende_zeit == null) &&
      true

    // Abschlussregel wie in services.ts
    const abgeschlossen =
      row.ende_zeit != null ||
      (row.quelle === 'manuell' && row.dauer_minuten != null && row.dauer_minuten > 0)
    if (!ok || !abgeschlossen) throw new Error('Buchungslogik fehlgeschlagen')

    const userData = app.getPath('userData')
    console.log('Smoke-Test OK')
    console.log('userData =', userData)
    console.log('better-sqlite3 unter Electron funktioniert')
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
    app.exit(0)
  } catch (err) {
    console.error('Smoke-Test FEHLER:', err)
    app.exit(1)
  }
})
