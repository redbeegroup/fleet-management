import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { licenceShort } from '../components/LicenceFields';
import { api, ApiError, session } from '../lib/api';
import { humanize } from '../lib/format';
import type { CompanySettings } from '../lib/types';

export function SettingsPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.SETTINGS_WRITE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<CompanySettings>('/company/settings') });
  const save = useMutation({
    mutationFn: (telematics: Record<string, number>) =>
      api<CompanySettings>('/company/settings', { method: 'PATCH', body: JSON.stringify({ telematics }) }),
    onSuccess: (d) => {
      qc.setQueryData(['settings'], d);
      setMsg({ ok: true, text: 'Saved. New thresholds apply to the next positions received.' });
    },
    onError: (e) =>
      setMsg({ ok: false, text: e instanceof ApiError && e.body.errors ? e.body.errors.map((x) => `${x.path}: ${x.message}`).join('; ') : e.message }),
  });
  if (!data) return <p className="muted">Loading…</p>;
  const t = data.telematics;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate(Object.fromEntries(['speedLimitKmh', 'overspeedHysteresisKmh', 'idleMinutes', 'offlineMinutes'].map((k) => [k, Number(f.get(k))])));
  }

  return (
    <>
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <form className="card form-grid" onSubmit={submit}>
        <h2 className="span-2">Telematics alerts</h2>
        <label>
          Default speed limit (km/h)
          <input name="speedLimitKmh" type="number" min={10} max={200} defaultValue={t.speedLimitKmh} disabled={!canWrite} />
          <small className="muted">Vehicles can override this on their edit page.</small>
        </label>
        <label>
          Overspeed hysteresis (km/h)
          <input name="overspeedHysteresisKmh" type="number" min={0} max={30} defaultValue={t.overspeedHysteresisKmh} disabled={!canWrite} />
          <small className="muted">An episode ends once speed falls this far below the limit.</small>
        </label>
        <label>
          Idling threshold (minutes)
          <input name="idleMinutes" type="number" min={1} max={240} defaultValue={t.idleMinutes} disabled={!canWrite} />
          <small className="muted">Engine on and stationary for this long raises an idling event.</small>
        </label>
        <label>
          GPS offline after (minutes)
          <input name="offlineMinutes" type="number" min={5} max={1440} defaultValue={t.offlineMinutes} disabled={!canWrite} />
        </label>
        {msg && <p className={`span-2 ${msg.ok ? 'success' : 'error'}`}>{msg.text}</p>}
        {canWrite && (
          <div className="span-2 actions">
            <button className="btn btn-primary" disabled={save.isPending}>
              Save settings
            </button>
          </div>
        )}
      </form>
      <section className="card">
        <h2>Licence rules for dispatch</h2>
        <p className="muted">
          Myanmar licence categories required to assign a driver to each vehicle class{data.dispatch.enforceLicenceClass ? '' : ' (currently not enforced)'}. Company vehicles are
          treated as commercial, so cars, vans and pickups need ဃ (D) or င (E). Learner (သ) and conductor (စ) permits never qualify.
        </p>
        <table>
          <thead>
            <tr>
              <th>Vehicle class</th>
              <th>Accepted licences</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.dispatch.licenceRules).map(([cls, codes]) => (
              <tr key={cls}>
                <td>{humanize(cls)}</td>
                <td>{codes.length ? licenceShort(codes.join(',')) : <span className="muted">any valid licence</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
