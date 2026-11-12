import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../lib/api';
import { formatDuration } from '../lib/format';
import type { Attendance } from '../lib/types';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const time = (d: string | null) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');

export function AttendancePage() {
  const qc = useQueryClient();
  const [day, setDay] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['attendance', day], queryFn: () => api<Attendance>(`/dispatch/attendance?day=${day}`), refetchInterval: 60_000 });
  const duty = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'end' }) =>
      api(`/drivers/${id}/duty`, { method: 'POST', body: JSON.stringify({ action }) }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => setError(e.message),
  });
  const present = data?.drivers.filter((d) => d.present).length ?? 0;
  const canWrite = session.can(Permission.DRIVER_WRITE);

  return (
    <>
      <header className="page-head">
        <h1>Driver attendance</h1>
        <div className="actions">
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" />
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      <section className="tiles">
        <div className="card tile">
          <span className="tile-label">Present</span>
          <span className="tile-value">
            {present} / {data?.drivers.length ?? 0}
          </span>
        </div>
        <div className="card tile">
          <span className="tile-label">On duty now</span>
          <span className="tile-value">{data?.drivers.filter((d) => d.onDutyNow).length ?? 0}</span>
        </div>
        <div className="card tile">
          <span className="tile-label">Trips completed</span>
          <span className="tile-value">{data?.drivers.reduce((s, d) => s + d.completedTrips, 0) ?? 0}</span>
        </div>
      </section>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Status</th>
              <th>First in</th>
              <th>Last out</th>
              <th className="num">On duty</th>
              <th className="num">Trips</th>
              {canWrite && day === today() && <th />}
            </tr>
          </thead>
          <tbody>
            {data?.drivers.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`/drivers/${d.id}`}>{d.fullName}</Link> <span className="muted">{d.employeeNo}</span>
                </td>
                <td>
                  {d.onDutyNow ? (
                    <span className="badge badge-ok">on duty</span>
                  ) : d.present ? (
                    <span className="badge badge-info">off duty</span>
                  ) : (
                    <span className="badge badge-muted">absent</span>
                  )}
                </td>
                <td>{time(d.firstIn)}</td>
                <td>{time(d.lastOut)}</td>
                <td className="num">{d.dutyMinutes ? formatDuration(d.dutyMinutes) : '—'}</td>
                <td className="num">{d.completedTrips}</td>
                {canWrite && day === today() && (
                  <td className="num">
                    <button className="link" onClick={() => duty.mutate({ id: d.id, action: d.onDutyNow ? 'end' : 'start' })}>
                      {d.onDutyNow ? 'Clock out' : 'Clock in'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Times in your browser timezone; the day boundary follows the company timezone ({data?.timezone}).</p>
    </>
  );
}
