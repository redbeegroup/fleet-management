import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { formatDate, humanize, money } from '../lib/format';
import { errorText } from '../pages/IncidentsPage';

interface Claim {
  id: string;
  claimNo: string;
  vehicleId: string;
  plateNumber: string | null;
  workOrderId: string | null;
  woNo: string | null;
  supplierName: string | null;
  basis: string;
  description: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RECOVERED';
  amountClaimed: string;
  amountApproved: string | null;
  amountRecovered: string | null;
  submittedAt: string | null;
  recoveredAt: string | null;
  createdAt: string;
}
interface Warranty {
  id: string;
  vehicleId: string;
  component: string;
  label: string | null;
  startDate: string;
  endDate: string | null;
  endKm: string | null;
  vehicle: { plateNumber: string };
}

const TONE = { DRAFT: 'muted', SUBMITTED: 'info', APPROVED: 'warn', REJECTED: 'danger', RECOVERED: 'ok' } as const;
const NEXT: Record<Claim['status'], { action: string; label: string }[]> = {
  DRAFT: [{ action: 'SUBMIT', label: 'Submit' }],
  SUBMITTED: [
    { action: 'APPROVE', label: 'Approved by supplier' },
    { action: 'REJECT', label: 'Rejected' },
  ],
  APPROVED: [{ action: 'RECOVER', label: 'Money received' }],
  REJECTED: [],
  RECOVERED: [],
};

/** Maintenance → Warranty: claims board and vehicle warranties. */
export function WarrantyTab() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.MAINTENANCE_WRITE);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const claims = useQuery({ queryKey: ['claims', status], queryFn: () => api<{ items: Claim[]; totals: { open: number; claimedOpen: number; recoveredThisYear: number } }>(`/warranty-claims${status ? `?status=${status}` : ''}`) });
  const warranties = useQuery({ queryKey: ['warranties', 'all'], queryFn: () => api<Warranty[]>('/warranties') });
  const act = useMutation({
    mutationFn: ({ id, b }: { id: string; b: Record<string, unknown> }) => api(`/warranty-claims/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: () => (setErr(null), void qc.invalidateQueries({ queryKey: ['claims'] })),
    onError: (e) => setErr(errorText(e)),
  });
  function step(c: Claim, action: string) {
    if (action === 'APPROVE') {
      const v = prompt('Amount approved by the supplier', String(Number(c.amountClaimed)));
      if (v === null) return;
      act.mutate({ id: c.id, b: { action, amountApproved: Number(v) } });
    } else if (action === 'RECOVER') {
      const v = prompt('Amount received (credit note or refund)', String(Number(c.amountApproved ?? c.amountClaimed)));
      if (v === null) return;
      act.mutate({ id: c.id, b: { action, amountRecovered: Number(v) } });
    } else act.mutate({ id: c.id, b: { action } });
  }
  const t = claims.data?.totals;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <section className="tiles">
        <div className="card tile">
          <span className="tile-label">Open claims</span>
          <span className="tile-value small">{t?.open ?? '…'}</span>
          <span className="muted small">{t ? `${money(t.claimedOpen)} claimed, waiting` : ''}</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Recovered this year</span>
          <span className="tile-value small">{t ? money(t.recoveredThisYear) : '…'}</span>
          <span className="muted small">deducted from maintenance and tire costs</span>
        </div>
      </section>
      {err && <p className="error">{err}</p>}
      <section className="card table-card">
        <div className="card-head">
          <h2>Warranty claims</h2>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All</option>
            {Object.keys(TONE).map((k) => (
              <option key={k} value={k}>
                {humanize(k)}
              </option>
            ))}
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Claim</th>
              <th>Vehicle</th>
              <th>For</th>
              <th>Supplier</th>
              <th className="num">Claimed</th>
              <th className="num">Recovered</th>
              <th>Status</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {claims.data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No claims. Open a work order: when a warranty may cover the repair, it offers to make a claim.
                </td>
              </tr>
            )}
            {claims.data?.items.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.claimNo}
                  <div className="muted small">{formatDate(c.createdAt)}</div>
                </td>
                <td>
                  <Link to={`/vehicles/${c.vehicleId}`}>{c.plateNumber}</Link>
                  {c.woNo && (
                    <div className="small">
                      <Link to={`/maintenance/work-orders/${c.workOrderId}`}>{c.woNo}</Link>
                    </div>
                  )}
                </td>
                <td>
                  {humanize(c.basis)}: {c.description}
                </td>
                <td>{c.supplierName ?? '—'}</td>
                <td className="num">{money(c.amountClaimed)}</td>
                <td className="num">{money(c.amountRecovered)}</td>
                <td>
                  <span className={`badge badge-${TONE[c.status]}`}>{humanize(c.status)}</span>
                </td>
                {canWrite && (
                  <td>
                    <div className="row-actions">
                      {NEXT[c.status].map((n) => (
                        <button key={n.action} className="link" onClick={() => step(c, n.action)}>
                          {n.label}
                        </button>
                      ))}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Vehicle warranties</h2>
        </div>
        <table>
          <tbody>
            {warranties.data?.length === 0 && (
              <tr>
                <td className="muted">None recorded. Add them on the vehicle page.</td>
              </tr>
            )}
            {warranties.data?.map((w) => {
              const end = w.endDate?.slice(0, 10);
              return (
                <tr key={w.id} className={end && end < today ? 'muted' : ''}>
                  <td>
                    <Link to={`/vehicles/${w.vehicleId}`}>{w.vehicle.plateNumber}</Link>
                  </td>
                  <td>
                    {humanize(w.component)}
                    {w.label ? `: ${w.label}` : ''}
                  </td>
                  <td>{[end && `until ${formatDate(w.endDate)}`, w.endKm && `${Number(w.endKm).toLocaleString()} km`].filter(Boolean).join(' / ')}</td>
                  <td>{end && end < today ? <span className="badge badge-muted">ended</span> : end && end <= soon ? <span className="badge badge-warn">ends soon</span> : <span className="badge badge-ok">active</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
