import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { Anwesenheit, EmpfaengerArt, ProjektMitZeit } from '../../../shared/types'
import { useI18n } from '../i18n'
import { formatDateTimeLocal, formatDauer, formatSekunden, heuteIso } from '../utils'

type Props = {
  onNeuerAuftrag?: () => void
}

export default function TodayPage({ onNeuerAuftrag }: Props) {
  const { t, localeTag } = useI18n()
  const [anwesenheit, setAnwesenheit] = useState<Anwesenheit | null>(null)
  const [projekte, setProjekte] = useState<ProjektMitZeit[]>([])
  const [sapMessage, setSapMessage] = useState('')
  const [personalnummer, setPersonalnummer] = useState('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [quick, setQuick] = useState({
    name: '',
    kuerzel: '',
    auftragsnummer: '',
    arbeitsplatz: '',
    empfaengerArt: 'Innenauftrag' as EmpfaengerArt,
    empfaenger: '',
    leistungsart: ''
  })
  const [manual, setManual] = useState({
    projektId: '' as number | '',
    dauerStunden: '1',
    dauerMinuten: '0',
    notiz: ''
  })

  const load = useCallback(async () => {
    const [a, p, settings] = await Promise.all([
      window.api.anwesenheit.get(),
      window.api.projekte.listMitZeiten(),
      window.api.einstellungen.get()
    ])
    setAnwesenheit(a)
    setProjekte(p)
    setPersonalnummer(settings.personalnummer)
    setManual((prev) =>
      prev.projektId === '' && p.length > 0 ? { ...prev, projektId: p[0].id } : prev
    )
  }, [])

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
    // Mit Top-Leiste synchron halten (Events + Polling-Fallback)
    const unsubscribe = window.api.onStatusChanged(() => {
      void load().catch(() => undefined)
    })
    const poll = window.setInterval(() => {
      void load().catch(() => undefined)
    }, 2000)
    return () => {
      unsubscribe()
      window.clearInterval(poll)
    }
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const stempelLive = useMemo(() => {
    if (!anwesenheit?.istOffen) {
      return anwesenheit
    }
    const kommenMs = new Date(anwesenheit.kommenAm).getTime()
    const bruttoSekunden = Math.max(0, Math.floor((now.getTime() - kommenMs) / 1000))
    let pausenSekunden = anwesenheit.pausenMinuten * 60
    if (anwesenheit.pauseSeit) {
      pausenSekunden += Math.max(
        0,
        Math.floor((now.getTime() - new Date(anwesenheit.pauseSeit).getTime()) / 1000)
      )
    }
    return {
      ...anwesenheit,
      bruttoSekunden,
      stempelSekunden: Math.max(0, bruttoSekunden - pausenSekunden)
    }
  }, [anwesenheit, now])

  const aktiverAuftrag = projekte.find((p) => p.timerLaeuft) ?? null

  async function handleKommen() {
    setError('')
    try {
      setAnwesenheit(await window.api.anwesenheit.kommen())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errCheckIn'))
    }
  }

  async function handleGehen() {
    setError('')
    try {
      setAnwesenheit(await window.api.anwesenheit.gehen())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errCheckOut'))
    }
  }

  async function handlePause() {
    setError('')
    try {
      setAnwesenheit(await window.api.anwesenheit.pauseToggle())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errPause'))
    }
  }

  async function handleSapMarkAuftrag(projektId: number): Promise<void> {
    setError('')
    setSapMessage('')
    try {
      if (typeof window.api.buchungen.markSapDatumProjekt !== 'function') {
        throw new Error(t('stempel.errSap'))
      }
      const count = await window.api.buchungen.markSapDatumProjekt(heuteIso(), projektId)
      setSapMessage(t('stempel.sapMarked', { count }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  async function handleSapClearAuftrag(projektId: number): Promise<void> {
    setError('')
    setSapMessage('')
    try {
      if (typeof window.api.buchungen.clearSapDatumProjekt !== 'function') {
        throw new Error(t('stempel.errSap'))
      }
      const count = await window.api.buchungen.clearSapDatumProjekt(heuteIso(), projektId)
      setSapMessage(t('stempel.sapCleared', { count }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errSap'))
    }
  }

  function sapOrderStatusLabel(status: ProjektMitZeit['heuteSapStatus']): string {
    if (status === 'ueberfuehrt') return t('stempel.sapOrderDone')
    if (status === 'gemischt') return t('stempel.sapOrderPartial')
    if (status === 'offen') return t('stempel.sapOrderOpen')
    return t('stempel.sapOrderOpen')
  }

  async function handleAuftragClick(projekt: ProjektMitZeit) {
    setError('')
    try {
      if (projekt.timerLaeuft) {
        await window.api.timer.stop()
      } else {
        await window.api.timer.start(projekt.id, projekt.kurztext?.trim() ?? '')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errTimer'))
    }
  }

  async function handleQuickCreate(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!quick.name.trim() || !quick.kuerzel.trim()) {
      setError(t('projects.errName'))
      return
    }
    if (!quick.auftragsnummer.trim() || !quick.arbeitsplatz.trim()) {
      setError(t('projects.errSap'))
      return
    }
    try {
      await window.api.projekte.create({
        name: quick.name,
        kuerzel: quick.kuerzel,
        auftragsnummer: quick.auftragsnummer,
        arbeitsplatz: quick.arbeitsplatz,
        empfaengerArt: quick.empfaengerArt,
        empfaenger: quick.empfaenger || quick.auftragsnummer,
        leistungsart: quick.leistungsart,
        aktiv: true
      })
      setQuick({
        name: '',
        kuerzel: '',
        auftragsnummer: '',
        arbeitsplatz: '',
        empfaengerArt: 'Innenauftrag',
        empfaenger: '',
        leistungsart: ''
      })
      setShowQuickCreate(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errCreate'))
    }
  }

  async function handleManualSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (manual.projektId === '') {
      setError('Bitte einen Auftrag wählen.')
      return
    }
    const dauerMinuten =
      Number(manual.dauerStunden || 0) * 60 + Number(manual.dauerMinuten || 0)
    if (dauerMinuten <= 0) {
      setError('Bitte eine Dauer größer 0 angeben.')
      return
    }
    try {
      const heute = new Date()
      const datum = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`
      await window.api.buchungen.create({
        projektId: manual.projektId,
        datum,
        dauerMinuten,
        notiz: manual.notiz,
        quelle: 'manuell'
      })
      setManual((prev) => ({ ...prev, dauerStunden: '1', dauerMinuten: '0', notiz: '' }))
      setShowManual(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('stempel.errManual'))
    }
  }

  return (
    <div className="page stempel-page">
      <div className="page-header">
        <div>
          <h1>{t('stempel.title')}</h1>
          <p>{t('stempel.subtitle')}</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setShowManual((v) => !v)}>
            {t('stempel.manual')}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setShowQuickCreate((v) => !v)
            }}
          >
            {t('stempel.newOrder')}
          </button>
          {onNeuerAuftrag && (
            <button className="btn btn-ghost" type="button" onClick={onNeuerAuftrag}>
              {t('stempel.toAdmin')}
            </button>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!personalnummer.trim() && (
        <p className="error">
          {t('stempel.personalMissing')}
        </p>
      )}
      <p className="muted">{t('stempel.personalLabel')}: {personalnummer.trim() || '–'}</p>
      {sapMessage && <p className="success">{sapMessage}</p>}

      <section className={`card stempel-kopf${stempelLive?.imPause ? ' pause' : ''}`}>
        <div className="stempel-zeiten">
          <div>
            <span className="stempel-label">{t('stempel.timeLabel')}</span>
            <div className="stempel-display">
              {formatSekunden(stempelLive?.stempelSekunden ?? 0)}
            </div>
            <div className="muted">
              {t('stempel.timeWithBreaks')} {formatSekunden(stempelLive?.bruttoSekunden ?? 0)}
              {' · '}
              {t('stempel.pause')}{' '}
              {formatSekunden(
                Math.max(
                  0,
                  (stempelLive?.bruttoSekunden ?? 0) - (stempelLive?.stempelSekunden ?? 0)
                )
              )}
            </div>
            <div className="muted">
              {t('stempel.autoPauseHint')}
            </div>
          </div>
          <div className="stempel-meta">
            {stempelLive ? (
              <>
                <span
                  className={`badge ${
                    stempelLive.istOffen
                      ? stempelLive.imPause
                        ? 'running'
                        : 'active'
                      : 'inactive'
                  }`}
                >
                  {stempelLive.istOffen
                    ? stempelLive.imPause
                      ? t('stempel.pause')
                      : t('stempel.present')
                    : t('stempel.doneToday')}
                </span>
                <div className="stempel-uhrzeiten">
                  <span>
                    {t('stempel.comeAt')}:{' '}
                    <strong>
                      {new Date(stempelLive.kommenAm).toLocaleTimeString(localeTag, {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </strong>
                  </span>
                  <span>
                    {t('stempel.leaveAt')}:{' '}
                    <strong>
                      {stempelLive.gehenAm
                        ? new Date(stempelLive.gehenAm).toLocaleTimeString(localeTag, {
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : '–'}
                    </strong>
                  </span>
                  {stempelLive.istOffen && stempelLive.imPause && stempelLive.pauseSeit && (
                    <span className="muted">
                      {t('stempel.pauseSince')}{' '}
                      {new Date(stempelLive.pauseSeit).toLocaleTimeString(localeTag, {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <span className="muted">{t('stempel.notCheckedIn')}</span>
            )}
          </div>
        </div>
        <div className="actions stempel-actions">
          <button
            className="btn"
            type="button"
            disabled={!stempelLive?.istOffen || Boolean(stempelLive?.imPause && !aktiverAuftrag)}
            onClick={() => void handlePause()}
            title={
              aktiverAuftrag
                ? t('stempel.pauseTitleRunning')
                : t('stempel.pauseTitleIdle')
            }
          >
            {aktiverAuftrag ? t('stempel.pauseOrder') : t('stempel.pause')}
          </button>
          <button
            className="btn btn-success"
            type="button"
            disabled={Boolean(stempelLive?.istOffen)}
            onClick={() => void handleKommen()}
          >
            {t('stempel.checkIn')}
          </button>
          <button
            className="btn btn-danger"
            type="button"
            disabled={!stempelLive?.istOffen}
            onClick={() => void handleGehen()}
          >
            {t('stempel.checkOut')}
          </button>
        </div>
      </section>

      {showQuickCreate && (
        <section className="card">
          <h2>{t('stempel.newOrderTitle')}</h2>
          <form className="form-grid" onSubmit={(e) => void handleQuickCreate(e)}>
            <div className="field">
              <label htmlFor="q-name">{t('stempel.name')}</label>
              <input
                id="q-name"
                value={quick.name}
                onChange={(e) => setQuick((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="q-kuerzel">{t('stempel.code')}</label>
              <input
                id="q-kuerzel"
                value={quick.kuerzel}
                onChange={(e) => setQuick((p) => ({ ...p, kuerzel: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="q-auftrag">{t('stempel.orderNo')}</label>
              <input
                id="q-auftrag"
                value={quick.auftragsnummer}
                onChange={(e) => setQuick((p) => ({ ...p, auftragsnummer: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="q-ap">{t('stempel.workplace')}</label>
              <input
                id="q-ap"
                value={quick.arbeitsplatz}
                onChange={(e) => setQuick((p) => ({ ...p, arbeitsplatz: e.target.value }))}
                placeholder={t('stempel.workplacePh')}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="q-art">{t('stempel.receiverType')}</label>
              <select
                id="q-art"
                value={quick.empfaengerArt}
                onChange={(e) =>
                  setQuick((p) => ({ ...p, empfaengerArt: e.target.value as EmpfaengerArt }))
                }
              >
                <option value="Kostenstelle">{t('stempel.costCenter')}</option>
                <option value="Innenauftrag">{t('stempel.internalOrder')}</option>
                <option value="PSP-Element">{t('stempel.psp')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-leist">{t('stempel.activityType')}</label>
              <input
                id="q-leist"
                value={quick.leistungsart}
                onChange={(e) => setQuick((p) => ({ ...p, leistungsart: e.target.value }))}
              />
            </div>
            <div className="actions" style={{ gridColumn: '1 / -1' }}>
              <button className="btn btn-primary" type="submit">
                {t('stempel.create')}
              </button>
              <button className="btn" type="button" onClick={() => setShowQuickCreate(false)}>
                {t('stempel.cancel')}
              </button>
            </div>
          </form>
        </section>
      )}

      {showManual && (
        <section className="card">
          <h2>{t('stempel.manualTitle')}</h2>
          <form className="form-grid" onSubmit={(e) => void handleManualSubmit(e)}>
            <div className="field full">
              <label htmlFor="m-proj">{t('stempel.order')}</label>
              <select
                id="m-proj"
                value={manual.projektId}
                onChange={(e) =>
                  setManual((p) => ({
                    ...p,
                    projektId: e.target.value ? Number(e.target.value) : ''
                  }))
                }
              >
                {projekte.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.kuerzel} – {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="m-h">{t('stempel.hours')}</label>
              <input
                id="m-h"
                type="number"
                min="0"
                value={manual.dauerStunden}
                onChange={(e) => setManual((p) => ({ ...p, dauerStunden: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="m-m">{t('stempel.minutes')}</label>
              <input
                id="m-m"
                type="number"
                min="0"
                max="59"
                value={manual.dauerMinuten}
                onChange={(e) => setManual((p) => ({ ...p, dauerMinuten: e.target.value }))}
              />
            </div>
            <div className="field full">
              <label htmlFor="m-notiz">{t('stempel.shortText')}</label>
              <input
                id="m-notiz"
                value={manual.notiz}
                onChange={(e) => setManual((p) => ({ ...p, notiz: e.target.value }))}
              />
            </div>
            <div className="actions" style={{ gridColumn: '1 / -1' }}>
              <button className="btn btn-primary" type="submit">
                {t('stempel.save')}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card auftrag-liste-card">
        <h2>{t('stempel.orders')}</h2>
        {projekte.length === 0 ? (
          <div className="empty">
            {t('stempel.noOrders')}
          </div>
        ) : (
          <ul className="auftrag-liste">
            {projekte.map((p) => (
              <li key={p.id}>
                <div className={`auftrag-zeile${p.timerLaeuft ? ' aktiv' : ''}`}>
                  <button
                    type="button"
                    className="auftrag-start"
                    onClick={() => void handleAuftragClick(p)}
                    disabled={!stempelLive?.istOffen}
                    title={
                      !stempelLive?.istOffen
                        ? t('stempel.needCheckIn')
                        : p.timerLaeuft
                          ? t('stempel.stopOrder')
                          : stempelLive.imPause
                            ? t('stempel.startOrderPause')
                            : t('stempel.startOrder')
                    }
                  >
                    <span className="auftrag-zeit">
                      <span className="auftrag-zeit-line">
                        <span className="auftrag-zeit-label">{t('stempel.totalTime')}</span>
                        <span className="auftrag-zeit-value">{formatDauer(p.gesamtMinuten)}</span>
                      </span>
                      <span className="auftrag-zeit-line">
                        <span className="auftrag-zeit-label">{t('stempel.todayTime')}</span>
                        <span className="auftrag-zeit-value">{formatDauer(p.heuteMinuten)}</span>
                      </span>
                    </span>
                    <span className="auftrag-info">
                      <strong>
                        {p.auftragsnummer ? `${p.auftragsnummer} · ` : ''}
                        {p.kuerzel} – {p.name}
                      </strong>
                      <span className="muted">
                        {t('stempel.workplaceLabel')}: {p.arbeitsplatz || '–'}
                        {!p.auftragsnummer ? ` · ${t('stempel.orderNoMissing')}` : ''}
                      </span>
                    </span>
                    {p.timerLaeuft && <span className="badge running">{t('stempel.running')}</span>}
                  </button>
                  <label className="auftrag-kurztext">
                    <span>{t('stempel.shortTextOpt')}</span>
                    <input
                      value={p.kurztext ?? ''}
                      placeholder={t('stempel.shortTextPh')}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const value = e.target.value
                        setProjekte((prev) =>
                          prev.map((item) =>
                            item.id === p.id ? { ...item, kurztext: value } : item
                          )
                        )
                      }}
                      onBlur={(e) => {
                        void window.api.projekte
                          .updateKurztext(p.id, e.target.value)
                          .catch((err: Error) => setError(err.message))
                      }}
                    />
                  </label>
                  {(p.heuteMinuten > 0 || p.heuteAbgeschlossenMinuten > 0) && (
                    <div className={`auftrag-sap sap-${p.heuteSapStatus}`}>
                      <div className="auftrag-sap-meta">
                        <span className="auftrag-sap-time">
                          <span className="auftrag-sap-label">{t('stempel.sapOrderToday')}</span>
                          <strong>{formatDauer(p.heuteMinuten)}</strong>
                        </span>
                        {p.heuteAbgeschlossenMinuten > 0 && (
                          <span className={`badge sap-${p.heuteSapStatus}`}>
                            {sapOrderStatusLabel(p.heuteSapStatus)}
                          </span>
                        )}
                        {p.heuteSapUeberfuehrtAm && (
                          <span className="muted">
                            {t('stempel.sapAt', {
                              when: formatDateTimeLocal(p.heuteSapUeberfuehrtAm, localeTag)
                            })}
                          </span>
                        )}
                        {p.timerLaeuft && p.heuteSapStatus === 'leer' && (
                          <span className="muted">{t('stempel.sapOrderRunningHint')}</span>
                        )}
                      </div>
                      <div className="auftrag-sap-actions">
                        <button
                          className="btn btn-success btn-small"
                          type="button"
                          disabled={
                            p.heuteSapStatus === 'ueberfuehrt' ||
                            p.heuteSapStatus === 'leer' ||
                            p.heuteAbgeschlossenMinuten <= 0
                          }
                          onClick={() => void handleSapMarkAuftrag(p.id)}
                        >
                          {t('stempel.sapOrderMark')}
                        </button>
                        <button
                          className="btn btn-ghost btn-small"
                          type="button"
                          disabled={
                            p.heuteSapStatus === 'leer' || p.heuteSapStatus === 'offen'
                          }
                          onClick={() => void handleSapClearAuftrag(p.id)}
                        >
                          {t('stempel.sapOrderClear')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className={`stempel-status${aktiverAuftrag ? ' aktiv' : ''}`}>
        {aktiverAuftrag
          ? t('stempel.statusActive', {
              name: `${aktiverAuftrag.auftragsnummer ? `${aktiverAuftrag.auftragsnummer} · ` : ''}${aktiverAuftrag.kuerzel} – ${aktiverAuftrag.name}`
            })
          : stempelLive?.istOffen
            ? stempelLive.imPause
              ? t('stempel.statusPause')
              : t('stempel.statusPresent')
            : t('stempel.statusOut')}
      </footer>
    </div>
  )
}
