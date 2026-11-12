import { Paginated, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, session, uploadFile } from '../lib/api';
import { formatDateTime, humanize, KIND_LABEL, RESULT_TONE } from '../lib/format';
import type { ChecklistItem, Inspection, InspectionTemplate, Vehicle } from '../lib/types';
import { errorText } from './IncidentsPage';

const KINDS = ['PRE_TRIP', 'POST_TRIP', 'PERIODIC'] as const;
const CLASSES = ['TRUCK', 'VAN', 'CAR', 'PICKUP', 'BUS', 'MOTORCYCLE', 'TRAILER', 'OTHER'];
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'item';

export function InspectionsPage() {
  const [tab, setTab] = useState<'inspections' | 'checklists'>('inspections');
  const [recording, setRecording] = useState(false);
  const canWrite = session.can(Permission.INSPECTION_WRITE);
  return (
    <>
      <header className="page-head">
        <h1>Inspections</h1>
        <div className="actions">
          <button
            className={`btn ${tab === 'inspections' ? 'btn-primary' : ''}`}
            onClick={() => setTab('inspections')}
          >
            Inspections
          </button>
          <button
            className={`btn ${tab === 'checklists' ? 'btn-primary' : ''}`}
            onClick={() => setTab('checklists')}
          >
            Checklists
          </button>
          {canWrite && tab === 'inspections' && (
            <button className="btn" onClick={() => setRecording((v) => !v)}>
              {recording ? 'Cancel' : 'Record inspection'}
            </button>
          )}
        </div>
      </header>
      {tab === 'inspections' ? (
        <>
          {recording && <RecordInspection onDone={() => setRecording(false)} />}
          <InspectionList />
        </>
      ) : (
        <Checklists canWrite={canWrite} />
      )}
    </>
  );
}

function InspectionList() {
  const [result, setResult] = useState('');
  const [kind, setKind] = useState('');
  const { data } = useQuery({
    queryKey: ['inspections', result, kind],
    queryFn: () =>
      api<Paginated<Inspection>>(
        `/inspections?pageSize=100${result ? `&result=${result}` : ''}${kind ? `&kind=${kind}` : ''}`,
      ),
  });
  return (
    <section className="card table-card">
      <div className="card-head">
        <h2>Recent inspections</h2>
        <div className="actions">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <select value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result">
            <option value="">All results</option>
            {['PASS', 'DEFECTS', 'FAIL'].map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>No.</th>
            <th>When</th>
            <th>Type</th>
            <th>Vehicle</th>
            <th>Driver</th>
            <th>Checklist</th>
            <th>Result</th>
            <th className="num">Defects</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                No inspections yet.
              </td>
            </tr>
          )}
          {data?.items.map((i) => (
            <tr key={i.id}>
              <td>
                <Link to={`/inspections/${i.id}`}>{i.inspectionNo}</Link>
              </td>
              <td>{formatDateTime(i.performedAt)}</td>
              <td>{KIND_LABEL[i.kind]}</td>
              <td>
                <Link to={`/vehicles/${i.vehicle.id}`}>{i.vehicle.plateNumber}</Link>
              </td>
              <td>
                {i.driver ? <Link to={`/drivers/${i.driver.id}`}>{i.driver.fullName}</Link> : '—'}
              </td>
              <td>{i.template.name}</td>
              <td>
                <span className={`badge badge-${RESULT_TONE[i.result]}`}>{humanize(i.result)}</span>
              </td>
              <td className="num">
                {i.defects}
                {i.criticalDefects > 0 && (
                  <span className="text-danger"> ({i.criticalDefects} critical)</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RecordInspection({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [vehicleId, setVehicleId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [answers, setAnswers] = useState<
    Record<string, { ok: boolean; note: string; file: File | null }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const vehicles = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200'),
  });
  const templates = useQuery({
    queryKey: ['inspection-templates'],
    queryFn: () => api<InspectionTemplate[]>('/inspection-templates'),
  });
  const vehicle = vehicles.data?.items.find((v) => v.id === vehicleId);
  const usable = (templates.data ?? []).filter(
    (t) =>
      t.active &&
      (!vehicle || !t.vehicleClasses.length || t.vehicleClasses.includes(vehicle.vehicleClass)),
  );
  const template = usable.find((t) => t.id === templateId);
  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const list = [];
      for (const item of template!.items) {
        const a = answers[item.key] ?? { ok: true, note: '', file: null };
        const photoFileId = !a.ok && a.file ? (await uploadFile(a.file)).id : null;
        list.push({ key: item.key, ok: a.ok, note: a.note || null, photoFileId });
      }
      return api<Inspection>('/inspections', {
        method: 'POST',
        body: JSON.stringify({ ...body, answers: list }),
      });
    },
    onSuccess: (i) => {
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      onDone();
      nav(`/inspections/${i.id}`);
    },
    onError: (e) => setError(errorText(e)),
  });
  const set = (key: string, patch: Partial<{ ok: boolean; note: string; file: File | null }>) =>
    setAnswers((a) => ({
      ...a,
      [key]: { ...(a[key] ?? { ok: true, note: '', file: null }), ...patch },
    }));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      vehicleId,
      templateId,
      odometerKm: f.get('odometerKm') ? Number(f.get('odometerKm')) : null,
      notes: (f.get('notes') as string) || null,
    });
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Vehicle
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
            <option value="">Choose…</option>
            {vehicles.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plateNumber} · {humanize(v.vehicleClass)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Checklist
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
            <option value="">Choose…</option>
            {usable.map((t) => (
              <option key={t.id} value={t.id}>
                {KIND_LABEL[t.kind]} · {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Odometer (km)
          <input name="odometerKm" type="number" min={0} step="0.1" />
        </label>
      </div>
      {template && (
        <ul className="checklist">
          {template.items.map((item) => {
            const a = answers[item.key] ?? { ok: true, note: '', file: null };
            return (
              <li key={item.key} className={a.ok ? '' : 'defect'}>
                <span>
                  {item.label}{' '}
                  {item.critical && <span className="badge badge-danger">critical</span>}
                </span>
                <span className="actions">
                  <button
                    type="button"
                    className={`btn ${a.ok ? 'btn-primary' : ''}`}
                    onClick={() => set(item.key, { ok: true })}
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    className={`btn ${!a.ok ? 'btn-danger' : ''}`}
                    onClick={() => set(item.key, { ok: false })}
                  >
                    Defect
                  </button>
                </span>
                {!a.ok && (
                  <span className="defect-detail">
                    <input
                      placeholder="What is wrong?"
                      value={a.note}
                      onChange={(e) => set(item.key, { note: e.target.value })}
                      aria-label={`${item.label} defect`}
                    />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => set(item.key, { file: e.target.files?.[0] ?? null })}
                      aria-label={`${item.label} photo`}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <label>
        Notes
        <textarea name="notes" rows={2} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="btn btn-primary" disabled={!template || save.isPending}>
          Save inspection
        </button>
      </div>
    </form>
  );
}

function Checklists({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['inspection-templates'],
    queryFn: () => api<InspectionTemplate[]>('/inspection-templates'),
  });
  const [editing, setEditing] = useState<InspectionTemplate | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: (t: InspectionTemplate) =>
      api(`/inspection-templates/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !t.active }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inspection-templates'] }),
  });
  return (
    <>
      {canWrite && !editing && (
        <div className="actions">
          <button className="btn" onClick={() => setEditing('new')}>
            New checklist
          </button>
        </div>
      )}
      {editing && (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
      <div className="grid-2">
        {data?.map((t) => (
          <section key={t.id} className={`card ${t.active ? '' : 'inactive'}`}>
            <div className="card-head">
              <h2>
                {t.name} <span className="badge badge-info">{KIND_LABEL[t.kind]}</span>{' '}
                {!t.active && <span className="badge badge-muted">inactive</span>}
              </h2>
              {canWrite && (
                <span className="actions">
                  <button className="link" onClick={() => setEditing(t)}>
                    Edit
                  </button>
                  <button className="link" onClick={() => toggle.mutate(t)}>
                    {t.active ? 'Deactivate' : 'Activate'}
                  </button>
                </span>
              )}
            </div>
            <p className="muted">
              {t.vehicleClasses.length
                ? t.vehicleClasses.map(humanize).join(', ')
                : 'All vehicle classes'}
            </p>
            <ol>
              {t.items.map((i) => (
                <li key={i.key}>
                  {i.label} {i.critical && <span className="badge badge-danger">critical</span>}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}

function TemplateEditor({
  template,
  onDone,
}: {
  template: InspectionTemplate | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [kind, setKind] = useState<string>(template?.kind ?? 'PRE_TRIP');
  const [classes, setClasses] = useState<string[]>(template?.vehicleClasses ?? []);
  const [items, setItems] = useState<ChecklistItem[]>(
    template?.items ?? [{ key: '', label: '', critical: false }],
  );
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(template ? `/inspection-templates/${template.id}` : '/inspection-templates', {
        method: template ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inspection-templates'] });
      onDone();
    },
    onError: (e) => setError(errorText(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = items
      .filter((i) => i.label.trim())
      .map((i) => ({ ...i, key: i.key || slug(i.label) }));
    save.mutate({ name, kind, vehicleClasses: classes, items: clean });
  }
  const setItem = (n: number, patch: Partial<ChecklistItem>) =>
    setItems((list) => list.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  return (
    <form className="card" onSubmit={submit}>
      <h2>{template ? `Edit ${template.name}` : 'New checklist'}</h2>
      <div className="form-grid">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="span-all chips">
          <legend>Vehicle classes (none = all)</legend>
          {CLASSES.map((c) => (
            <label key={c} className="check">
              <input
                type="checkbox"
                checked={classes.includes(c)}
                onChange={(e) =>
                  setClasses((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))
                }
              />{' '}
              {humanize(c)}
            </label>
          ))}
        </fieldset>
      </div>
      <ul className="checklist">
        {items.map((it, n) => (
          <li key={n}>
            <input
              value={it.label}
              onChange={(e) => setItem(n, { label: e.target.value })}
              placeholder="Check item"
              aria-label={`Item ${n + 1}`}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={it.critical}
                onChange={(e) => setItem(n, { critical: e.target.checked })}
              />{' '}
              critical
            </label>
            <button
              type="button"
              className="link danger"
              onClick={() => setItems((l) => l.filter((_, i) => i !== n))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">
        A failed critical item fails the inspection; with “require pre-trip inspection” on, the
        vehicle cannot start a trip until it passes.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => setItems((l) => [...l, { key: '', label: '', critical: false }])}
        >
          Add item
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={save.isPending}>
          Save checklist
        </button>
      </div>
    </form>
  );
}
