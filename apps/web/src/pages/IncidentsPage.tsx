import { Paginated, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, session, uploadFile } from '../lib/api';
import {
  CLAIM_TONE,
  formatDate,
  formatDateTime,
  humanize,
  INCIDENT_TONE,
  money,
  SEVERITY_TONE,
  toLocalInput,
} from '../lib/format';
import type { Incident, InsuranceClaim, Vehicle } from '../lib/types';

export const INCIDENT_TYPES = [
  'COLLISION',
  'DAMAGE',
  'THEFT',
  'INJURY',
  'NEAR_MISS',
  'BREAKDOWN',
  'OTHER',
];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const errorText = (e: Error) =>
  e instanceof ApiError && e.body.errors
    ? e.body.errors.map((x) => `${x.path}: ${x.message}`).join('; ')
    : e.message;

export function IncidentsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tab, setTab] = useState<'incidents' | 'claims'>('incidents');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReport = session.can(Permission.INCIDENT_REPORT);

  const list = useQuery({
    queryKey: ['incidents', status],
    queryFn: () =>
      api<Paginated<Incident>>(`/incidents?pageSize=100${status ? `&status=${status}` : ''}`),
    enabled: tab === 'incidents',
  });
  const claims = useQuery({
    queryKey: ['claims'],
    queryFn: () => api<InsuranceClaim[]>('/claims'),
    enabled: tab === 'claims',
  });
  const vehicles = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200'),
    enabled: showForm,
  });

  const create = useMutation({
    mutationFn: async ({ body, files }: { body: Record<string, unknown>; files: File[] }) => {
      const photoFileIds = [];
      for (const f of files) photoFileIds.push((await uploadFile(f)).id);
      return api<Incident>('/incidents', {
        method: 'POST',
        body: JSON.stringify({ ...body, photoFileIds }),
      });
    },
    onSuccess: (inc) => {
      void qc.invalidateQueries({ queryKey: ['incidents'] });
      nav(`/incidents/${inc.id}`);
    },
    onError: (e) => setError(errorText(e)),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    create.mutate({
      body: {
        vehicleId: f.get('vehicleId') || null,
        type: f.get('type'),
        severity: f.get('severity'),
        occurredAt: new Date(f.get('occurredAt') as string).toISOString(),
        location: f.get('location') || null,
        description: f.get('description'),
        injuries: f.get('injuries') === 'on',
        thirdParty: f.get('thirdParty') || null,
        policeReportNo: f.get('policeReportNo') || null,
        estimatedCost: num('estimatedCost'),
      },
      files: (f.getAll('photos') as File[]).filter((x) => x.size),
    });
  }

  return (
    <>
      <header className="page-head">
        <h1>Incidents & claims</h1>
        <div className="actions">
          <button
            className={`btn ${tab === 'incidents' ? 'btn-primary' : ''}`}
            onClick={() => setTab('incidents')}
          >
            Incidents
          </button>
          <button
            className={`btn ${tab === 'claims' ? 'btn-primary' : ''}`}
            onClick={() => setTab('claims')}
          >
            Insurance claims
          </button>
          {canReport && tab === 'incidents' && (
            <button className="btn" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'Report incident'}
            </button>
          )}
        </div>
      </header>
      {error && <p className="error">{error}</p>}

      {showForm && (
        <form className="card form-grid" onSubmit={submit}>
          <label>
            Vehicle
            <select name="vehicleId" defaultValue="">
              <option value="">— none —</option>
              {vehicles.data?.items.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="type" required>
              {INCIDENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select name="severity" defaultValue="MEDIUM">
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            When
            <input
              name="occurredAt"
              type="datetime-local"
              required
              defaultValue={toLocalInput(new Date())}
            />
          </label>
          <label>
            Location
            <input name="location" placeholder="Road, township" />
          </label>
          <label>
            Police report no.
            <input name="policeReportNo" />
          </label>
          <label>
            Estimated cost
            <input name="estimatedCost" type="number" min={0} step="any" />
          </label>
          <label>
            Photos
            <input name="photos" type="file" accept="image/*" multiple />
          </label>
          <label className="span-all">
            What happened
            <textarea name="description" required minLength={5} rows={3} />
          </label>
          <label className="span-all">
            Third parties (names, plates, insurers)
            <textarea name="thirdParty" rows={2} />
          </label>
          <label className="check">
            <input name="injuries" type="checkbox" /> Someone was injured
          </label>
          <div>
            <button className="btn btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Save incident'}
            </button>
          </div>
        </form>
      )}

      {tab === 'incidents' && (
        <section className="card table-card">
          <div className="card-head">
            <h2>Incidents</h2>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {['REPORTED', 'INVESTIGATING', 'CLOSED'].map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </div>
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>When</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Vehicle</th>
                <th>Driver</th>
                <th>Status</th>
                <th className="num">Est. cost</th>
                <th>Claims</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    No incidents.
                  </td>
                </tr>
              )}
              {list.data?.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link to={`/incidents/${i.id}`}>{i.incidentNo}</Link>
                  </td>
                  <td>{formatDateTime(i.occurredAt)}</td>
                  <td>
                    {humanize(i.type)}
                    {i.injuries && <span className="badge badge-danger"> injuries</span>}
                  </td>
                  <td>
                    <span className={`badge badge-${SEVERITY_TONE[i.severity]}`}>
                      {humanize(i.severity)}
                    </span>
                  </td>
                  <td>
                    {i.vehicle ? (
                      <Link to={`/vehicles/${i.vehicle.id}`}>{i.vehicle.plateNumber}</Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {i.driver ? (
                      <Link to={`/drivers/${i.driver.id}`}>{i.driver.fullName}</Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className={`badge badge-${INCIDENT_TONE[i.status]}`}>
                      {humanize(i.status)}
                    </span>
                  </td>
                  <td className="num">{i.estimatedCost ? money(i.estimatedCost) : '—'}</td>
                  <td>
                    {i.claims.length ? i.claims.map((c) => humanize(c.status)).join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'claims' && (
        <section className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Claim</th>
                <th>Incident</th>
                <th>Vehicle</th>
                <th>Insurer</th>
                <th>Submitted</th>
                <th>Status</th>
                <th className="num">Claimed</th>
                <th className="num">Approved</th>
                <th className="num">Paid</th>
              </tr>
            </thead>
            <tbody>
              {claims.data?.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    No claims.
                  </td>
                </tr>
              )}
              {claims.data?.map((c) => (
                <tr key={c.id}>
                  <td>{c.claimNo}</td>
                  <td>
                    {c.incident && (
                      <Link to={`/incidents/${c.incident.id}`}>{c.incident.incidentNo}</Link>
                    )}
                  </td>
                  <td>{c.incident?.vehicle?.plateNumber ?? '—'}</td>
                  <td>{c.insurer ?? '—'}</td>
                  <td>{formatDate(c.submittedAt)}</td>
                  <td>
                    <span className={`badge badge-${CLAIM_TONE[c.status]}`}>
                      {humanize(c.status)}
                    </span>
                  </td>
                  <td className="num">{money(c.amountClaimed)}</td>
                  <td className="num">{c.amountApproved ? money(c.amountApproved) : '—'}</td>
                  <td className="num">{c.amountPaid ? money(c.amountPaid) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
