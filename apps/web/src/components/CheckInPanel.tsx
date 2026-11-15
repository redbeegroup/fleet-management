import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, session } from '../lib/api';
import { formatDateTime, money } from '../lib/format';
import type { CheckInView } from '../lib/types';
import { errorText } from '../pages/IncidentsPage';

/** Warehouse check-in after a delivery trip: undelivered goods, customer returns and cash. */
export function CheckInPanel({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const canCheckIn = session.can(Permission.WAREHOUSE_CHECKIN);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['check-in', tripId],
    queryFn: () => api<CheckInView>(`/logistics/loads/${tripId}/check-in`),
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<CheckInView>(`/logistics/loads/${tripId}/check-in`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (d) => {
      setError(null);
      qc.setQueryData(['check-in', tripId], d);
      void qc.invalidateQueries({ queryKey: ['load', tripId] });
    },
    onError: (e) => setError(errorText(e)),
  });
  if (!data) return null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      lines: data!.expected.map((x) => ({ key: x.key, receivedQty: Number(f.get(x.key) ?? 0) })),
      cashReceived: f.get('cash') ? Number(f.get('cash')) : null,
      notes: (f.get('notes') as string) || null,
    });
  }

  const done = data.checkIn;
  return (
    <section className="card checkin">
      <div className="card-head">
        <h2>Warehouse check-in</h2>
        {done && (
          <span className={`badge badge-${done.ok ? 'ok' : 'danger'}`}>
            {done.ok
              ? 'all received'
              : `${done.shortages} short · ${done.overages} over${done.cashDiff ? ` · cash ${money(done.cashDiff)}` : ''}`}
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {done ? (
        <>
          <p className="muted">
            Checked in {data.checkedInAt ? formatDateTime(data.checkedInAt) : ''}
          </p>
          <table>
            <thead>
              <tr>
                <th>What</th>
                <th>SKU</th>
                <th className="num">Expected</th>
                <th className="num">Received</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {done.lines.map((x) => (
                <tr key={x.key}>
                  <td>
                    {x.kind === 'UNDELIVERED'
                      ? `Undelivered · ${x.ref}`
                      : `Customer return · ${x.ref}`}
                  </td>
                  <td>{x.sku}</td>
                  <td className="num">
                    {x.expectedQty} {x.uom}
                  </td>
                  <td className="num">{x.receivedQty}</td>
                  <td className={`num ${x.diff ? 'text-danger' : ''}`}>{x.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Cash: expected {money(done.cashExpected)}, received{' '}
            {done.cashReceived != null ? money(done.cashReceived) : '—'}
            {done.notes && ` · ${done.notes}`}
          </p>
        </>
      ) : canCheckIn ? (
        <form onSubmit={submit}>
          {data.expected.length === 0 && (
            <p className="muted">Nothing to bring back — everything was delivered.</p>
          )}
          {data.expected.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>What</th>
                  <th>SKU</th>
                  <th className="num">Expected</th>
                  <th className="num">Received</th>
                </tr>
              </thead>
              <tbody>
                {data.expected.map((x) => (
                  <tr key={x.key}>
                    <td>
                      {x.kind === 'UNDELIVERED'
                        ? `Undelivered · ${x.ref}`
                        : `Customer return · ${x.ref}`}
                    </td>
                    <td>
                      {x.sku} {x.description ?? ''}
                    </td>
                    <td className="num">
                      {x.expectedQty} {x.uom}
                    </td>
                    <td className="num">
                      <input
                        name={x.key}
                        type="number"
                        min={0}
                        step="any"
                        defaultValue={x.expectedQty}
                        aria-label={`Received ${x.sku}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="inline-form">
            <label>
              Cash handed in (expected {money(data.cashExpected)})
              <input
                name="cash"
                type="number"
                min={0}
                step="any"
                defaultValue={data.cashExpected}
              />
            </label>
            <input name="notes" placeholder="Notes" aria-label="Notes" />
            <button className="btn btn-primary" disabled={save.isPending}>
              Confirm check-in
            </button>
          </div>
        </form>
      ) : (
        <p className="muted">Waiting for the warehouse to check this load in.</p>
      )}
    </section>
  );
}
