import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { formatDate, humanize, TRAINING_TONE } from '../lib/format';
import type { TrainingCourse, TrainingMatrix } from '../lib/types';
import { errorText } from './IncidentsPage';

export function TrainingPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.DRIVER_WRITE);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matrix = useQuery({
    queryKey: ['training', 'matrix'],
    queryFn: () => api<TrainingMatrix>('/training/matrix'),
  });
  const courses = useQuery({
    queryKey: ['training', 'courses'],
    queryFn: () => api<TrainingCourse[]>('/training/courses'),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['training'] });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/training/courses', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setShowForm(false);
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorText(e)),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/training/courses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e)),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      code: f.get('code'),
      name: f.get('name'),
      validityMonths: f.get('validityMonths') ? Number(f.get('validityMonths')) : null,
      mandatory: f.get('mandatory') === 'on',
      description: (f.get('description') as string) || null,
    });
  }

  const m = matrix.data;
  return (
    <>
      <header className="page-head">
        <h1>Training & certification</h1>
        {canWrite && (
          <button className="btn" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New course'}
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {showForm && (
        <form className="card form-grid" onSubmit={submit}>
          <label>
            Code
            <input name="code" required maxLength={32} placeholder="DDC" />
          </label>
          <label>
            Name
            <input name="name" required minLength={2} placeholder="Defensive driving" />
          </label>
          <label>
            Valid for (months)
            <input
              name="validityMonths"
              type="number"
              min={1}
              max={120}
              placeholder="blank = no expiry"
            />
          </label>
          <label className="check">
            <input name="mandatory" type="checkbox" /> Mandatory for all drivers
          </label>
          <label className="span-all">
            Description
            <textarea name="description" rows={2} />
          </label>
          <div>
            <button className="btn btn-primary" disabled={create.isPending}>
              Create course
            </button>
          </div>
        </form>
      )}

      <section className="tiles">
        <div className="card tile hero">
          <span className="tile-label">Compliant drivers</span>
          <span className="tile-value">
            {m ? `${m.summary.compliant} / ${m.summary.drivers}` : '…'}
          </span>
          <span className="muted">all mandatory courses valid</span>
        </div>
        {(['EXPIRING', 'EXPIRED', 'MISSING'] as const).map((k) => (
          <div className="card tile" key={k}>
            <span className="tile-label">{humanize(k)}</span>
            <span
              className={`tile-value small ${k !== 'EXPIRING' && m?.summary.mandatoryCells[k] ? 'text-danger' : ''}`}
            >
              {m ? m.summary.mandatoryCells[k] : '…'}
            </span>
            <span className="muted">mandatory certificates</span>
          </div>
        ))}
      </section>

      <section className="card table-card">
        <div className="card-head">
          <h2>Compliance matrix</h2>
        </div>
        <table className="matrix">
          <thead>
            <tr>
              <th>Driver</th>
              {m?.courses.map((c) => (
                <th key={c.id} title={c.name}>
                  {c.code}
                  {c.mandatory && <span className="muted"> *</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m?.courses.length === 0 && (
              <tr>
                <td className="muted">
                  No courses yet — create one to start tracking certificates.
                </td>
              </tr>
            )}
            {m?.courses.length !== 0 &&
              m?.drivers.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/drivers/${d.id}`}>{d.fullName}</Link>{' '}
                    <span className="muted">{d.employeeNo}</span>
                  </td>
                  {m.courses.map((c) => {
                    const cell = d.cells[c.id];
                    return (
                      <td key={c.id}>
                        {cell.status === 'MISSING' && !c.mandatory ? (
                          <span className="muted">—</span>
                        ) : (
                          <span
                            className={`badge badge-${TRAINING_TONE[cell.status]}`}
                            title={
                              cell.expiresAt ? `expires ${formatDate(cell.expiresAt)}` : undefined
                            }
                          >
                            {cell.status === 'VALID' && cell.expiresAt
                              ? formatDate(cell.expiresAt)
                              : humanize(cell.status)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
        <p className="muted small" style={{ padding: '0 16px 12px' }}>
          * mandatory. Record certificates on each driver’s page.
        </p>
      </section>

      <section className="card table-card">
        <div className="card-head">
          <h2>Courses</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Validity</th>
              <th>Mandatory</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {courses.data?.map((c) => (
              <tr key={c.id} className={c.active ? '' : 'inactive'}>
                <td>{c.code}</td>
                <td>{c.name}</td>
                <td>{c.validityMonths ? `${c.validityMonths} months` : 'no expiry'}</td>
                <td>{c.mandatory ? 'Yes' : 'No'}</td>
                <td>{c.active ? 'Active' : 'Inactive'}</td>
                <td>
                  <span className="actions">
                    {canWrite && (
                      <>
                        <button
                          className="link"
                          onClick={() =>
                            patch.mutate({ id: c.id, body: { mandatory: !c.mandatory } })
                          }
                        >
                          {c.mandatory ? 'Make optional' : 'Make mandatory'}
                        </button>
                        <button
                          className="link"
                          onClick={() => patch.mutate({ id: c.id, body: { active: !c.active } })}
                        >
                          {c.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
