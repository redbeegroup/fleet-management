import { Permission } from '@fms/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, session } from '../lib/api';
import type { CompanySettings, ControlSettings as Control } from '../lib/types';
import { errorText } from '../pages/IncidentsPage';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Settings: route deviation and unauthorised-use rules (evaluated on every GPS position). */
export function ControlSettings({ settings }: { settings: CompanySettings }) {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.SETTINGS_WRITE);
  const c = settings.control;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: (control: Partial<Control>) =>
      api<CompanySettings>('/company/settings', {
        method: 'PATCH',
        body: JSON.stringify({ control }),
      }),
    onSuccess: (d) => {
      qc.setQueryData(['settings'], d);
      setMsg({ ok: true, text: 'Saved. The rules apply to the next positions received.' });
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const on = (k: string) => f.get(k) === 'on';
    save.mutate({
      offRouteEnabled: on('offRouteEnabled'),
      offRouteMeters: Number(f.get('offRouteMeters')),
      offRouteMinutes: Number(f.get('offRouteMinutes')),
      movementWithoutTrip: on('movementWithoutTrip'),
      movementWithoutTripKm: Number(f.get('movementWithoutTripKm')),
      workingHoursEnabled: on('workingHoursEnabled'),
      workingHours: DAYS.map((_, i) =>
        on(`open${i}`)
          ? { start: String(f.get(`start${i}`)), end: String(f.get(`end${i}`)) }
          : null,
      ),
      requireDriverOnDuty: on('requireDriverOnDuty'),
      restrictedAreaAlerts: on('restrictedAreaAlerts'),
    });
  }
  return (
    <form className="card form-grid" onSubmit={submit}>
      <h2 className="span-2">Route deviation & unauthorised use</h2>
      <p className="muted span-2">
        Managers and dispatchers are alerted; vehicle alert webhooks receive vehicle.off_route and
        vehicle.unauthorised_use.
      </p>
      <label className="check">
        <input
          name="offRouteEnabled"
          type="checkbox"
          defaultChecked={c.offRouteEnabled}
          disabled={!canWrite}
        />{' '}
        Alert when a vehicle leaves the planned route of its trip
      </label>
      <div className="inline-form" style={{ marginTop: 0 }}>
        <label>
          Distance (m)
          <input
            name="offRouteMeters"
            type="number"
            min={100}
            max={20000}
            defaultValue={c.offRouteMeters}
            disabled={!canWrite}
          />
        </label>
        <label>
          for at least (min)
          <input
            name="offRouteMinutes"
            type="number"
            min={1}
            max={120}
            defaultValue={c.offRouteMinutes}
            disabled={!canWrite}
          />
        </label>
      </div>
      <p className="muted small span-2">
        Only trips planned on the road network (OSRM) have a route to follow; straight-line plans
        are not checked.
      </p>
      <label className="check">
        <input
          name="movementWithoutTrip"
          type="checkbox"
          defaultChecked={c.movementWithoutTrip}
          disabled={!canWrite}
        />{' '}
        Alert when a vehicle drives without an ongoing trip
      </label>
      <label>
        after (km)
        <input
          name="movementWithoutTripKm"
          type="number"
          min={0.2}
          max={100}
          step="0.1"
          defaultValue={c.movementWithoutTripKm}
          disabled={!canWrite}
        />
      </label>
      <label className="check">
        <input
          name="requireDriverOnDuty"
          type="checkbox"
          defaultChecked={c.requireDriverOnDuty}
          disabled={!canWrite}
        />{' '}
        Alert when a vehicle moves without a driver on duty
      </label>
      <label className="check">
        <input
          name="restrictedAreaAlerts"
          type="checkbox"
          defaultChecked={c.restrictedAreaAlerts}
          disabled={!canWrite}
        />{' '}
        Critical alert when entering a RESTRICTED geofence
      </label>
      <label className="check span-2">
        <input
          name="workingHoursEnabled"
          type="checkbox"
          defaultChecked={c.workingHoursEnabled}
          disabled={!canWrite}
        />{' '}
        Alert when a vehicle is used outside working hours (company time zone)
      </label>
      <div className="span-2 hours-grid">
        {DAYS.map((d, i) => {
          const h = c.workingHours[i];
          return (
            <div key={d} className="hours-row">
              <label className="check">
                <input
                  name={`open${i}`}
                  type="checkbox"
                  defaultChecked={!!h}
                  disabled={!canWrite}
                />{' '}
                {d}
              </label>
              <input
                name={`start${i}`}
                type="time"
                defaultValue={h?.start ?? '06:00'}
                aria-label={`${d} start`}
                disabled={!canWrite}
              />
              <span className="muted">to</span>
              <input
                name={`end${i}`}
                type="time"
                defaultValue={h?.end ?? '20:00'}
                aria-label={`${d} end`}
                disabled={!canWrite}
              />
            </div>
          );
        })}
        <p className="muted small">
          An end time before the start means the shift runs past midnight.
        </p>
      </div>
      {msg && <p className={`span-2 ${msg.ok ? 'success' : 'error'}`}>{msg.text}</p>}
      {canWrite && (
        <div className="span-2">
          <button className="btn btn-primary" disabled={save.isPending}>
            Save control rules
          </button>
        </div>
      )}
    </form>
  );
}
