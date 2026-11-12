import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, openFile, session } from '../lib/api';
import {
  CLAIM_TONE,
  formatDate,
  formatDateTime,
  humanize,
  INCIDENT_TONE,
  money,
  SEVERITY_TONE,
} from '../lib/format';
import type { Incident, InsuranceClaim } from '../lib/types';
import { errorText } from './IncidentsPage';

export function IncidentDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const canWrite = session.can(Permission.SAFETY_WRITE);
  const [error, setError] = useState<string | null>(null);
  const [showClaim, setShowClaim] = useState(false);
  const { data: i } = useQuery({
    queryKey: ['incident', id],
    queryFn: () => api<Incident>(`/incidents/${id}`),
  });

  const done = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['incident', id] });
    void qc.invalidateQueries({ queryKey: ['incidents'] });
    void qc.invalidateQueries({ queryKey: ['claims'] });
  };
  const onError = (e: Error) => setError(errorText(e));
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: done,
    onError,
  });
  const addClaim = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/incidents/${id}/claims`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setShowClaim(false);
      done();
    },
    onError,
  });
  const updateClaim = useMutation({
    mutationFn: ({ claimId, body }: { claimId: string; body: Record<string, unknown> }) =>
      api(`/claims/${claimId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: done,
    onError,
  });

  if (!i) return <p className="muted">Loading…</p>;

  function saveInvestigation(e: FormEvent<HTMLFormElement>, close: boolean) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    update.mutate({
      findings: (f.get('findings') as string) || null,
      correctiveActions: (f.get('correctiveActions') as string) || null,
      ...(close
        ? { status: 'CLOSED' }
        : i!.status === 'REPORTED'
          ? { status: 'INVESTIGATING' }
          : {}),
    });
  }

  function submitClaim(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addClaim.mutate({
      amountClaimed: Number(f.get('amountClaimed')),
      insurer: f.get('insurer') || null,
      policyNo: f.get('policyNo') || null,
      externalRef: f.get('externalRef') || null,
      notes: f.get('notes') || null,
    });
  }

  function claimAction(c: InsuranceClaim, status: string) {
    const ask = (label: string, def: string) => {
      const v = prompt(label, def);
      return v === null ? undefined : Number(v);
    };
    if (status === 'APPROVED') {
      const amountApproved = ask('Approved amount', c.amountClaimed);
      if (amountApproved !== undefined)
        updateClaim.mutate({ claimId: c.id, body: { status, amountApproved } });
    } else if (status === 'SETTLED') {
      const amountPaid = ask('Amount paid', c.amountApproved ?? c.amountClaimed);
      if (amountPaid !== undefined)
        updateClaim.mutate({ claimId: c.id, body: { status, amountPaid } });
    } else if (confirm(`Mark ${c.claimNo} as ${humanize(status).toLowerCase()}?`)) {
      updateClaim.mutate({ claimId: c.id, body: { status } });
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="muted">
            <Link to="/incidents">Incidents</Link> / {i.incidentNo}
          </p>
          <h1>
            {humanize(i.type)}{' '}
            <span className={`badge badge-${INCIDENT_TONE[i.status]}`}>{humanize(i.status)}</span>{' '}
            <span className={`badge badge-${SEVERITY_TONE[i.severity]}`}>
              {humanize(i.severity)}
            </span>
          </h1>
        </div>
        {canWrite && i.status === 'CLOSED' && (
          <button className="btn" onClick={() => update.mutate({ status: 'INVESTIGATING' })}>
            Reopen
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <dl className="facts">
          <dt>When</dt>
          <dd>{formatDateTime(i.occurredAt)}</dd>
          <dt>Vehicle</dt>
          <dd>
            {i.vehicle ? (
              <Link to={`/vehicles/${i.vehicle.id}`}>{i.vehicle.plateNumber}</Link>
            ) : (
              '—'
            )}
          </dd>
          <dt>Driver</dt>
          <dd>
            {i.driver ? <Link to={`/drivers/${i.driver.id}`}>{i.driver.fullName}</Link> : '—'}
          </dd>
          <dt>Location</dt>
          <dd>
            {i.location ?? '—'}
            {i.latitude != null && i.longitude != null && (
              <span className="muted">
                {' '}
                ({i.latitude.toFixed(5)}, {i.longitude.toFixed(5)})
              </span>
            )}
          </dd>
          <dt>Injuries</dt>
          <dd>{i.injuries ? <span className="badge badge-danger">Yes</span> : 'No'}</dd>
          <dt>Third parties</dt>
          <dd>{i.thirdParty ?? '—'}</dd>
          <dt>Police report</dt>
          <dd>{i.policeReportNo ?? '—'}</dd>
          <dt>Estimated cost</dt>
          <dd>{i.estimatedCost ? money(i.estimatedCost) : '—'}</dd>
          <dt>Work order</dt>
          <dd>
            {i.workOrderId ? (
              <Link to={`/maintenance/work-orders/${i.workOrderId}`}>Open work order</Link>
            ) : (
              '—'
            )}
          </dd>
        </dl>
        <h3>Description</h3>
        <p className="pre">{i.description}</p>
        {i.photoFileIds.length > 0 && (
          <>
            <h3>Photos</h3>
            <div className="photo-row">
              {i.photoFileIds.map((f, n) => (
                <button
                  key={f}
                  className="btn"
                  onClick={() => openFile(f).catch((e: Error) => setError(e.message))}
                >
                  Photo {n + 1}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Investigation</h2>
        {canWrite && i.status !== 'CLOSED' ? (
          <form
            className="form-grid"
            onSubmit={(e) =>
              saveInvestigation(
                e,
                (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'close',
              )
            }
          >
            <label className="span-all">
              Findings
              <textarea name="findings" rows={3} defaultValue={i.findings ?? ''} />
            </label>
            <label className="span-all">
              Corrective actions
              <textarea
                name="correctiveActions"
                rows={2}
                defaultValue={i.correctiveActions ?? ''}
              />
            </label>
            <div className="actions span-all">
              <button className="btn" value="save" disabled={update.isPending}>
                {i.status === 'REPORTED' ? 'Start investigation' : 'Save'}
              </button>
              <button className="btn btn-primary" value="close" disabled={update.isPending}>
                Close incident
              </button>
            </div>
          </form>
        ) : (
          <dl className="facts">
            <dt>Findings</dt>
            <dd className="pre">{i.findings ?? '—'}</dd>
            <dt>Corrective actions</dt>
            <dd className="pre">{i.correctiveActions ?? '—'}</dd>
            <dt>Closed</dt>
            <dd>{i.closedAt ? formatDateTime(i.closedAt) : '—'}</dd>
          </dl>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Insurance claims</h2>
          {canWrite && (
            <button className="btn" onClick={() => setShowClaim((v) => !v)}>
              {showClaim ? 'Cancel' : 'New claim'}
            </button>
          )}
        </div>
        {showClaim && (
          <form className="form-grid" onSubmit={submitClaim}>
            <label>
              Amount claimed
              <input
                name="amountClaimed"
                type="number"
                min={1}
                step="any"
                required
                defaultValue={i.estimatedCost ?? undefined}
              />
            </label>
            <label>
              Insurer
              <input name="insurer" placeholder="Defaults to the vehicle's insurance document" />
            </label>
            <label>
              Policy no.
              <input name="policyNo" placeholder="Defaults to the vehicle's policy" />
            </label>
            <label>
              Insurer reference
              <input name="externalRef" />
            </label>
            <label className="span-all">
              Notes
              <textarea name="notes" rows={2} />
            </label>
            <div>
              <button className="btn btn-primary" disabled={addClaim.isPending}>
                Submit claim
              </button>
            </div>
          </form>
        )}
        {i.claims.length === 0 && !showClaim && (
          <p className="muted">No claims for this incident.</p>
        )}
        {i.claims.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Claim</th>
                  <th>Insurer / policy</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th className="num">Claimed</th>
                  <th className="num">Approved</th>
                  <th className="num">Paid</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {i.claims.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.claimNo}
                      {c.externalRef && <span className="muted"> · {c.externalRef}</span>}
                    </td>
                    <td>
                      {c.insurer ?? '—'} <span className="muted">{c.policyNo}</span>
                    </td>
                    <td>{formatDate(c.submittedAt)}</td>
                    <td>
                      <span className={`badge badge-${CLAIM_TONE[c.status]}`}>
                        {humanize(c.status)}
                      </span>
                    </td>
                    <td className="num">{money(c.amountClaimed)}</td>
                    <td className="num">{c.amountApproved ? money(c.amountApproved) : '—'}</td>
                    <td className="num">{c.amountPaid ? money(c.amountPaid) : '—'}</td>
                    <td className="actions">
                      {canWrite && c.status === 'SUBMITTED' && (
                        <>
                          <button className="link" onClick={() => claimAction(c, 'APPROVED')}>
                            Approve
                          </button>
                          <button
                            className="link danger"
                            onClick={() => claimAction(c, 'REJECTED')}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {canWrite && c.status === 'APPROVED' && (
                        <button className="link" onClick={() => claimAction(c, 'SETTLED')}>
                          Mark settled
                        </button>
                      )}
                      {canWrite && c.status === 'REJECTED' && (
                        <button className="link" onClick={() => claimAction(c, 'SUBMITTED')}>
                          Resubmit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
