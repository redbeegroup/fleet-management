import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, openFile } from '../lib/api';
import { formatDateTime, humanize, KIND_LABEL, money, RESULT_TONE } from '../lib/format';
import type { Inspection } from '../lib/types';

export function InspectionDetailPage() {
  const { id } = useParams();
  const [error, setError] = useState<string | null>(null);
  const { data: i } = useQuery({
    queryKey: ['inspection', id],
    queryFn: () => api<Inspection>(`/inspections/${id}`),
  });
  if (!i) return <p className="muted">Loading…</p>;
  return (
    <>
      <header className="page-head">
        <div>
          <p className="muted">
            <Link to="/inspections">Inspections</Link> / {i.inspectionNo}
          </p>
          <h1>
            {KIND_LABEL[i.kind]} inspection{' '}
            <span className={`badge badge-${RESULT_TONE[i.result]}`}>{humanize(i.result)}</span>
          </h1>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="card">
        <dl className="facts">
          <dt>When</dt>
          <dd>{formatDateTime(i.performedAt)}</dd>
          <dt>Vehicle</dt>
          <dd>
            <Link to={`/vehicles/${i.vehicle.id}`}>{i.vehicle.plateNumber}</Link>
          </dd>
          <dt>Driver</dt>
          <dd>
            {i.driver ? <Link to={`/drivers/${i.driver.id}`}>{i.driver.fullName}</Link> : '—'}
          </dd>
          <dt>Checklist</dt>
          <dd>{i.template.name}</dd>
          <dt>Odometer</dt>
          <dd>{i.odometerKm ? `${money(i.odometerKm)} km` : '—'}</dd>
          <dt>Defects</dt>
          <dd>
            {i.defects} ({i.criticalDefects} critical)
            {i.repairRequestId && (
              <>
                {' '}
                · <Link to="/maintenance?tab=requests">repair request raised</Link>
              </>
            )}
          </dd>
          {i.notes && (
            <>
              <dt>Notes</dt>
              <dd className="pre">{i.notes}</dd>
            </>
          )}
        </dl>
      </section>
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Result</th>
              <th>Note</th>
              <th>Photo</th>
            </tr>
          </thead>
          <tbody>
            {i.items.map((it) => (
              <tr key={it.key}>
                <td>
                  {it.label} {it.critical && <span className="badge badge-muted">critical</span>}
                </td>
                <td>
                  {it.ok ? (
                    <span className="badge badge-ok">OK</span>
                  ) : (
                    <span className={`badge badge-${it.critical ? 'danger' : 'warn'}`}>Defect</span>
                  )}
                </td>
                <td>{it.note ?? ''}</td>
                <td>
                  {it.photoFileId && (
                    <button
                      className="link"
                      onClick={() =>
                        openFile(it.photoFileId!).catch((e: Error) => setError(e.message))
                      }
                    >
                      View
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
