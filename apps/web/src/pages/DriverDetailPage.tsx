import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileLink } from '../components/FileLink';
import { LicenceFields, licenceShort } from '../components/LicenceFields';
import { api, session, uploadFile } from '../lib/api';
import { daysUntil, expiryTone, formatDate } from '../lib/format';
import type { Driver } from '../lib/types';

export function DriverDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const canWrite = session.can(Permission.DRIVER_WRITE);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { data: d, isLoading } = useQuery({ queryKey: ['driver', id], queryFn: () => api<Driver>(`/drivers/${id}`) });

  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['driver', id] });
    void qc.invalidateQueries({ queryKey: ['drivers'] });
  };
  const onError = (e: Error) => setError(e.message);
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError,
  });
  const addLicense = useMutation({
    mutationFn: async (input: { body: Record<string, unknown>; file: File | null }) => {
      const fileId = input.file ? (await uploadFile(input.file)).id : null;
      return api(`/drivers/${id}/licenses`, { method: 'POST', body: JSON.stringify({ ...input.body, fileId }) });
    },
    onSuccess: refresh,
    onError,
  });
  const removeLicense = useMutation({
    mutationFn: (licenseId: string) => api(`/drivers/${id}/licenses/${licenseId}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError,
  });

  if (isLoading || !d) return <p className="muted">Loading…</p>;
  const current = d.assignments.find((a) => !a.endAt);

  function submitLicense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get('file') as File | null;
    addLicense.mutate(
      {
        body: {
          number: f.get('number'),
          licenseClass: f.get('licenseClass'),
          issuedAt: (f.get('issuedAt') as string) || null,
          expiresAt: (f.get('expiresAt') as string) || null,
        },
        file: file && file.size > 0 ? file : null,
      },
      { onSuccess: () => form.reset() },
    );
  }

  function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    update.mutate({ fullName: f.get('fullName'), phone: (f.get('phone') as string) || null });
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>
            {d.fullName} {!d.active && <span className="badge badge-muted">inactive</span>}
          </h1>
          <p className="muted">
            {d.employeeNo} · {d.phone ?? 'no phone'} · {d.user ? `app login: ${d.user.email}` : 'no app login'}
          </p>
        </div>
        {canWrite && (
          <div className="actions">
            <button className="btn" onClick={() => setEditing((x) => !x)}>
              {editing ? 'Cancel edit' : 'Edit'}
            </button>
            <button
              className="btn"
              onClick={() =>
                (d.active ? confirm('Deactivate this driver? Their vehicle will be released.') : true) &&
                update.mutate({ active: !d.active })
              }
            >
              {d.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {editing && (
        <form className="card inline-form" onSubmit={submitProfile}>
          <input name="fullName" defaultValue={d.fullName} required aria-label="Full name" />
          <input name="phone" defaultValue={d.phone ?? ''} placeholder="Phone" aria-label="Phone" />
          <button className="btn btn-primary">Save</button>
        </form>
      )}
      <section className="card">
        <h2>Driving licences</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Class</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Scan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.licenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No licence recorded — this driver cannot be dispatched.
                  </td>
                </tr>
              )}
              {d.licenses.map((l) => {
                const days = daysUntil(l.expiresAt);
                return (
                  <tr key={l.id}>
                    <td>{l.number}</td>
                    <td>{licenceShort(l.licenseClass)}</td>
                    <td>{formatDate(l.issuedAt)}</td>
                    <td>
                      {formatDate(l.expiresAt)}{' '}
                      {days !== null && (
                        <span className={`badge badge-${expiryTone(days)}`}>{days < 0 ? 'expired' : `${days}d`}</span>
                      )}
                    </td>
                    <td>
                      <FileLink file={l.file} />
                    </td>
                    <td className="num">
                      {canWrite && (
                        <button className="link danger" onClick={() => confirm('Delete licence?') && removeLicense.mutate(l.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canWrite && (
          <form className="inline-form" onSubmit={submitLicense}>
            <input name="number" placeholder="Licence number" required />
            <LicenceFields compact names={{ cls: 'licenseClass', issued: 'issuedAt', expires: 'expiresAt' }} />
            <label className="mini">
              Scan (PDF/photo)
              <input name="file" type="file" accept="application/pdf,image/*" />
            </label>
            <button className="btn btn-primary" disabled={addLicense.isPending}>
              Add licence
            </button>
          </form>
        )}
      </section>
      <section className="card">
        <h2>Vehicle assignments</h2>
        <p>
          Current vehicle:{' '}
          {current ? <Link to={`/vehicles/${current.vehicle.id}`}>{current.vehicle.plateNumber}</Link> : <span className="muted">none</span>}
        </p>
        <ul className="timeline">
          {d.assignments.map((a) => (
            <li key={a.id}>
              <span>{formatDate(a.startAt)}</span>
              <span>
                <Link to={`/vehicles/${a.vehicle.id}`}>{a.vehicle.plateNumber}</Link>{' '}
                <span className="muted">{a.endAt ? `until ${formatDate(a.endAt)}` : '(current)'}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
