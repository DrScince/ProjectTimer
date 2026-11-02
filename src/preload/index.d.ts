import type { ProjectTimerApi } from './index'

declare global {
  interface Window {
    api: ProjectTimerApi
  }
}

export {}
