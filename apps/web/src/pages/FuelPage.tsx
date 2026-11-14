import { Paginated, Permission } from '@fms/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileLink } from '../components/FileLink';
import { api, ApiError, session, uploadFile } from '../lib/api';
import { FLAG_LABELS, formatDateTime, money, monthRange, toLocalInput } from '../lib/format';
import type { Driver, FuelRecord, FuelSummary, Vehicle } from '../lib/types';

export function FuelPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.FUEL_WRITE);
  const [range, setRange] = useState(monthRange());
  const [vehicleId, setVehicleId] = useState('');
  const [flagged, setFlagged] = useState(false);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iso = (d: string) => new Date(`${d}T00:00`).toISOString();

  const vehicles = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200'),
  });
  const drivers = useQuery({
    queryKey: ['drivers', 'active'],
    queryFn: () => api<Paginated<Driver>>('/drivers?active=true&pageSize=200'),
    enabled: canWrite,
  });
  const summary = useQuery({
    queryKey: ['fuel', 'summary', range],
    queryFn: () => api<FuelSummary>(`/fuel/summary?from=${iso(range.from)}&to=${iso(range.to)}`),
  });
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '25',
    from: iso(range.from),
    to: iso(range.to),
  });
  if (vehicleId) params.set('vehicleId', vehicleId);
  if (flagged) params.set('flagged', 'true');
  const records = useQuery({
    queryKey: ['fuel', 'records', params.toString()],
    queryFn: () => api<Paginated<FuelRecord>>(`/fuel/records?${params}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['fuel'] });
  const create = useMutation({
    mutationFn: async ({ body, file }: { body: Record<string, unknown>; file: File | null }) => {
      const receiptFileId = file ? (await uploadFile(file)).id : null;
      return api<FuelRecord>('/fuel/records', {
        method: 'POST',
        body: JSON.stringify({ ...body, receiptFileId }),
      });
    },
    onSuccess: () => {
      setShowForm(false);
      setError(null);
      refresh();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.body.errors
          ? e.body.errors.map((x) => `${x.path}: ${x.message}`).join('; ')
          : e.message,
      ),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/fuel/records/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => (f.get(k) as string)?.trim() || null;
    const num = (k: string) => (str(k) ? Number(str(k)) : null);
    const file = f.get('receipt') as File | null;
    create.mutate({
      body: {
        vehicleId: str('vehicleId'),
        driverId: str('driverId'),
        filledAt: new Date(str('filledAt')!).toISOString(),
        odometerKm: num('odometerKm'),
        litres: num('litres'),
        unitPrice: num('unitPrice'),
        totalCost: num('totalCost'),
        station: str('station'),
        fullTank: f.get('fullTank') === 'on',
        paymentMethod: str('paymentMethod'),
      },
      file: file && file.size ? file : null,
    });
  }

  const s = summary.data?.fleet;
  const pages = records.data
    ? Math.max(1, Math.ceil(records.data.total / records.data.pageSize))
    : 1;

  return (
    <>
      <header className="page-head">
        <h1>Fuel</h1>
        <div className="actions">
          <label className="mini">
            From
            <input
              type="date"
              value={range.from}
              onChange={(e) =>
                e.target.value && (setRange({ ...range, from: e.target.value }), setPage(1))
              }
            />
          </label>
          <label className="mini">
            To
            <input
              type="date"
              value={range.to}
              onChange={(e) =>
                e.target.value && (setRange({ ...range, to: e.target.value }), setPage(1))
              }
            />
          </label>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setShowForm((x) => !x)}>
              {showForm ? 'Close' : 'Record fuel'}
            </button>
          )}
        </div>
      </header>

      {showForm && (
        <form className="card form-grid" onSubmit={submit}>
          <label>
            Vehicle *
            <select name="vehicleId" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {vehicles.data?.items.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber} (odometer {Number(v.odometerKm).toLocaleString()} km)
                </option>
              ))}
            </select>
          </label>
          <label>
            Driver
            <select name="driverId" defaultValue="">
              <option value="">—</option>
              {drivers.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date & time *
            <input
              name="filledAt"
              type="datetime-local"
              required
              defaultValue={toLocalInput(new Date())}
            />
          </label>
          <label>
            Odometer (km) *
            <input name="odometerKm" type="number" min={0} step="any" required />
          </label>
          <label>
            Litres *
            <input name="litres" type="number" min={0.01} step="any" required />
          </label>
          <label>
            Price per litre
            <input name="unitPrice" type="number" min={0} step="any" />
          </label>
          <label>
            Total cost
            <input
              name="totalCost"
              type="number"
              min={0}
              step="any"
              placeholder="or price × litres"
            />
          </label>
          <label>
            Station
            <input name="station" />
          </label>
          <label>
            Payment
            <select name="paymentMethod" defaultValue="CASH">
              <option value="CASH">Cash</option>
              <option value="FUEL_CARD">Fuel card</option>
              <option value="CREDIT">Credit account</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>
            Receipt
            <input name="receipt" type="file" accept="application/pdf,image/*" />
          </label>
          <label className="check span-2">
            <input type="checkbox" name="fullTank" defaultChecked /> Filled to full (needed for
            km/L)
          </label>
          {error && <p className="error span-2">{error}</p>}
          <div className="span-2 actions">
            <button className="btn btn-primary" disabled={create.isPending}>
              Save
            </button>
          </div>
        </form>
      )}

      <section className="tiles">
        {[
          ['Fuel cost', s ? money(s.cost) : '…'],
          ['Litres', s ? money(s.litres) : '…'],
          ['Fleet km/L', s?.kmPerLitre ?? '—'],
          ['L/100 km', s?.litresPer100Km ?? '—'],
          ['Fuel cost / km', s?.costPerKm ?? '—'],
          ['Flagged fills', s ? s.flagged : '…'],
        ].map(([l, v]) => (
          <div className="card tile" key={l}>
            <span className="tile-label">{l}</span>
            <span className="tile-value small">{v}</span>
          </div>
        ))}
      </section>

      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th className="num">Fills</th>
              <th className="num">Litres</th>
              <th className="num">Cost</th>
              <th className="num">Distance (km)</th>
              <th className="num">km/L</th>
              <th className="num">L/100 km</th>
              <th className="num">Flagged</th>
            </tr>
          </thead>
          <tbody>
            {summary.data?.vehicles.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No fuel records in this period.
                </td>
              </tr>
            )}
            {summary.data?.vehicles.map((v) => (
              <tr key={v.id}>
                <td>
                  <button className="link" onClick={() => (setVehicleId(v.id), setPage(1))}>
                    {v.plateNumber}
                  </button>
                </td>
                <td className="num">{v.fills}</td>
                <td className="num">{money(v.litres)}</td>
                <td className="num">{money(v.cost)}</td>
                <td className="num">{money(v.distanceKm)}</td>
                <td className="num">{v.kmPerLitre ?? '—'}</td>
                <td className="num">{v.litresPer100Km ?? '—'}</td>
                <td className="num">
                  {v.flagged ? <span className="badge badge-warn">{v.flagged}</span> : 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="toolbar">
        <select
          value={vehicleId}
          onChange={(e) => (setVehicleId(e.target.value), setPage(1))}
          aria-label="Vehicle"
        >
          <option value="">All vehicles</option>
          {vehicles.data?.items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plateNumber}
            </option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={flagged}
            onChange={(e) => (setFlagged(e.target.checked), setPage(1))}
          />{' '}
          Flagged only
        </label>
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vehicle</th>
              <th className="num">Odometer</th>
              <th className="num">Litres</th>
              <th className="num">Cost</th>
              <th className="num">km/L</th>
              <th>Station / driver</th>
              <th>Checks</th>
              <th>Receipt</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {records.data?.items.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.filledAt)}</td>
                <td>
                  <Link to={`/vehicles/${r.vehicle.id}`}>{r.vehicle.plateNumber}</Link>
                </td>
                <td className="num">{Number(r.odometerKm).toLocaleString()}</td>
                <td className="num">
                  {Number(r.litres)}
                  {!r.fullTank && <span className="muted"> (partial)</span>}
                </td>
                <td className="num">
                  {money(r.totalCost)}
                  {r.approvalStatus !== 'APPROVED' && (
                    <span
                      className={`badge badge-${r.approvalStatus === 'PENDING' ? 'warn' : 'danger'}`}
                    >
                      {' '}
                      {r.approvalStatus === 'PENDING' ? 'awaiting approval' : 'rejected'}
                    </span>
                  )}
                </td>
                <td className="num">{r.kmPerLitre ? Number(r.kmPerLitre) : '—'}</td>
                <td>
                  {r.station ?? '—'}
                  {r.driver && <span className="muted"> · {r.driver.fullName}</span>}
                  {r.source === 'app' && <span className="badge badge-info"> app</span>}
                </td>
                <td>
                  {r.flags.map((f) => (
                    <span key={f} className="badge badge-danger" title={FLAG_LABELS[f] ?? f}>
                      {FLAG_LABELS[f] ?? f}
                    </span>
                  ))}
                </td>
                <td>
                  {r.receiptFileId ? (
                    <FileLink
                      file={{ id: r.receiptFileId, filename: 'receipt', contentType: 'image' }}
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">
                  {canWrite && (
                    <button
                      className="link danger"
                      onClick={() => confirm('Delete this fuel record?') && remove.mutate(r.id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {pages} · {records.data?.total ?? 0} records
        </span>
        <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </>
  );
}
