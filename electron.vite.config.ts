import { createRequire } from 'module'
import { dirname, join, resolve } from 'path'
import { readdirSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)

/**
 * pdfkit 0.20 lädt Standardfonts per Package-Import `#standard-fonts/Helvetica`.
 * Dynamische require("#standard-fonts/…") bleiben sonst im Bundle und scheitern.
 * Wir mappen auf die .mjs-Dateien und ersetzen die Lazy-Requires durch Imports.
 */
function pdfkitStandardFontsPlugin(): Plugin {
  const pdfkitEntry = require.resolve('pdfkit')
  const fontsDir = join(dirname(dirname(pdfkitEntry)), 'js', 'standard-fonts')
  const fontNames = readdirSync(fontsDir)
    .filter((f) => f.endsWith('.mjs') && !f.includes('chunks'))
    .map((f) => f.replace(/\.mjs$/, ''))
  const prefix = '#standard-fonts/'

  return {
    name: 'pdfkit-standard-fonts',
    enforce: 'pre',
    resolveId(id) {
      if (!id.startsWith(prefix)) return null
      const name = id.slice(prefix.length)
      return join(fontsDir, `${name}.mjs`)
    },
    transform(code, id) {
      const norm = id.replace(/\\/g, '/')
      if (!norm.includes('/pdfkit/') || !code.includes(prefix)) return null

      const imports = fontNames
        .map((name) => `import __pdfkitSF_${name} from "${prefix}${name}";`)
        .join('\n')

      let next = code
      for (const name of fontNames) {
        for (const q of [`'${prefix}${name}'`, `"${prefix}${name}"`]) {
          next = next.split(`() => require$1(${q})`).join(`() => __pdfkitSF_${name}`)
          next = next.split(`() => require(${q})`).join(`() => __pdfkitSF_${name}`)
        }
      }

      if (next === code) return null
      return { code: `${imports}\n${next}`, map: null }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [
      pdfkitStandardFontsPlugin(),
      externalizeDepsPlugin({
        // Default: alle package.json-Dependencies werden externalisiert.
        // Pure-JS-Deps (exceljs-Kette) MÜSSEN gebündelt werden – sonst
        // crasht der Installer mit "Cannot find module 'call-bind-apply-helpers'".
        exclude: ['exceljs', 'pdfkit', 'call-bind-apply-helpers']
      })
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
