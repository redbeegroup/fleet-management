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
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<CompanySettings>('/company/settings'),
  });
  const save = useMutation({
    mutationFn: (telematics: Record<string, number>) =>
      api<CompanySettings>('/company/settings', {
        method: 'PATCH',
        body: JSON.stringify({ telematics }),
      }),
    onSuccess: (d) => {
      qc.setQueryData(['settings'], d);
      setMsg({ ok: true, text: 'Saved. New thresholds apply to the next positions received.' });
    },
    onError: (e) =>
      setMsg({
        ok: false,
        text:
          e instanceof ApiError && e.body.errors
            ? e.body.errors.map((x) => `${x.path}: ${x.message}`).join('; ')
            : e.message,
      }),
  });
  const savePolicy = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<CompanySettings>('/company/settings', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (d) => {
      qc.setQueryData(['settings'], d);
      setPolicyMsg({ ok: true, text: 'Saved.' });
    },
    onError: (e) =>
      setPolicyMsg({
        ok: false,
        text:
          e instanceof ApiError && e.body.errors
            ? e.body.errors.map((x) => `${x.path}: ${x.message}`).join('; ')
            : e.message,
      }),
  });
  const [policyMsg, setPolicyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return <p className="muted">Loading…</p>;
  const t = data.telematics;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate(
      Object.fromEntries(
        ['speedLimitKmh', 'overspeedHysteresisKmh', 'idleMinutes', 'offlineMinutes'].map((k) => [
          k,
          Number(f.get(k)),
        ]),
      ),
    );
  }

  function submitPolicy(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => Number(f.get(k));
    savePolicy.mutate({
      safety: { alertBelow: n('alertBelow'), minDistanceKm: n('minDistanceKm') },
      approvals: Object.fromEntries(
        ['workOrderAbove', 'expenseAbove', 'fuelAbove', 'claimAbove', 'secondApproverAbove'].map(
          (k) => [k, f.get(k) ? Number(f.get(k)) : null],
        ),
      ),
      inspections: {
        requirePreTrip: f.get('requirePreTrip') === 'on',
        preTripValidHours: n('preTripValidHours'),
      },
      incentives: {
        safetyBonusEnabled: f.get('safetyBonusEnabled') === 'on',
        safetyBonusMinScore: n('safetyBonusMinScore'),
        safetyBonusAmount: n('safetyBonusAmount'),
        trainingAlertDays: n('trainingAlertDays'),
      },
    });
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
          <input
            name="speedLimitKmh"
            type="number"
            min={10}
            max={200}
            defaultValue={t.speedLimitKmh}
            disabled={!canWrite}
          />
          <small className="muted">Vehicles can override this on their edit page.</small>
        </label>
        <label>
          Overspeed hysteresis (km/h)
          <input
            name="overspeedHysteresisKmh"
            type="number"
            min={0}
            max={30}
            defaultValue={t.overspeedHysteresisKmh}
            disabled={!canWrite}
          />
          <small className="muted">
            An episode ends once speed falls this far below the limit.
          </small>
        </label>
        <label>
          Idling threshold (minutes)
          <input
            name="idleMinutes"
            type="number"
            min={1}
            max={240}
            defaultValue={t.idleMinutes}
            disabled={!canWrite}
          />
          <small className="muted">
            Engine on and stationary for this long raises an idling event.
          </small>
        </label>
        <label>
          GPS offline after (minutes)
          <input
            name="offlineMinutes"
            type="number"
            min={5}
            max={1440}
            defaultValue={t.offlineMinutes}
            disabled={!canWrite}
          />
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
      <form className="card form-grid" onSubmit={submitPolicy}>
        <h2 className="span-2">Safety, inspections & incentives</h2>
        <label>
          Flag drivers scoring below
          <input
            name="alertBelow"
            type="number"
            min={0}
            max={100}
            defaultValue={data.safety.alertBelow}
            disabled={!canWrite}
          />
        </label>
        <label>
          Minimum distance for a safety score (km)
          <input
            name="minDistanceKm"
            type="number"
            min={0}
            max={10000}
            defaultValue={data.safety.minDistanceKm}
            disabled={!canWrite}
          />
        </label>
        <label className="check">
          <input
            name="requirePreTrip"
            type="checkbox"
            defaultChecked={data.inspections.requirePreTrip}
            disabled={!canWrite}
          />{' '}
          Require a pre-trip inspection before a trip starts
        </label>
        <label>
          Pre-trip inspection valid for (hours)
          <input
            name="preTripValidHours"
            type="number"
            min={1}
            max={72}
            defaultValue={data.inspections.preTripValidHours}
            disabled={!canWrite}
          />
        </label>
        <label className="check">
          <input
            name="safetyBonusEnabled"
            type="checkbox"
            defaultChecked={data.incentives.safetyBonusEnabled}
            disabled={!canWrite}
          />{' '}
          Propose a monthly safety bonus automatically
        </label>
        <label>
          Safety bonus from score
          <input
            name="safetyBonusMinScore"
            type="number"
            min={0}
            max={100}
            defaultValue={data.incentives.safetyBonusMinScore}
            disabled={!canWrite}
          />
        </label>
        <label>
          Safety bonus amount
          <input
            name="safetyBonusAmount"
            type="number"
            min={0}
            step="any"
            defaultValue={data.incentives.safetyBonusAmount}
            disabled={!canWrite}
          />
        </label>
        <label>
          Alert before training certificates expire (days)
          <input
            name="trainingAlertDays"
            type="number"
            min={1}
            max={180}
            defaultValue={data.incentives.trainingAlertDays}
            disabled={!canWrite}
          />
        </label>
        <h3 className="span-2">Approval limits</h3>
        <p className="span-2 muted">
          Amounts above a limit need approval by a fleet manager or admin (never the person who
          entered them). Leave empty for no approval.
        </p>
        {(
          [
            ['workOrderAbove', 'Work orders above'],
            ['expenseAbove', 'Expenses above'],
            ['fuelAbove', 'Fuel records above'],
            ['claimAbove', 'Insurance claims above'],
            ['secondApproverAbove', 'Two approvers from'],
          ] as const
        ).map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              name={k}
              type="number"
              min={0}
              step="any"
              defaultValue={data.approvals[k] ?? ''}
              disabled={!canWrite}
              placeholder="no limit"
            />
          </label>
        ))}
        {policyMsg && (
          <p className={`span-2 ${policyMsg.ok ? 'success' : 'error'}`}>{policyMsg.text}</p>
        )}
        {canWrite && (
          <div className="span-2 actions">
            <button className="btn btn-primary" disabled={savePolicy.isPending}>
              Save
            </button>
          </div>
        )}
      </form>
      <section className="card">
        <h2>Licence rules for dispatch</h2>
        <p className="muted">
          Myanmar licence categories required to assign a driver to each vehicle class
          {data.dispatch.enforceLicenceClass ? '' : ' (currently not enforced)'}. Company vehicles
          are treated as commercial, so cars, vans and pickups need ဃ (D) or င (E). Learner (သ) and
          conductor (စ) permits never qualify.
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
                <td>
                  {codes.length ? (
                    licenceShort(codes.join(','))
                  ) : (
                    <span className="muted">any valid licence</span>
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
