import { FormEvent, useCallback, useEffect, useState } from 'react'
import type { EmpfaengerArt, Projekt, ProjektInput } from '../../../shared/types'
import { useI18n } from '../i18n'

const EMPTY: ProjektInput = {
  name: '',
  kuerzel: '',
  auftragsnummer: '',
  arbeitsplatz: '',
  kurztext: '',
  empfaengerArt: 'Innenauftrag',
  empfaenger: '',
  leistungsart: '',
  verbuchungsProzent: 100,
  aktiv: true
}

export default function ProjectsPage() {
  const { t } = useI18n()
  const [projekte, setProjekte] = useState<Projekt[]>([])
  const [form, setForm] = useState<ProjektInput>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const list = await window.api.projekte.list(false)
    setProjekte(list)
  }, [])

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message))
  }, [load])

  function resetForm() {
    setForm(EMPTY)
    setEditId(null)
  }

  function startEdit(projekt: Projekt) {
    setEditId(projekt.id)
    setForm({
      name: projekt.name,
      kuerzel: projekt.kuerzel,
      auftragsnummer: projekt.auftragsnummer,
      arbeitsplatz: projekt.arbeitsplatz,
      kurztext: '',
      empfaengerArt: projekt.empfaengerArt,
      empfaenger: projekt.empfaenger,
      leistungsart: projekt.leistungsart,
      verbuchungsProzent: projekt.verbuchungsProzent ?? 100,
      aktiv: projekt.aktiv
    })
  }

  async function handleMove(id: number, direction: 'up' | 'down'): Promise<void> {
    setError('')
    try {
      const list = await window.api.projekte.move(id, direction)
      setProjekte(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.errSave'))
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (!form.name.trim() || !form.kuerzel.trim()) {
      setError(t('projects.errName'))
      return
    }
    if (!form.auftragsnummer.trim() || !form.arbeitsplatz.trim()) {
      setError(t('projects.errSap'))
      return
    }

    try {
      if (editId == null) {
        await window.api.projekte.create(form)
        setMessage(t('projects.msgCreated'))
      } else {
        await window.api.projekte.update(editId, form)
        setMessage(t('projects.msgUpdated'))
      }
      resetForm()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.errSave'))
    }
  }

  async function toggleAktiv(projekt: Projekt) {
    await window.api.projekte.setAktiv(projekt.id, !projekt.aktiv)
    await load()
  }

  async function handleDelete(projekt: Projekt) {
    setError('')
    setMessage('')
    if (
      !confirm(t('projects.confirmDelete', { name: `${projekt.kuerzel} – ${projekt.name}` }))
    ) {
      return
    }
    try {
      await window.api.projekte.delete(projekt.id)
      if (editId === projekt.id) {
        resetForm()
      }
      setMessage(t('projects.msgDeleted'))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.errDelete'))
    }
  }

  async function handleExport() {
    setError('')
    setMessage('')
    try {
      const result = await window.api.projekte.exportJson()
      if (!result.canceled) {
        setMessage(t('projects.msgExported', { count: result.count ?? 0 }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.errExport'))
    }
  }

  async function handleImport() {
    setError('')
    setMessage('')
    try {
      const result = await window.api.projekte.importJson()
      if (!result.canceled) {
        setMessage(
          t('projects.msgImported', {
            created: result.created ?? 0,
            updated: result.updated ?? 0
          })
        )
        await load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.errImport'))
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('projects.title')}</h1>
          <p>{t('projects.subtitle')}</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => void handleImport()}>
            {t('projects.importJson')}
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void handleExport()}>
            {t('projects.exportJson')}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <section className="card">
        <h2>{editId == null ? t('projects.new') : t('projects.edit')}</h2>
        <form className="form-grid" onSubmit={(e) => void handleSubmit(e)}>
          <div className="field">
            <label htmlFor="proj-name">{t('projects.name')}</label>
            <input
              id="proj-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t('projects.namePh')}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="proj-kuerzel">{t('projects.code')}</label>
            <input
              id="proj-kuerzel"
              value={form.kuerzel}
              onChange={(e) => setForm((prev) => ({ ...prev, kuerzel: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="proj-auftrag">{t('projects.orderNo')}</label>
            <input
              id="proj-auftrag"
              value={form.auftragsnummer}
              onChange={(e) => setForm((prev) => ({ ...prev, auftragsnummer: e.target.value }))}
              placeholder={t('projects.orderNoPh')}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="proj-ap">{t('projects.workplace')}</label>
            <input
              id="proj-ap"
              value={form.arbeitsplatz}
              onChange={(e) => setForm((prev) => ({ ...prev, arbeitsplatz: e.target.value }))}
              placeholder={t('projects.workplacePh')}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="proj-leistungsart">{t('projects.activityType')}</label>
            <input
              id="proj-leistungsart"
              value={form.leistungsart}
              onChange={(e) => setForm((prev) => ({ ...prev, leistungsart: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="proj-verbuchung">{t('projects.bookingPercent')}</label>
            <input
              id="proj-verbuchung"
              type="number"
              min={1}
              max={200}
              step={1}
              value={form.verbuchungsProzent ?? 100}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  verbuchungsProzent: Number(e.target.value)
                }))
              }
            />
            <p className="muted field-hint">{t('projects.bookingPercentHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="proj-aktiv">{t('projects.status')}</label>
            <select
              id="proj-aktiv"
              value={form.aktiv === false ? '0' : '1'}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, aktiv: e.target.value === '1' }))
              }
            >
              <option value="1">{t('projects.active')}</option>
              <option value="0">{t('projects.inactive')}</option>
            </select>
          </div>
          <div className="actions">
            <button className="btn btn-primary" type="submit">
              {editId == null ? t('projects.create') : t('projects.save')}
            </button>
            {editId != null && (
              <button className="btn" type="button" onClick={resetForm}>
                {t('projects.cancel')}
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>{t('projects.list')}</h2>
        {projekte.length === 0 ? (
          <div className="empty">{t('projects.empty')}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('projects.colOrderPos')}</th>
                  <th>{t('projects.colCode')}</th>
                  <th>{t('projects.colName')}</th>
                  <th>{t('projects.colOrder')}</th>
                  <th>{t('projects.colWorkplace')}</th>
                  <th>{t('projects.colBookingPercent')}</th>
                  <th>{t('projects.colStatus')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {projekte.map((p, index) => (
                  <tr key={p.id}>
                    <td>
                      <div className="actions reorder-actions">
                        <button
                          className="btn btn-ghost btn-small"
                          type="button"
                          disabled={index === 0}
                          title={t('projects.moveUp')}
                          aria-label={t('projects.moveUp')}
                          onClick={() => void handleMove(p.id, 'up')}
                        >
                          ↑
                        </button>
                        <button
                          className="btn btn-ghost btn-small"
                          type="button"
                          disabled={index === projekte.length - 1}
                          title={t('projects.moveDown')}
                          aria-label={t('projects.moveDown')}
                          onClick={() => void handleMove(p.id, 'down')}
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td>{p.kuerzel}</td>
                    <td>{p.name}</td>
                    <td>{p.auftragsnummer || '–'}</td>
                    <td>{p.arbeitsplatz || '–'}</td>
                    <td>{p.verbuchungsProzent ?? 100} %</td>
                    <td>
                      <span className={`badge ${p.aktiv ? 'active' : 'inactive'}`}>
                        {p.aktiv ? t('projects.active') : t('projects.inactive')}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        <button className="btn btn-ghost" type="button" onClick={() => startEdit(p)}>
                          {t('projects.editBtn')}
                        </button>
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={() => void toggleAktiv(p)}
                        >
                          {p.aktiv ? t('projects.deactivate') : t('projects.activate')}
                        </button>
                        <button
                          className="btn btn-danger"
                          type="button"
                          onClick={() => void handleDelete(p)}
                        >
                          {t('projects.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
