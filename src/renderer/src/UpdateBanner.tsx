import { useEffect, useState } from 'react'
import type { AppUpdateInfo } from '../../shared/types'
import { useI18n } from './i18n'

export default function UpdateBanner() {
  const { t } = useI18n()
  const [info, setInfo] = useState<AppUpdateInfo | null>(null)

  useEffect(() => {
    void window.api.updater.getStatus().then(setInfo).catch(() => undefined)
    return window.api.updater.onStatus(setInfo)
  }, [])

  if (!info) return null

  const isPortable = info.channel === 'portable'
  const showPortable = isPortable && info.status === 'available'
  const showDownloading =
    !isPortable && (info.status === 'downloading' || info.status === 'available')
  const showReady = !isPortable && info.status === 'ready'
  if (!showPortable && !showDownloading && !showReady) return null

  return (
    <div className={`update-banner${showReady || showPortable ? ' ready' : ''}`}>
      <div className="update-banner-text">
        {showPortable ? (
          <span>
            {t('update.portableAvailable', {
              version: info.availableVersion ?? ''
            })}
          </span>
        ) : showReady ? (
          <span>
            {t('update.ready', {
              version: info.availableVersion ?? ''
            })}
          </span>
        ) : (
          <span>
            {t('update.downloading', {
              version: info.availableVersion ?? '',
              percent: info.progressPercent ?? 0
            })}
          </span>
        )}
      </div>
      {showPortable && (
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() => void window.api.updater.openDownload()}
        >
          {t('update.download')}
        </button>
      )}
      {showReady && (
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() => void window.api.updater.install()}
        >
          {t('update.install')}
        </button>
      )}
    </div>
  )
}
