import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [
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
