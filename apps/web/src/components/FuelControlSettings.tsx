import { Permission } from '@fms/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, session } from '../lib/api';
import type { CompanySettings } from '../lib/types';
import { errorText } from '../pages/IncidentsPage';

/** Settings: fuel checks, fuel cards, fuel level sensor and engine diagnostics thresholds. */
export function FuelControlSettings({ settings }: { settings: CompanySettings }) {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.SETTINGS_WRITE);
  const f = settings.fuelControl;
  const d = settings.diagnostics;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<CompanySettings>('/company/settings', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (r) => {
      qc.setQueryData(['settings'], r);
      setMsg({ ok: true, text: 'Saved.' });
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget);
    const num = (k: string) => Number(v.get(k));
    save.mutate({
      fuelControl: {
        locationMaxM: num('locationMaxM'),
        kmMismatchPct: num('kmMismatchPct'),
        sensorEnabled: v.get('sensorEnabled') === 'on',
        refillMinL: num('refillMinL'),
        dropMinL: num('dropMinL'),
        refillToleranceL: num('refillToleranceL'),
        matchHours: num('matchHours'),
        matchLitresPct: num('matchLitresPct'),
        matchAmountPct: num('matchAmountPct'),
        cardSyncEnabled: v.get('cardSyncEnabled') === 'on',
        cardSyncProvider: String(v.get('cardSyncProvider') || 'API').toUpperCase(),
      },
      diagnostics: {
        coolantMaxC: num('coolantMaxC'),
        batteryMinV: num('batteryMinV'),
        autoRepairCodes: String(v.get('autoRepairCodes') ?? '')
          .split(/[\s,;]+/)
          .map((x) => x.trim().toUpperCase())
          .filter(Boolean),
      },
    });
  }
  const field = (name: string, label: string, value: number, attrs: Record<string, number | string> = {}) => (
    <label>
      {label}
      <input name={name} type="number" step="any" defaultValue={value} disabled={!canWrite} {...attrs} />
    </label>
  );
  return (
    <form className="card form-grid" onSubmit={submit}>
      <h2 className="span-2">Fuel checks, fuel cards & engine diagnostics</h2>
      {field('locationMaxM', 'Fill location: vehicle farther than (m)', f.locationMaxM, { min: 100, max: 20000 })}
      {field('kmMismatchPct', 'Odometer vs GPS km difference (%)', f.kmMismatchPct, { min: 5, max: 100 })}
      <h3 className="span-2">Fuel card matching</h3>
      {field('matchHours', 'Time window (hours)', f.matchHours, { min: 0.5, max: 48 })}
      {field('matchAmountPct', 'Amount tolerance (%)', f.matchAmountPct, { min: 0, max: 50 })}
      {field('matchLitresPct', 'Litres tolerance (%)', f.matchLitresPct, { min: 0, max: 50 })}
      <label className="check">
        <input name="cardSyncEnabled" type="checkbox" defaultChecked={f.cardSyncEnabled} disabled={!canWrite} /> Pull transactions from the provider API every hour
      </label>
      <label>
        Provider name for API transactions
        <input name="cardSyncProvider" defaultValue={f.cardSyncProvider} disabled={!canWrite} />
      </label>
      <h3 className="span-2">Fuel level sensor (GPS device)</h3>
      <label className="check span-2">
        <input name="sensorEnabled" type="checkbox" defaultChecked={f.sensorEnabled} disabled={!canWrite} /> Detect refills and fuel drops from the tank sensor
      </label>
      {field('refillMinL', 'Refill: rise of at least (L)', f.refillMinL, { min: 2, max: 500 })}
      {field('dropMinL', 'Drop while parked: at least (L)', f.dropMinL, { min: 2, max: 500 })}
      {field('refillToleranceL', 'Recorded vs sensor tolerance (L)', f.refillToleranceL, { min: 0, max: 100 })}
      <h3 className="span-2">Engine diagnostics</h3>
      {field('coolantMaxC', 'Coolant too hot above (°C)', d.coolantMaxC, { min: 60, max: 150 })}
      {field('batteryMinV', 'Battery low below (V, engine off)', d.batteryMinV, { min: 5, max: 30 })}
      <label className="span-2">
        Trouble codes that open a repair request automatically (codes or prefixes, e.g. P03 P0420)
        <input name="autoRepairCodes" defaultValue={d.autoRepairCodes.join(' ')} disabled={!canWrite} />
      </label>
      {msg && <p className={`span-2 ${msg.ok ? 'success' : 'error'}`}>{msg.text}</p>}
      {canWrite && (
        <div className="span-2">
          <button className="btn btn-primary" disabled={save.isPending}>
            Save fuel & diagnostics rules
          </button>
        </div>
      )}
    </form>
  );
}
