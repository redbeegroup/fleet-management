import { Permission, WarrantyComponent } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, session } from '../lib/api';
import { formatDate, humanize, money } from '../lib/format';
import type { Supplier } from '../lib/types';
import { errorText } from '../pages/IncidentsPage';

interface Position {
  position: string;
  tire: { brand: string | null; size: string | null; condition: string | null; fittedAt: string; cost: number } | null;
  kmSinceFit: number | null;
  treadMm: number | null;
  treadStatus: 'OK' | 'WARN' | 'REPLACE' | 'UNKNOWN';
  kmToMinTread: number | null;
  pressure: number | null;
  pressureStatus: 'OK' | 'LOW' | 'HIGH' | 'UNKNOWN';
  lastCheckAt: string | null;
  overLife: boolean;
  warrantyActive: boolean;
  level: 'ok' | 'warn' | 'critical' | 'unknown';
}
interface Sheet {
  layout: string;
  layouts: { key: string; label: string }[];
  settings: { minTreadMm: number; pressureUnit: string; pressureTarget: number | null };
  positions: Position[];
  removed: { position: string; brand: string | null; kmRun: number; cost: number; costPerKm: number | null; removedAt: string; reason: string }[];
  totals: { cost: number; changes: number };
}

const LEVEL_LABEL = { ok: 'OK', warn: 'Watch', critical: 'Act now', unknown: 'Not checked' };

/** Groups positions into rows: axle 1 at the top, left side then right side, spare last. */
function rows(positions: Position[]) {
  const axles = new Map<string, Position[]>();
  for (const p of positions) {
    const axle = p.position === 'SPARE' ? 'spare' : (/^\d+/.exec(p.position)?.[0] ?? p.position);
    axles.set(axle, [...(axles.get(axle) ?? []), p]);
  }
  const order = (p: string) => ({ LO: 0, L: 1, LI: 2, RI: 3, R: 4, RO: 5 })[p.replace(/^\d+/, '')] ?? 6;
  return [...axles.entries()].map(([axle, ps]) => ({ axle, positions: ps.sort((a, b) => order(a.position) - order(b.position)) }));
}

/** Tire diagram with status per position, and change / rotate / check actions. */
export function VehicleTires({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.MAINTENANCE_WRITE);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<'change' | 'check' | 'rotate' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['tires', vehicleId], queryFn: () => api<Sheet>(`/vehicles/${vehicleId}/tires`) });
  const suppliers = useQuery({ queryKey: ['suppliers', 'TIRES'], queryFn: () => api<Supplier[]>('/suppliers?active=true'), enabled: canWrite });
  const post = useMutation({
    mutationFn: ({ path, b, method = 'POST' }: { path: string; b: unknown; method?: string }) => api(`/vehicles/${vehicleId}/tires/${path}`, { method, body: JSON.stringify(b) }),
    onSuccess: () => (setMode(null), setErr(null), void qc.invalidateQueries({ queryKey: ['tires', vehicleId] })),
    onError: (e) => setErr(errorText(e)),
  });
  const s = q.data;
  if (!s) return null;
  const p = s.positions.find((x) => x.position === sel) ?? null;
  const unit = s.settings.pressureUnit;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    if (mode === 'change')
      post.mutate({
        path: 'changes',
        b: {
          position: sel,
          reason: f.get('reason'),
          brand: f.get('brand') || null,
          size: f.get('size') || null,
          condition: f.get('condition'),
          cost: n('cost') ?? 0,
          supplierId: f.get('supplierId') || null,
          removedTreadMm: n('removedTreadMm'),
          warrantyMonths: n('warrantyMonths'),
          warrantyKm: n('warrantyKm'),
          ...(n('odometerKm') != null && { odometerKm: n('odometerKm') }),
        },
      });
    else if (mode === 'check') post.mutate({ path: 'checks', b: { readings: [{ position: sel, treadMm: n('treadMm'), pressure: n('pressure') }] } });
    else post.mutate({ path: 'rotate', b: { a: sel, b: f.get('other') } });
  }
  return (
    <section className="card">
      <div className="card-head">
        <h2>Tires</h2>
        <div className="actions">
          {canWrite && session.can(Permission.VEHICLE_WRITE) ? (
            <select aria-label="Tire layout" value={s.layout} onChange={(e) => post.mutate({ path: 'layout', b: { layout: e.target.value }, method: 'PATCH' })}>
              {s.layouts.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted small">{s.layouts.find((l) => l.key === s.layout)?.label}</span>
          )}
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="tire-sheet">
        <div className="tire-diagram" aria-label="Tire positions">
          {rows(s.positions).map((r) => (
            <div className={`tire-axle${r.axle === 'spare' ? ' spare' : ''}`} key={r.axle}>
              {r.positions.map((t, i) => (
                <button
                  type="button"
                  key={t.position}
                  className={`tire tire-${t.level}${sel === t.position ? ' sel' : ''}${r.axle !== 'spare' && i === Math.floor(r.positions.length / 2) - 1 ? ' gap-after' : ''}`}
                  onClick={() => (setSel(t.position), setMode(null))}
                  aria-pressed={sel === t.position}
                  title={`${t.position}: ${LEVEL_LABEL[t.level]}`}
                >
                  <strong>{t.position}</strong>
                  <span>{t.treadMm != null ? `${t.treadMm} mm` : '—'}</span>
                  <span className="small">{LEVEL_LABEL[t.level]}</span>
                </button>
              ))}
            </div>
          ))}
          <p className="muted small">Front at the top. Minimum tread {s.settings.minTreadMm} mm{s.settings.pressureTarget ? ` · pressure ${s.settings.pressureTarget} ${unit}` : ''}.</p>
        </div>
        <div className="tire-detail">
          {!p ? (
            <p className="muted">Select a position. {s.totals.changes} tire changes so far, {money(s.totals.cost)} in total.</p>
          ) : (
            <>
              <h3>Position {p.position}</h3>
              <dl className="facts">
                <dt>Tire</dt>
                <dd>{p.tire ? [p.tire.brand, p.tire.size, p.tire.condition && humanize(p.tire.condition)].filter(Boolean).join(' · ') || 'fitted' : 'none recorded'}</dd>
                <dt>Fitted</dt>
                <dd>{p.tire ? `${formatDate(p.tire.fittedAt)} · ${p.kmSinceFit?.toLocaleString()} km ago${p.overLife ? ' (beyond expected life)' : ''}` : '—'}</dd>
                <dt>Tread</dt>
                <dd>
                  {p.treadMm != null ? `${p.treadMm} mm · ${humanize(p.treadStatus)}` : '—'}
                  {p.kmToMinTread != null && <span className="muted"> · about {p.kmToMinTread.toLocaleString()} km to the minimum</span>}
                </dd>
                <dt>Pressure</dt>
                <dd>{p.pressure != null ? `${p.pressure} ${unit} · ${humanize(p.pressureStatus)}` : '—'}</dd>
                <dt>Last check</dt>
                <dd>{formatDate(p.lastCheckAt)}</dd>
                <dt>Warranty</dt>
                <dd>{p.warrantyActive ? 'running' : '—'}</dd>
              </dl>
              {canWrite && (
                <div className="actions">
                  <button className="btn" onClick={() => setMode('check')}>
                    Record check
                  </button>
                  <button className="btn" onClick={() => setMode('change')}>
                    Change tire
                  </button>
                  <button className="btn" onClick={() => setMode('rotate')}>
                    Swap with…
                  </button>
                </div>
              )}
              {mode && (
                <form className="form-grid" onSubmit={submit}>
                  {mode === 'check' && (
                    <>
                      <label>
                        Tread (mm)
                        <input name="treadMm" type="number" min={0} max={40} step="0.1" />
                      </label>
                      <label>
                        Pressure ({unit})
                        <input name="pressure" type="number" min={0} step="0.5" />
                      </label>
                    </>
                  )}
                  {mode === 'rotate' && (
                    <label className="span-2">
                      Swap {p.position} with
                      <select name="other" required>
                        {s.positions
                          .filter((x) => x.position !== p.position)
                          .map((x) => (
                            <option key={x.position} value={x.position}>
                              {x.position}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {mode === 'change' && (
                    <>
                      <label>
                        Reason
                        <select name="reason" defaultValue={p.tire ? 'WORN' : 'NEW_FIT'}>
                          {['NEW_FIT', 'WORN', 'PUNCTURE', 'DAMAGE', 'OTHER'].map((r) => (
                            <option key={r} value={r}>
                              {humanize(r)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        New tire
                        <select name="condition" defaultValue="NEW">
                          <option value="NEW">New</option>
                          <option value="RETREAD">Retread</option>
                          <option value="USED">Used</option>
                        </select>
                      </label>
                      <label>
                        Brand
                        <input name="brand" defaultValue={p.tire?.brand ?? ''} />
                      </label>
                      <label>
                        Size
                        <input name="size" defaultValue={p.tire?.size ?? ''} placeholder="e.g. 8.25R16" />
                      </label>
                      <label>
                        Cost
                        <input name="cost" type="number" min={0} step="any" />
                      </label>
                      <label>
                        Supplier
                        <select name="supplierId" defaultValue="">
                          <option value="">—</option>
                          {suppliers.data?.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Odometer (km)
                        <input name="odometerKm" type="number" min={0} step="any" placeholder="current" />
                      </label>
                      <label>
                        Tread of the old tire (mm)
                        <input name="removedTreadMm" type="number" min={0} max={40} step="0.1" />
                      </label>
                      <label>
                        Warranty (months)
                        <input name="warrantyMonths" type="number" min={0} />
                      </label>
                      <label>
                        Warranty (km)
                        <input name="warrantyKm" type="number" min={0} />
                      </label>
                    </>
                  )}
                  <div className="span-2 actions">
                    <button className="btn btn-primary" disabled={post.isPending}>
                      Save
                    </button>
                    <button type="button" className="btn" onClick={() => setMode(null)}>
                      Close
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
      {s.removed.length > 0 && (
        <details>
          <summary className="muted small">Tires taken off ({s.removed.length})</summary>
          <table>
            <tbody>
              {s.removed
                .slice()
                .reverse()
                .map((r, i) => (
                  <tr key={i}>
                    <td>{formatDate(r.removedAt)}</td>
                    <td>{r.position}</td>
                    <td>{r.brand ?? '—'}</td>
                    <td className="num">{r.kmRun.toLocaleString()} km</td>
                    <td className="num">{r.costPerKm != null ? `${r.costPerKm} / km` : '—'}</td>
                    <td>{humanize(r.reason)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

interface Warranty {
  id: string;
  component: string;
  label: string | null;
  startDate: string;
  endDate: string | null;
  endKm: string | null;
  supplierId: string | null;
}

/** Vehicle and component warranties. */
export function VehicleWarranties({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.MAINTENANCE_WRITE);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['warranties', vehicleId], queryFn: () => api<Warranty[]>(`/warranties?vehicleId=${vehicleId}`) });
  const suppliers = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api<Supplier[]>('/suppliers'), enabled: canWrite });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['warranties', vehicleId] });
  const create = useMutation({
    mutationFn: (b: unknown) => api(`/vehicles/${vehicleId}/warranties`, { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => (setAdding(false), setErr(null), refresh()),
    onError: (e) => setErr(errorText(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/warranties/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Warranties</h2>
        {canWrite && !adding && (
          <button className="link" onClick={() => setAdding(true)}>
            Add warranty
          </button>
        )}
      </div>
      {err && <p className="error">{err}</p>}
      {list.data?.length === 0 && !adding && <p className="muted">No warranty recorded.</p>}
      <table>
        <tbody>
          {list.data?.map((w) => {
            const ended = !!w.endDate && w.endDate.slice(0, 10) < today;
            return (
              <tr key={w.id} className={ended ? 'muted' : ''}>
                <td>{humanize(w.component)}{w.label ? `: ${w.label}` : ''}</td>
                <td>from {formatDate(w.startDate)}</td>
                <td>{[w.endDate && `until ${formatDate(w.endDate)}`, w.endKm && `${Number(w.endKm).toLocaleString()} km`].filter(Boolean).join(' / ')}</td>
                <td>{ended ? <span className="badge badge-muted">ended</span> : <span className="badge badge-ok">active</span>}</td>
                <td>
                  {canWrite && (
                    <button className="link danger" onClick={() => confirm('Remove this warranty?') && remove.mutate(w.id)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {adding && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.mutate({
              component: f.get('component'),
              label: f.get('label') || null,
              supplierId: f.get('supplierId') || null,
              startDate: f.get('startDate'),
              endDate: f.get('endDate') || null,
              endKm: f.get('endKm') ? Number(f.get('endKm')) : null,
              terms: f.get('terms') || null,
            });
          }}
        >
          <label>
            Covers
            <select name="component" defaultValue="WHOLE_VEHICLE">
              {Object.keys(WarrantyComponent).map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Label
            <input name="label" placeholder="e.g. Powertrain, Battery (extended)" />
          </label>
          <label>
            From
            <input name="startDate" type="date" required />
          </label>
          <label>
            Until
            <input name="endDate" type="date" />
          </label>
          <label>
            Or until (km)
            <input name="endKm" type="number" min={0} />
          </label>
          <label>
            Provider
            <select name="supplierId" defaultValue="">
              <option value="">—</option>
              {suppliers.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Terms
            <input name="terms" />
          </label>
          <div className="span-2 actions">
            <button className="btn btn-primary" disabled={create.isPending}>
              Save
            </button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              Close
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
