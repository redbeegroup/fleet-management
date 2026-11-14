import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { APPROVAL_TONE, formatDateTime, humanize, money } from '../lib/format';
import type { ApprovalRequest } from '../lib/types';
import { errorText } from './IncidentsPage';

const LINK: Record<ApprovalRequest['kind'], (id: string) => string> = {
  WORK_ORDER: (id) => `/maintenance/work-orders/${id}`,
  EXPENSE: () => '/reports',
  FUEL: () => '/fuel',
  VEHICLE_REQUEST: () => '/vehicle-requests',
  CLAIM: () => '/incidents',
};
const KIND: Record<ApprovalRequest['kind'], string> = {
  WORK_ORDER: 'Work order',
  EXPENSE: 'Expense',
  FUEL: 'Fuel',
  VEHICLE_REQUEST: 'Booking',
  CLAIM: 'Insurance claim',
};

export function ApprovalsPage() {
  const qc = useQueryClient();
  const canDecide = session.can(Permission.APPROVAL_DECIDE);
  const me = session.user()?.id;
  const [scope, setScope] = useState<'pending' | 'mine' | 'all'>(canDecide ? 'pending' : 'mine');
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['approvals', scope],
    queryFn: () => api<ApprovalRequest[]>(`/approvals?scope=${scope}`),
  });
  const decide = useMutation({
    mutationFn: ({
      id,
      action,
      note,
    }: {
      id: string;
      action: 'approve' | 'reject';
      note?: string | null;
    }) =>
      api(`/approvals/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ note: note ?? null }),
      }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (e) => setError(errorText(e)),
  });

  return (
    <>
      <header className="page-head">
        <h1>Approvals</h1>
        <div className="actions">
          {canDecide && (
            <button
              className={`btn ${scope === 'pending' ? 'btn-primary' : ''}`}
              onClick={() => setScope('pending')}
            >
              Waiting for me
            </button>
          )}
          <button
            className={`btn ${scope === 'mine' ? 'btn-primary' : ''}`}
            onClick={() => setScope('mine')}
          >
            My requests
          </button>
          {canDecide && (
            <button
              className={`btn ${scope === 'all' ? 'btn-primary' : ''}`}
              onClick={() => setScope('all')}
            >
              History
            </button>
          )}
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Requested</th>
              <th>Type</th>
              <th>What</th>
              <th className="num">Amount</th>
              <th>Approvals</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {scope === 'pending' ? 'Nothing is waiting for you.' : 'No requests.'}
                </td>
              </tr>
            )}
            {data?.map((r) => {
              const approvals = r.decisions.filter((d) => d.decision === 'APPROVED').length;
              const decidedByMe = r.decisions.some((d) => d.approverId === me);
              return (
                <tr key={r.id}>
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td>{KIND[r.kind]}</td>
                  <td>
                    <Link to={LINK[r.kind](r.entityId)}>{r.title}</Link>
                    {r.decisions
                      .filter((d) => d.note)
                      .map((d) => (
                        <div key={d.id} className="muted">
                          {humanize(d.decision)}: {d.note}
                        </div>
                      ))}
                  </td>
                  <td className="num">{r.amount != null ? money(r.amount) : '—'}</td>
                  <td>
                    {approvals} / {r.requiredApprovals}
                  </td>
                  <td>
                    <span className={`badge badge-${APPROVAL_TONE[r.status]}`}>
                      {humanize(r.status)}
                    </span>
                  </td>
                  <td>
                    {canDecide &&
                      r.status === 'PENDING' &&
                      r.requestedBy !== me &&
                      !decidedByMe && (
                        <span className="actions">
                          <button
                            className="link"
                            onClick={() => decide.mutate({ id: r.id, action: 'approve' })}
                            disabled={decide.isPending}
                          >
                            Approve
                          </button>
                          <button
                            className="link danger"
                            onClick={() => {
                              const note = prompt('Reason for rejecting');
                              if (note) decide.mutate({ id: r.id, action: 'reject', note });
                            }}
                          >
                            Reject
                          </button>
                        </span>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
