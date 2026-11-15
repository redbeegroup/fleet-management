import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, session } from '../lib/api';
import type { Branch, CompanySettings } from '../lib/types';
import { errorText } from '../pages/IncidentsPage';

/** Settings: depots (branches with a location) and delivery-planning defaults. */
export function DepotSettings({ settings }: { settings: CompanySettings }) {
  const qc = useQueryClient();
  const canBranch = session.can(Permission.BRANCH_WRITE);
  const canSettings = session.can(Permission.SETTINGS_WRITE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const saveBranch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/branches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Depot saved.' });
      void qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const saveSettings = useMutation({
    mutationFn: (logistics: Record<string, unknown>) =>
      api<CompanySettings>('/company/settings', {
        method: 'PATCH',
        body: JSON.stringify({ logistics }),
      }),
    onSuccess: (d) => {
      qc.setQueryData(['settings'], d);
      setMsg({ ok: true, text: 'Planning defaults saved.' });
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const l = settings.logistics;

  function submitBranch(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    saveBranch.mutate({
      id,
      body: {
        address: (f.get('address') as string) || null,
        latitude: num('latitude'),
        longitude: num('longitude'),
      },
    });
  }
  function submitSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    saveSettings.mutate({
      defaultBranchId: (f.get('defaultBranchId') as string) || null,
      defaultMaxStops: f.get('defaultMaxStops') ? Number(f.get('defaultMaxStops')) : null,
      departureTime: f.get('departureTime'),
      serviceMinutesPerStop: Number(f.get('serviceMinutesPerStop')),
      avgSpeedKmh: Number(f.get('avgSpeedKmh')),
      failureReasons: String(f.get('failureReasons'))
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
    });
  }

  return (
    <section className="card">
      <h2>Depots & delivery planning</h2>
      <p className="muted">
        Each branch is a depot. Its location is where delivery loads start and end, and it orders
        the stops.
      </p>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Depot</th>
              <th>Address</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {branches.data?.map((b) => (
              <tr key={b.id}>
                <td colSpan={5}>
                  <form className="inline-form" onSubmit={(e) => submitBranch(e, b.id)}>
                    <strong style={{ minWidth: 160 }}>
                      {b.name} <span className="muted">{b.code}</span>
                    </strong>
                    <input
                      name="address"
                      defaultValue={b.address ?? ''}
                      placeholder="Address"
                      aria-label={`${b.name} address`}
                      disabled={!canBranch}
                    />
                    <input
                      name="latitude"
                      type="number"
                      step="any"
                      min={-90}
                      max={90}
                      defaultValue={b.latitude ?? ''}
                      placeholder="Latitude"
                      aria-label={`${b.name} latitude`}
                      disabled={!canBranch}
                    />
                    <input
                      name="longitude"
                      type="number"
                      step="any"
                      min={-180}
                      max={180}
                      defaultValue={b.longitude ?? ''}
                      placeholder="Longitude"
                      aria-label={`${b.name} longitude`}
                      disabled={!canBranch}
                    />
                    {canBranch && <button className="btn">Save</button>}
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="form-grid" onSubmit={submitSettings} style={{ marginTop: 14 }}>
        <label>
          Default depot (orders without a depot code)
          <select
            name="defaultBranchId"
            defaultValue={l.defaultBranchId ?? ''}
            disabled={!canSettings}
          >
            <option value="">— none —</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max stops per load (if the vehicle has none)
          <input
            name="defaultMaxStops"
            type="number"
            min={1}
            max={500}
            defaultValue={l.defaultMaxStops ?? ''}
            disabled={!canSettings}
          />
        </label>
        <label>
          Default departure time
          <input
            name="departureTime"
            type="time"
            defaultValue={l.departureTime}
            disabled={!canSettings}
          />
        </label>
        <label>
          Minutes per stop (for the planned end)
          <input
            name="serviceMinutesPerStop"
            type="number"
            min={1}
            max={240}
            defaultValue={l.serviceMinutesPerStop}
            disabled={!canSettings}
          />
        </label>
        <label>
          Average speed (km/h)
          <input
            name="avgSpeedKmh"
            type="number"
            min={5}
            max={120}
            defaultValue={l.avgSpeedKmh}
            disabled={!canSettings}
          />
        </label>
        <label className="span-all">
          Failed-delivery reasons (one per line, shown in the driver app)
          <textarea
            name="failureReasons"
            rows={5}
            defaultValue={l.failureReasons.join('\n')}
            disabled={!canSettings}
          />
        </label>
        {canSettings && (
          <div>
            <button className="btn btn-primary" disabled={saveSettings.isPending}>
              Save planning defaults
            </button>
          </div>
        )}
      </form>
    </section>
  );
}
