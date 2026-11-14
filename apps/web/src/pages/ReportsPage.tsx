import { ExpenseCategory, Paginated, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { RangePicker } from '../components/RangePicker';
import { accessToken, api, ApiError, session, uploadFile } from '../lib/api';
import { formatDate, formatDuration, humanize, lastDays, money, toLocalInput } from '../lib/format';
import type { Expense, Overview, Vehicle } from '../lib/types';

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

export function ReportsPage() {
  const qc = useQueryClient();
  const [range, setRange] = useState(() => lastDays(30));
  const [error, setError] = useState<string | null>(null);
  const [showExpense, setShowExpense] = useState(false);
  const canWrite = session.can(Permission.COST_WRITE);
  const { data } = useQuery({
    queryKey: ['analytics', 'overview', range],
    queryFn: () => api<Overview>(`/analytics/overview?from=${range.from}&to=${range.to}`),
  });
  const vehicles = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200'),
    enabled: canWrite,
  });
  const fromIso = new Date(`${range.from}T00:00`).toISOString();
  const toIso = new Date(new Date(`${range.to}T00:00`).getTime() + 86_400_000).toISOString();
  const expenses = useQuery({
    queryKey: ['expenses', range],
    queryFn: () => api<Paginated<Expense>>(`/expenses?from=${fromIso}&to=${toIso}&pageSize=100`),
  });
  const addExpense = useMutation({
    mutationFn: async ({ body, file }: { body: Record<string, unknown>; file: File | null }) => {
      const receiptFileId = file ? (await uploadFile(file)).id : null;
      return api('/expenses', { method: 'POST', body: JSON.stringify({ ...body, receiptFileId }) });
    },
    onSuccess: () => {
      setShowExpense(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.body.errors
          ? e.body.errors.map((x) => `${x.path}: ${x.message}`).join('; ')
          : e.message,
      ),
  });
  const removeExpense = useMutation({
    mutationFn: (id: string) => api(`/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  async function downloadCsv() {
    const res = await fetch(`/api/analytics/vehicles.csv?from=${range.from}&to=${range.to}`, {
      headers: { Authorization: `Bearer ${accessToken()}` },
    });
    if (!res.ok) return setError(`Export failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleet-vehicles_${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function submitExpense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get('receipt') as File | null;
    addExpense.mutate({
      body: {
        vehicleId: f.get('vehicleId'),
        category: f.get('category'),
        incurredAt: new Date(f.get('incurredAt') as string).toISOString(),
        amount: Number(f.get('amount')),
        description: (f.get('description') as string) || null,
      },
      file: file && file.size ? file : null,
    });
  }

  const cur = data?.range.currency ?? '';
  return (
    <>
      <header className="page-head">
        <h1>Reports</h1>
        <RangePicker value={range} onChange={setRange} />
      </header>
      {error && <p className="error">{error}</p>}
      {data && (data.pendingApproval.fuelRecords > 0 || data.pendingApproval.expenses > 0) && (
        <p className="muted">
          Not included below, awaiting approval: fuel {money(data.pendingApproval.fuelCost)} (
          {data.pendingApproval.fuelRecords}), other {money(data.pendingApproval.otherCost)} (
          {data.pendingApproval.expenses}). <Link to="/approvals">Approvals</Link>
        </p>
      )}

      <section className="card table-card">
        <div className="card-head">
          <h2>Vehicles · {cur}</h2>
          <button className="btn" onClick={downloadCsv}>
            Download CSV
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Branch</th>
              <th className="num">Distance (km)</th>
              <th className="num">Days used</th>
              <th className="num">Utilization</th>
              <th className="num">Trips</th>
              <th className="num">Fuel</th>
              <th className="num">km/L</th>
              <th className="num">Maintenance</th>
              <th className="num">Other</th>
              <th className="num">Total</th>
              <th className="num">Cost / km</th>
              <th className="num">Downtime</th>
              <th className="num">Idle</th>
              <th className="num">Overspeed</th>
            </tr>
          </thead>
          <tbody>
            {data?.vehicles.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link to={`/vehicles/${v.id}`}>{v.plateNumber}</Link>
                </td>
                <td>{v.branchName ?? '—'}</td>
                <td className="num">{money(v.distanceKm)}</td>
                <td className="num">{v.daysUsed}</td>
                <td className="num">{pct(v.utilizationPct)}</td>
                <td className="num">{v.tripsCompleted}</td>
                <td className="num">{money(v.fuelCost)}</td>
                <td className="num">{v.fuelKmPerLitre ?? '—'}</td>
                <td className="num">{money(v.maintenanceCost)}</td>
                <td className="num">{money(v.otherCost)}</td>
                <td className="num">
                  <strong>{money(v.totalCost)}</strong>
                </td>
                <td className="num">{v.costPerKm != null ? money(v.costPerKm) : '—'}</td>
                <td className="num">
                  {v.downtimeMinutes ? formatDuration(v.downtimeMinutes) : '—'}
                </td>
                <td className="num">{pct(v.idlePct)}</td>
                <td className="num">{v.overspeedEvents}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card table-card">
        <div className="card-head">
          <h2>Branches</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Branch</th>
              <th className="num">Vehicles</th>
              <th className="num">Distance (km)</th>
              <th className="num">Utilization</th>
              <th className="num">Availability</th>
              <th className="num">Total cost</th>
              <th className="num">Cost / km</th>
              <th className="num">km/L</th>
            </tr>
          </thead>
          <tbody>
            {data?.branches.map((b) => (
              <tr key={b.branchId ?? 'none'}>
                <td>{b.branchName}</td>
                <td className="num">{b.vehicles}</td>
                <td className="num">{money(b.distanceKm)}</td>
                <td className="num">{pct(b.utilizationPct)}</td>
                <td className="num">{pct(b.availabilityPct)}</td>
                <td className="num">{money(b.totalCost)}</td>
                <td className="num">{b.costPerKm != null ? money(b.costPerKm) : '—'}</td>
                <td className="num">{b.fuelKmPerLitre ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Other expenses</h2>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setShowExpense((x) => !x)}>
              {showExpense ? 'Close' : 'Add expense'}
            </button>
          )}
        </div>
        {showExpense && (
          <form className="form-grid" onSubmit={submitExpense}>
            <label>
              Vehicle *
              <select name="vehicleId" required defaultValue="">
                <option value="" disabled>
                  Select…
                </option>
                {vehicles.data?.items.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plateNumber}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category *
              <select name="category" defaultValue="TOLL">
                {Object.values(ExpenseCategory).map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date *
              <input
                name="incurredAt"
                type="datetime-local"
                required
                defaultValue={toLocalInput(new Date())}
              />
            </label>
            <label>
              Amount *
              <input name="amount" type="number" min={0.01} step="any" required />
            </label>
            <label>
              Description
              <input name="description" />
            </label>
            <label>
              Receipt
              <input name="receipt" type="file" accept="application/pdf,image/*" />
            </label>
            <div className="span-2 actions">
              <button className="btn btn-primary" disabled={addExpense.isPending}>
                Save expense
              </button>
            </div>
          </form>
        )}
        <div className="expense-cats">
          {Object.entries(data?.expenseByCategory ?? {}).map(([k, v]) => (
            <span key={k} className="badge badge-muted">
              {humanize(k)}: {money(v)}
            </span>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vehicle</th>
              <th>Category</th>
              <th>Description</th>
              <th className="num">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {expenses.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No expenses in this period.
                </td>
              </tr>
            )}
            {expenses.data?.items.map((x) => (
              <tr key={x.id}>
                <td>{formatDate(x.incurredAt)}</td>
                <td>{x.vehicle.plateNumber}</td>
                <td>{humanize(x.category)}</td>
                <td>{x.description ?? '—'}</td>
                <td className="num">
                  {money(x.amount)}
                  {x.approvalStatus !== 'APPROVED' && (
                    <span
                      className={`badge badge-${x.approvalStatus === 'PENDING' ? 'warn' : 'danger'}`}
                    >
                      {' '}
                      {x.approvalStatus === 'PENDING' ? 'awaiting approval' : 'rejected'}
                    </span>
                  )}
                </td>
                <td className="num">
                  {canWrite && (
                    <button
                      className="link danger"
                      onClick={() => confirm('Delete expense?') && removeExpense.mutate(x.id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
