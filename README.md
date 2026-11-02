# ProjectTimer

Desktop-App zur Erfassung von Projektzeiten mit Export als SAP-orientierte CSV-Datei.

## Voraussetzungen

- Node.js 20+ (empfohlen: LTS)
- Windows

## Entwicklung starten

```bash
npm install
npm run rebuild
npm run dev
```

Falls Electron nach `npm install` fehlt (kein `electron.exe`), einmal ausführen:

```bash
node scripts/install-electron.js
npm run rebuild
```

## Funktionen (Version 1)

- Timer und manuelle Zeitbuchungen
- Wochenübersicht mit Summen je Tag und Projekt
- Projektverwaltung inkl. JSON-Import/Export fürs Team
- Einstellungen (Name, Personalnummer, CSV-Spalten)
- CSV-Export mit Semikolon und deutschem Stundenformat

Daten liegen lokal unter `%AppData%\ProjectTimer\projecttimer.db`.

## Build

```bash
npm run build
```
