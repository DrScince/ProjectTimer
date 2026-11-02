import { useEffect, useMemo, useState } from 'react'
import type { IdlePrompt } from '../../shared/types'
import { useI18n } from './i18n'

type Row = {
  key: string
  projektId: number | null
  label: string
  minuten: number
}

type Props = {
  prompt: IdlePrompt
  onResolved: () => void
}

function formatRange(vonIso: string, bisIso: string, localeTag: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
  const von = new Date(vonIso).toLocaleTimeString(localeTag, opts)
  const bis = new Date(bisIso).toLocaleTimeString(localeTag, opts)
  return `${von} – ${bis}`
}

/** Reduziert Auftragszeilen von hinten, bis `needed` Minuten frei sind. */
function shrinkProjects(rows: Row[], needed: number): Row[] {
  let remaining = needed
  const next = rows.map((r) => ({ ...r }))
  for (let i = next.length - 1; i >= 0 && remaining > 0; i -= 1) {
    if (next[i].projektId == null) continue
    const take = Math.min(next[i].minuten, remaining)
    next[i].minuten -= take
    remaining -= take
  }
  return next
}

export default function IdlePromptModal({ prompt, onResolved }: Props) {
  const { t, localeTag } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [fortsetzenId, setFortsetzenId] = useState<number | ''>('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRows((prev) => {
      let projectRows = prompt.projekte.map((p) => {
        const existing = prev.find((r) => r.projektId === p.id)
        return {
          key: `p-${p.id}`,
          projektId: p.id as number | null,
          label: `${p.auftragsnummer ? `${p.auftragsnummer} · ` : ''}${p.kuerzel} – ${p.name}`,
          minuten: existing?.minuten ?? 0
        }
      })
      const projectSum = projectRows.reduce((acc, r) => acc + r.minuten, 0)
      if (projectSum > prompt.dauerMinuten) {
        projectRows = shrinkProjects(
          [
            { key: 'pause', projektId: null, label: t('idle.pause'), minuten: 0 },
            ...projectRows
          ],
          projectSum - prompt.dauerMinuten
        ).filter((r) => r.projektId != null)
      }
      const fittedSum = projectRows.reduce((acc, r) => acc + r.minuten, 0)
      // Zusätzliche Abwesenheitszeit landet in Pause, Auftragsanteile bleiben
      return [
        {
          key: 'pause',
          projektId: null,
          label: t('idle.pause'),
          minuten: Math.max(0, prompt.dauerMinuten - fittedSum)
        },
        ...projectRows
      ]
    })
    setFortsetzenId((prev) => (prev === '' ? (prompt.previousProjektId ?? '') : prev))
    setError('')
  }, [prompt, t])

  const summe = useMemo(() => rows.reduce((acc, r) => acc + (Number(r.minuten) || 0), 0), [rows])
  const valid = summe === prompt.dauerMinuten

  function setMinuten(key: string, value: number) {
    const raw = Math.max(0, Math.floor(value || 0))
    const total = prompt.dauerMinuten

    setRows((prev) => {
      const target = prev.find((r) => r.key === key)
      if (!target) return prev

      // Auftrag geändert → Auftrag setzen, Pause = Rest
      if (target.projektId != null) {
        const othersProjects = prev
          .filter((r) => r.projektId != null && r.key !== key)
          .reduce((acc, r) => acc + r.minuten, 0)
        const maxForTarget = Math.max(0, total - othersProjects)
        const clamped = Math.min(raw, maxForTarget)
        return prev.map((r) => {
          if (r.key === key) return { ...r, minuten: clamped }
          if (r.projektId == null) {
            const projectsSum =
              prev
                .filter((p) => p.projektId != null)
                .reduce((acc, p) => acc + (p.key === key ? clamped : p.minuten), 0)
            return { ...r, minuten: Math.max(0, total - projectsSum) }
          }
          return r
        })
      }

      // Pause geändert → Pause setzen, Aufträge von hinten kürzen falls nötig
      const pauseValue = Math.min(raw, total)
      let next = prev.map((r) =>
        r.projektId == null ? { ...r, minuten: pauseValue } : { ...r }
      )
      const projectsSum = next
        .filter((r) => r.projektId != null)
        .reduce((acc, r) => acc + r.minuten, 0)
      const overflow = pauseValue + projectsSum - total
      if (overflow > 0) {
        next = shrinkProjects(next, overflow)
      } else if (overflow < 0) {
        const projectsAfter = next
          .filter((r) => r.projektId != null)
          .reduce((acc, r) => acc + r.minuten, 0)
        next = next.map((r) =>
          r.projektId == null ? { ...r, minuten: total - projectsAfter } : r
        )
      }
      return next
    })
  }

  function adjustMinuten(key: string, delta: number) {
    const row = rows.find((r) => r.key === key)
    if (!row) return
    setMinuten(key, row.minuten + delta)
  }

  function fillAllPause() {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        minuten: r.projektId == null ? prompt.dauerMinuten : 0
      }))
    )
  }

  function fillAllProjekt(projektId: number) {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        minuten: r.projektId === projektId ? prompt.dauerMinuten : 0
      }))
    )
    setFortsetzenId(projektId)
  }

  async function handleSubmit() {
    if (!valid) {
      setError(t('idle.errSum', { total: prompt.dauerMinuten }))
      return
    }
    setSaving(true)
    setError('')
    try {
      await window.api.idle.resolve({
        promptId: prompt.id,
        allocations: rows
          .filter((r) => r.minuten > 0)
          .map((r) => ({ projektId: r.projektId, minuten: r.minuten })),
        fortsetzenProjektId: fortsetzenId === '' ? null : fortsetzenId
      })
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('idle.errSave'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="idle-title">
        <h2 id="idle-title">
          {prompt.reason === 'lock' ? t('idle.titleLock') : t('idle.titleIdle')}
        </h2>
        <p className="muted">
          {formatRange(prompt.von, prompt.bis, localeTag)} · {prompt.dauerMinuten} {t('idle.min')}
        </p>

        <div className="idle-quick">
          <button type="button" className="btn" onClick={fillAllPause}>
            {t('idle.onlyPause')}
          </button>
          {prompt.previousProjektId != null && (
            <button
              type="button"
              className="btn"
              onClick={() => fillAllProjekt(prompt.previousProjektId as number)}
            >
              {t('idle.onlyPrev')}
            </button>
          )}
        </div>

        <div className="idle-rows">
          {rows.map((row) => {
            const othersProjects = rows
              .filter((r) => r.projektId != null && r.key !== row.key)
              .reduce((acc, r) => acc + r.minuten, 0)
            const maxForRow =
              row.projektId == null
                ? prompt.dauerMinuten
                : Math.max(0, prompt.dauerMinuten - othersProjects)
            const canMinus = row.minuten > 0
            const canPlus = row.minuten < maxForRow
            return (
              <div key={row.key} className="idle-row">
                <span className="idle-row-label">{row.label}</span>
                <div className="idle-stepper" role="group" aria-label={row.label}>
                  <button
                    type="button"
                    className="idle-step-btn minus"
                    disabled={!canMinus}
                    aria-label="−"
                    title={!canMinus ? t('idle.minReached') : undefined}
                    onClick={() => adjustMinuten(row.key, -1)}
                  >
                    −
                  </button>
                  <span className="idle-step-value">{row.minuten}</span>
                  <button
                    type="button"
                    className="idle-step-btn plus"
                    disabled={!canPlus}
                    aria-label="+"
                    title={!canPlus ? t('idle.maxReached') : undefined}
                    onClick={() => adjustMinuten(row.key, 1)}
                  >
                    +
                  </button>
                </div>
                <span className="muted idle-row-unit">{t('idle.min')}</span>
              </div>
            )
          })}
        </div>

        <div className={`idle-sum${valid ? ' ok' : ' bad'}`}>
          {t('idle.sum', { sum: summe, total: prompt.dauerMinuten })}
        </div>

        <div className="field">
          <label htmlFor="idle-resume">{t('idle.resume')}</label>
          <select
            id="idle-resume"
            value={fortsetzenId}
            onChange={(e) =>
              setFortsetzenId(e.target.value === '' ? '' : Number(e.target.value))
            }
          >
            <option value="">{t('idle.resumePause')}</option>
            {prompt.projekte.map((p) => (
              <option key={p.id} value={p.id}>
                {p.auftragsnummer ? `${p.auftragsnummer} · ` : ''}
                {p.kuerzel} – {p.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid || saving}
            onClick={() => void handleSubmit()}
          >
            {saving ? t('idle.saving') : t('idle.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}
