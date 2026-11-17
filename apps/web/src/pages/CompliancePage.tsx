import { MYANMAR_PACK, Permission, VehicleClass } from '@fms/shared';
import type { ComplianceSettings, RequiredDocument } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { REQ_TONE, Requirement } from '../components/VehicleAssets';
import { api, session } from '../lib/api';
import { formatDate, humanize } from '../lib/format';
import { errorText } from './IncidentsPage';

interface Row {
  vehicle: { id: string; plateNumber: string; vehicleClass: string; assetKind: string; branchId: string | null };
  requirements: Requirement[];
  status: Requirement['status'];
  blocked: boolean;
}
interface Data {
  settings: ComplianceSettings;
  totals: { vehicles: number; compliant: number; blocked: number; missing: number; expired: number; expiring: number; unknown: number };
  vehicles: Row[];
}
const DOC_TYPES = ['REGISTRATION', 'INSURANCE', 'ROAD_TAX', 'PERMIT', 'INSPECTION', 'OTHER'] as const;
const KINDS = ['VEHICLE', 'TRAILER', 'CONTAINER', 'GENERATOR', 'FORKLIFT', 'EQUIPMENT'];

/** Country rule pack: required documents per vehicle, dispatch blocking, legal payload limits. */
export function CompliancePage() {
  const [filter, setFilter] = useState<'' | 'bad' | 'expiring' | 'blocked'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useQuery({ queryKey: ['compliance'], queryFn: () => api<Data>('/compliance') });
  const d = q.data;
  const rows = (d?.vehicles ?? []).filter((r) => r.requirements.length > 0).filter((r) =>
    filter === 'bad' ? r.status === 'MISSING' || r.status === 'EXPIRED' : filter === 'expiring' ? r.status === 'EXPIRING' : filter === 'blocked' ? r.blocked : true,
  );
  const types = d ? d.settings.requirements.map((r) => r.type).filter((t, i, a) => a.indexOf(t) === i) : [];
  const tile = (k: typeof filter, label: string, value: number | undefined, sub: string) => (
    <button key={k} className={`card tile tile-button${filter === k ? ' sel' : ''}`} onClick={() => setFilter(filter === k ? '' : k)} aria-pressed={filter === k}>
      <span className="tile-label">{label}</span>
      <span className="tile-value small">{value ?? '…'}</span>
      <span className="muted small">{sub}</span>
    </button>
  );
  return (
    <>
      <header className="page-head">
        <h1>Compliance</h1>
        {d && (
          <span className={`badge badge-${d.settings.enforceDispatch ? 'ok' : 'muted'}`} title="Settings below">
            Dispatch blocking {d.settings.enforceDispatch ? 'on' : 'off'}
          </span>
        )}
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      <section className="tiles">
        <div className="card tile">
          <span className="tile-label">Compliant</span>
          <span className="tile-value small">{d ? `${d.totals.compliant} of ${d.totals.vehicles}` : '…'}</span>
          <span className="muted small">vehicles with every required document valid</span>
        </div>
        {tile('bad', 'Missing or expired', d ? d.totals.missing + d.totals.expired : undefined, 'documents')}
        {tile('expiring', 'Expiring', d?.totals.expiring, `within ${d?.settings.warnDays ?? 30} days`)}
        {tile('blocked', 'Cannot be dispatched', d?.totals.blocked, d?.settings.enforceDispatch ? 'blocked from assignment and trip start' : 'blocking is off')}
      </section>
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Status</th>
                {types.map((t) => (
                  <th key={t}>{humanize(t)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={types.length + 2} className="muted">
                    Nothing to show.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.vehicle.id}>
                  <td>
                    <Link to={`/vehicles/${r.vehicle.id}`}>{r.vehicle.plateNumber}</Link>
                    <div className="muted small">
                      {humanize(r.vehicle.vehicleClass)}
                      {r.vehicle.assetKind !== 'VEHICLE' && r.vehicle.assetKind !== r.vehicle.vehicleClass ? ` · ${humanize(r.vehicle.assetKind)}` : ''}
                    </div>
                  </td>
                  <td>{r.blocked ? <span className="badge badge-danger">Blocked</span> : <span className={`badge badge-${REQ_TONE[r.status]}`}>{humanize(r.status)}</span>}</td>
                  {types.map((t) => {
                    const x = r.requirements.find((y) => y.type === t);
                    return (
                      <td key={t} title={x?.label}>
                        {x ? (
                          <>
                            <span className={`badge badge-${REQ_TONE[x.status]}`}>{humanize(x.status)}</span>
                            {x.validUntil && <div className="muted small">{formatDate(x.validUntil)}</div>}
                          </>
                        ) : (
                          <span className="muted">n/a</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">The latest document of each type counts. Without an expiry date, validity is the issue date plus the usual renewal period.</p>
      </section>
      {d && session.can(Permission.SETTINGS_WRITE) && <RulesCard s={d.settings} setMsg={setMsg} />}
    </>
  );
}

function RulesCard({ s, setMsg }: { s: ComplianceSettings; setMsg: (m: { ok: boolean; text: string }) => void }) {
  const qc = useQueryClient();
  const [reqs, setReqs] = useState<RequiredDocument[]>(s.requirements);
  const [enforce, setEnforce] = useState(s.enforceDispatch);
  const [warnDays, setWarnDays] = useState(s.warnDays);
  const [payload, setPayload] = useState<Record<string, number>>(s.maxPayloadKg);
  useEffect(() => setReqs(s.requirements), [s.requirements]);
  const save = useMutation({
    mutationFn: () => api('/company/settings', { method: 'PATCH', body: JSON.stringify({ compliance: { requirements: reqs, enforceDispatch: enforce, warnDays, maxPayloadKg: payload } }) }),
    onSuccess: () => (setMsg({ ok: true, text: 'Compliance rules saved.' }), void qc.invalidateQueries({ queryKey: ['compliance'] })),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const set = (i: number, patch: Partial<RequiredDocument>) => setReqs(reqs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const classes = Object.values(VehicleClass);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Rules ({s.country === 'MM' ? 'Myanmar' : s.country})</h2>
        <button className="btn btn-ghost" onClick={() => setReqs(MYANMAR_PACK)}>
          Reset to the Myanmar pack
        </button>
      </div>
      <p className="muted small">
        The Myanmar pack is a starting point. Check the documents and renewal periods against the current RTAD and Ministry of Transport rules before switching on dispatch blocking.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Label</th>
              <th>Asset kinds</th>
              <th>Vehicle classes (none = all)</th>
              <th className="num">Renew (months)</th>
              <th>Blocks dispatch</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reqs.map((r, i) => (
              <tr key={i}>
                <td>
                  <select value={r.type} onChange={(e) => set(i, { type: e.target.value as RequiredDocument['type'] })} aria-label="Document type">
                    {DOC_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {humanize(t)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input value={r.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Label" />
                </td>
                <td>
                  <div className="chips">
                    {KINDS.map((k) => (
                      <button key={k} type="button" className={`chip${r.assetKinds.includes(k) ? ' on' : ''}`} aria-pressed={r.assetKinds.includes(k)} onClick={() => set(i, { assetKinds: toggle(r.assetKinds, k) })}>
                        {humanize(k)}
                      </button>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="chips">
                    {classes.map((c) => (
                      <button key={c} type="button" className={`chip${r.vehicleClasses.includes(c) ? ' on' : ''}`} aria-pressed={r.vehicleClasses.includes(c)} onClick={() => set(i, { vehicleClasses: toggle(r.vehicleClasses, c) })}>
                        {humanize(c)}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="num">
                  <input type="number" min={1} max={120} value={r.renewMonths ?? ''} onChange={(e) => set(i, { renewMonths: e.target.value ? Number(e.target.value) : null })} aria-label="Renewal months" style={{ width: 70 }} />
                </td>
                <td>
                  <input type="checkbox" checked={r.blockDispatch} onChange={(e) => set(i, { blockDispatch: e.target.checked })} aria-label="Blocks dispatch" />
                </td>
                <td>
                  <button className="btn btn-ghost" onClick={() => setReqs(reqs.filter((_, j) => j !== i))} aria-label={`Remove ${r.label}`}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" onClick={() => setReqs([...reqs, { type: 'OTHER', label: 'New requirement', vehicleClasses: [], assetKinds: ['VEHICLE'], renewMonths: 12, blockDispatch: false }])}>
        Add requirement
      </button>
      <h3>Legal payload per class (kg)</h3>
      <p className="muted small">Delivery loads above the legal limit are refused. With a trailer, the trailer's limit is added to the tractor's. Empty = only the technical capacity counts.</p>
      <div className="form-grid">
        {classes.map((c) => (
          <label key={c}>
            {humanize(c)}
            <input
              type="number"
              min={1}
              value={payload[c] ?? ''}
              onChange={(e) => {
                const next = { ...payload };
                if (e.target.value) next[c] = Number(e.target.value);
                else delete next[c];
                setPayload(next);
              }}
            />
          </label>
        ))}
      </div>
      <div className="form-grid">
        <label>
          Warn before expiry (days)
          <input type="number" min={1} max={180} value={warnDays} onChange={(e) => setWarnDays(Number(e.target.value))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
          Block dispatch of vehicles with missing or expired blocking documents
        </label>
      </div>
      <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
        Save rules
      </button>
    </section>
  );
}
