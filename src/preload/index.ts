import { contextBridge, ipcRenderer } from 'electron'
import type {
  Anwesenheit,
  AnwesenheitTagSumme,
  Einstellungen,
  FloatBarLayout,
  FloatingBarStatus,
  IdlePrompt,
  IdleResolveInput,
  Projekt,
  ProjektInput,
  ProjektMitZeit,
  TagesThema,
  TopicVerteilung,
  WochenUebersicht,
  ZeitbuchungInput,
  ZeitbuchungMitProjekt,
  CsvVorschauZeile,
  ExportOptions,
  SapTagesStatus,
  AppUpdateInfo
} from '../shared/types'

const api = {
  projekte: {
    list: (nurAktiv = false): Promise<Projekt[]> => ipcRenderer.invoke('projekte:list', nurAktiv),
    listMitZeiten: (): Promise<ProjektMitZeit[]> => ipcRenderer.invoke('projekte:listMitZeiten'),
    create: (input: ProjektInput): Promise<Projekt> => ipcRenderer.invoke('projekte:create', input),
    update: (id: number, input: ProjektInput): Promise<Projekt> =>
      ipcRenderer.invoke('projekte:update', id, input),
    setAktiv: (id: number, aktiv: boolean): Promise<Projekt> =>
      ipcRenderer.invoke('projekte:setAktiv', id, aktiv),
    updateKurztext: (id: number, kurztext: string): Promise<Projekt> =>
      ipcRenderer.invoke('projekte:updateKurztext', id, kurztext),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke('projekte:delete', id),
    move: (id: number, direction: 'up' | 'down'): Promise<Projekt[]> =>
      ipcRenderer.invoke('projekte:move', id, direction),
    reorder: (orderedIds: number[]): Promise<Projekt[]> =>
      ipcRenderer.invoke('projekte:reorder', orderedIds),
    exportJson: (): Promise<{ canceled: boolean; path?: string; count?: number }> =>
      ipcRenderer.invoke('projekte:export'),
    importJson: (): Promise<{ canceled: boolean; created?: number; updated?: number }> =>
      ipcRenderer.invoke('projekte:import')
  },
  anwesenheit: {
    get: (): Promise<Anwesenheit | null> => ipcRenderer.invoke('anwesenheit:get'),
    listMinutenByRange: (von: string, bis: string): Promise<AnwesenheitTagSumme[]> =>
      ipcRenderer.invoke('anwesenheit:listMinutenByRange', von, bis),
    kommen: (): Promise<Anwesenheit> => ipcRenderer.invoke('anwesenheit:kommen'),
    gehen: (): Promise<Anwesenheit> => ipcRenderer.invoke('anwesenheit:gehen'),
    pauseToggle: (): Promise<Anwesenheit> => ipcRenderer.invoke('anwesenheit:pauseToggle')
  },
  buchungen: {
    listByDatum: (datum: string): Promise<ZeitbuchungMitProjekt[]> =>
      ipcRenderer.invoke('buchungen:listByDatum', datum),
    listByRange: (von: string, bis: string): Promise<ZeitbuchungMitProjekt[]> =>
      ipcRenderer.invoke('buchungen:listByRange', von, bis),
    create: (input: ZeitbuchungInput): Promise<ZeitbuchungMitProjekt> =>
      ipcRenderer.invoke('buchungen:create', input),
    update: (id: number, input: ZeitbuchungInput): Promise<ZeitbuchungMitProjekt> =>
      ipcRenderer.invoke('buchungen:update', id, input),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke('buchungen:delete', id),
    sapStatus: (datum: string): Promise<SapTagesStatus> =>
      ipcRenderer.invoke('buchungen:sapStatus', datum),
    markSap: (ids: number[]): Promise<number> => ipcRenderer.invoke('buchungen:markSap', ids),
    clearSap: (ids: number[]): Promise<number> => ipcRenderer.invoke('buchungen:clearSap', ids),
    markSapDatum: (datum: string): Promise<number> =>
      ipcRenderer.invoke('buchungen:markSapDatum', datum),
    clearSapDatum: (datum: string): Promise<number> =>
      ipcRenderer.invoke('buchungen:clearSapDatum', datum),
    markSapDatumProjekt: (datum: string, projektId: number): Promise<number> =>
      ipcRenderer.invoke('buchungen:markSapDatumProjekt', datum, projektId),
    clearSapDatumProjekt: (datum: string, projektId: number): Promise<number> =>
      ipcRenderer.invoke('buchungen:clearSapDatumProjekt', datum, projektId),
    markSapDatumProjektNotiz: (
      datum: string,
      projektId: number,
      kurztext: string
    ): Promise<number> =>
      ipcRenderer.invoke('buchungen:markSapDatumProjektNotiz', datum, projektId, kurztext),
    clearSapDatumProjektNotiz: (
      datum: string,
      projektId: number,
      kurztext: string
    ): Promise<number> =>
      ipcRenderer.invoke('buchungen:clearSapDatumProjektNotiz', datum, projektId, kurztext)
  },
  themen: {
    create: (projektId: number, kurztext: string): Promise<TagesThema> =>
      ipcRenderer.invoke('themen:create', projektId, kurztext),
    delete: (projektId: number, kurztext: string): Promise<boolean> =>
      ipcRenderer.invoke('themen:delete', projektId, kurztext),
    redistribute: (
      projektId: number,
      datum: string,
      allocations: TopicVerteilung[]
    ): Promise<number> => ipcRenderer.invoke('themen:redistribute', projektId, datum, allocations)
  },
  timer: {
    get: (): Promise<ZeitbuchungMitProjekt | null> => ipcRenderer.invoke('timer:get'),
    start: (projektId: number, notiz?: string): Promise<ZeitbuchungMitProjekt> =>
      ipcRenderer.invoke('timer:start', projektId, notiz),
    stop: (): Promise<ZeitbuchungMitProjekt | null> => ipcRenderer.invoke('timer:stop')
  },
  woche: {
    get: (wochenStart?: string): Promise<WochenUebersicht> =>
      ipcRenderer.invoke('woche:get', wochenStart)
  },
  einstellungen: {
    get: (): Promise<Einstellungen> => ipcRenderer.invoke('einstellungen:get'),
    save: (settings: Einstellungen): Promise<Einstellungen> =>
      ipcRenderer.invoke('einstellungen:save', settings),
    setKurztextHeute: (kurztext: string): Promise<Einstellungen> =>
      ipcRenderer.invoke('einstellungen:setKurztextHeute', kurztext)
  },
  floating: {
    getStatus: (): Promise<FloatingBarStatus> => ipcRenderer.invoke('floating:getStatus'),
    showMain: (): Promise<void> => ipcRenderer.invoke('floating:showMain'),
    getBounds: (): Promise<{ x: number; y: number; width: number; height: number } | null> =>
      ipcRenderer.invoke('floating:getBounds'),
    setPosition: (x: number, y: number): Promise<void> =>
      ipcRenderer.invoke('floating:setPosition', x, y),
    persistEdgeOffset: (): Promise<number | null> =>
      ipcRenderer.invoke('floating:persistEdgeOffset'),
    getLayout: (): Promise<FloatBarLayout> => ipcRenderer.invoke('floating:getLayout'),
    setExpanded: (expanded: boolean): Promise<FloatBarLayout> =>
      ipcRenderer.invoke('floating:setExpanded', expanded),
    onLayout: (callback: (layout: FloatBarLayout) => void): (() => void) => {
      const handler = (_event: unknown, layout: FloatBarLayout): void => callback(layout)
      ipcRenderer.on('floating:layout', handler)
      return () => ipcRenderer.removeListener('floating:layout', handler)
    }
  },
  onStatusChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('status:changed', handler)
    return () => ipcRenderer.removeListener('status:changed', handler)
  },
  onEinstellungenChanged: (callback: (settings: Einstellungen) => void): (() => void) => {
    const handler = (_event: unknown, settings: Einstellungen): void => callback(settings)
    ipcRenderer.on('einstellungen:changed', handler)
    return () => ipcRenderer.removeListener('einstellungen:changed', handler)
  },
  idle: {
    getPrompt: (): Promise<IdlePrompt | null> => ipcRenderer.invoke('idle:getPrompt'),
    resolve: (input: IdleResolveInput): Promise<boolean> => ipcRenderer.invoke('idle:resolve', input),
    onPrompt: (callback: (prompt: IdlePrompt) => void): (() => void) => {
      const handler = (_event: unknown, prompt: IdlePrompt): void => callback(prompt)
      ipcRenderer.on('idle:prompt', handler)
      return () => ipcRenderer.removeListener('idle:prompt', handler)
    }
  },
  export: {
    vorschau: (
      von: string,
      bis: string,
      options: ExportOptions = {}
    ): Promise<CsvVorschauZeile[]> => ipcRenderer.invoke('export:vorschau', von, bis, options),
    csv: (
      von: string,
      bis: string,
      options: ExportOptions = {}
    ): Promise<{ canceled: boolean; path?: string }> =>
      ipcRenderer.invoke('export:csv', von, bis, options),
    excel: (
      von: string,
      bis: string,
      options: ExportOptions = {}
    ): Promise<{ canceled: boolean; path?: string; opened?: boolean }> =>
      ipcRenderer.invoke('export:excel', von, bis, options),
    pdf: (
      von: string,
      bis: string,
      options: ExportOptions = {}
    ): Promise<{ canceled: boolean; path?: string }> =>
      ipcRenderer.invoke('export:pdf', von, bis, options),
    markSap: (ids: number[]): Promise<number> => ipcRenderer.invoke('export:markSap', ids),
    clearSap: (ids: number[]): Promise<number> => ipcRenderer.invoke('export:clearSap', ids)
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: (): Promise<boolean> => ipcRenderer.invoke('window:maximizeToggle'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    onState: (callback: (state: { isMaximized: boolean }) => void): (() => void) => {
      const handler = (_event: unknown, state: { isMaximized: boolean }): void => callback(state)
      ipcRenderer.on('window:state', handler)
      return () => ipcRenderer.removeListener('window:state', handler)
    }
  },
  updater: {
    getStatus: (): Promise<AppUpdateInfo> => ipcRenderer.invoke('updater:getStatus'),
    install: (): Promise<boolean> => ipcRenderer.invoke('updater:install'),
    openDownload: (): Promise<boolean> => ipcRenderer.invoke('updater:openDownload'),
    onStatus: (callback: (info: AppUpdateInfo) => void): (() => void) => {
      const handler = (_event: unknown, info: AppUpdateInfo): void => callback(info)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ProjectTimerApi = typeof api
