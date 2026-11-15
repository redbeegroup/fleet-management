import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDateTime, money } from '../lib/format';
import type { LoadDetail } from '../lib/types';

/** Printable delivery manifest (browser print → PDF). */
export function ManifestPage() {
  const { id } = useParams();
  const { data: l } = useQuery({
    queryKey: ['manifest', id],
    queryFn: () => api<LoadDetail>(`/logistics/loads/${id}/manifest`),
  });
  if (!l) return <p className="muted">Loading…</p>;
  return (
    <div className="manifest">
      <header className="page-head">
        <div>
          <h1>Delivery manifest {l.tripNo}</h1>
          <p>
            {l.plannedDate} · depot {l.depot.name}
            {l.depot.address ? ` (${l.depot.address})` : ''} · departs{' '}
            {formatDateTime(l.plannedStart)}
          </p>
          <p>
            Vehicle <strong>{l.vehicle?.plateNumber ?? '—'}</strong> · Driver{' '}
            <strong>{l.driver?.fullName ?? '—'}</strong>{' '}
            {l.driver?.employeeNo ? `(${l.driver.employeeNo})` : ''}
          </p>
        </div>
        <div className="actions no-print">
          <Link className="btn" to={`/loads/${l.tripId}`}>
            Back
          </Link>
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
      </header>
      <p>
        {l.totals.orders} orders · {l.totals.stops} stops · {l.totals.kg} kg · {l.totals.m3} m³ ·{' '}
        {l.totals.cases} cases · {l.totals.pallets} pallets · COD to collect{' '}
        <strong>{money(l.cod)}</strong>
      </p>
      {l.stops.map((s) => (
        <section key={s.id} className="card">
          <h3>
            {s.seq}. {s.name}
          </h3>
          <p className="muted">
            {s.address ?? ''} {s.contactPhone ? `· ${s.contactName ?? ''} ${s.contactPhone}` : ''}
          </p>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>SKU</th>
                <th>Description</th>
                <th className="num">Qty</th>
                <th>Unit</th>
                <th className="num">Cases</th>
                <th className="num">kg</th>
                <th>Received ✓</th>
              </tr>
            </thead>
            <tbody>
              {s.orders.flatMap((o) =>
                o.lines.map((x, i) => (
                  <tr key={`${o.id}-${x.lineNo}`}>
                    <td>{i === 0 ? o.externalRef : ''}</td>
                    <td>{x.sku}</td>
                    <td>{x.description ?? ''}</td>
                    <td className="num">{x.quantity}</td>
                    <td>{x.uom}</td>
                    <td className="num">{x.cases ?? ''}</td>
                    <td className="num">{x.weightKg ?? ''}</td>
                    <td />
                  </tr>
                )),
              )}
            </tbody>
          </table>
          <p>
            COD: <strong>{money(s.orders.reduce((a, o) => a + (o.codAmount ?? 0), 0))}</strong>
            {s.orders.some((o) => o.notes) && (
              <>
                {' '}
                · Notes:{' '}
                {s.orders
                  .map((o) => o.notes)
                  .filter(Boolean)
                  .join('; ')}
              </>
            )}
          </p>
          <div className="sign">
            <div>Customer name</div>
            <div>Signature</div>
            <div>Time</div>
          </div>
        </section>
      ))}
      <div className="sign">
        <div>Loaded by (warehouse)</div>
        <div>Driver</div>
        <div>Cash received by</div>
      </div>
    </div>
  );
}
