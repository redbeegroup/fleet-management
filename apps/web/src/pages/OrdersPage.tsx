import { Paginated } from '@fms/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { formatDateTime, humanize, money } from '../lib/format';
import type { ApiOrder } from '../lib/types';

const STATUS_TONE: Record<string, string> = {
  RECEIVED: 'info',
  PLANNED: 'warn',
  DISPATCHED: 'warn',
  DELIVERED: 'ok',
  PARTIAL: 'warn',
  FAILED: 'danger',
  RETURNED: 'danger',
  CANCELLED: 'muted',
};

/** Delivery orders received from the DMS (read-only until delivery planning arrives). */
export function OrdersPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['orders', status, search],
    queryFn: () =>
      api<Paginated<ApiOrder>>(
        `/orders?pageSize=100${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Delivery orders</h1>
          <p className="muted">
            Received from the DMS through the integration API. Delivery planning and dispatch come
            next.
          </p>
        </div>
        <div className="actions">
          <input
            type="search"
            placeholder="Order no. or customer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {Object.keys(STATUS_TONE).map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
      </header>
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Delivery window</th>
              <th>Priority</th>
              <th className="num">Lines</th>
              <th className="num">Weight (kg)</th>
              <th className="num">COD</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No orders yet. Your DMS sends them with an API key (Settings → Integrations).
                </td>
              </tr>
            )}
            {data?.items.map((o) => (
              <tr key={o.fmsId}>
                <td>
                  {o.externalRef}
                  {o.version > 1 && <span className="muted"> · v{o.version}</span>}
                </td>
                <td>
                  {o.customer.name} <span className="muted">{o.customer.code}</span>
                  {o.customer.township && (
                    <div className="muted">
                      {[o.customer.township, o.customer.city].filter(Boolean).join(', ')}
                    </div>
                  )}
                </td>
                <td>
                  {o.deliveryWindow
                    ? `${formatDateTime(o.deliveryWindow.start)} – ${formatDateTime(o.deliveryWindow.end)}`
                    : '—'}
                </td>
                <td>{humanize(o.priority)}</td>
                <td className="num">{o.lines.length}</td>
                <td className="num">{o.totalWeightKg != null ? money(o.totalWeightKg) : '—'}</td>
                <td className="num">{o.codAmount != null ? money(o.codAmount) : '—'}</td>
                <td>
                  <span className={`badge badge-${STATUS_TONE[o.status] ?? 'muted'}`}>
                    {humanize(o.status)}
                  </span>
                </td>
                <td>{formatDateTime(o.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
