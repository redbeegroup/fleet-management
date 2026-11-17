import { DisposalMethod, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, session, uploadFile } from '../lib/api';
import { formatDate, humanize, money } from '../lib/format';
import { errorText } from '../pages/IncidentsPage';

interface Life {
  currency: string;
  vehicle: { id: string; status: string };
  timeline: { at: string; event: string }[];
  lifetime: { from: string; to: string; total: number; km: number; perKm: number | null; byCategory: Record<string, number>; partial: boolean };
  bookValue: number | null;
  advice: { advice: 'REPLACE_NOW' | 'PLAN' | 'OK'; reasons: string[]; economicLife: { years: number; projected: boolean } | null; replacementPlannedFor: string | null } | null;
  disposal: { method: string; buyer: string | null; saleValue: string; bookValue: string | null; gainLoss: string | null; disposedAt: string } | null;
}
const TONE = { REPLACE_NOW: ['Replace', 'danger'], PLAN: ['Plan replacement', 'warn'], OK: ['OK', 'ok'] } as const;

/** Lifecycle on the vehicle page: timeline, lifetime cost, replacement advice, disposal. */
export function VehicleLifecycle({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient();
  const canDispose = session.can(Permission.VEHICLE_WRITE) && session.can(Permission.COST_WRITE);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['vehicle-life', vehicleId], queryFn: () => api<Life>(`/vehicles/${vehicleId}/lifecycle`), enabled: session.can(Permission.COST_READ) });
  const dispose = useMutation({
    mutationFn: (b: unknown) => api(`/vehicles/${vehicleId}/dispose`, { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => (setOpen(false), setErr(null), void qc.invalidateQueries()),
    onError: (e) => setErr(errorText(e)),
  });
  const l = q.data;
  if (!l) return null;
  const cats = Object.entries(l.lifetime.byCategory).sort((a, b) => b[1] - a[1]);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Lifecycle</h2>
        {l.advice && <span className={`badge badge-${TONE[l.advice.advice][1]}`}>{TONE[l.advice.advice][0]}</span>}
      </div>
      {err && <p className="error">{err}</p>}
      <div className="grid-2">
        <dl className="facts">
          {l.timeline.map((t) => (
            <span key={t.event} style={{ display: 'contents' }}>
              <dt>{t.event}</dt>
              <dd>{formatDate(t.at)}</dd>
            </span>
          ))}
          <dt>Book value</dt>
          <dd>{l.bookValue != null ? money(l.bookValue) : '—'}</dd>
          {l.advice?.economicLife && (
            <>
              <dt>Economic life</dt>
              <dd>
                {l.advice.economicLife.years} years{l.advice.economicLife.projected ? ' (projected)' : ''}
              </dd>
            </>
          )}
          {l.disposal && (
            <>
              <dt>Disposal</dt>
              <dd>
                {humanize(l.disposal.method)}
                {l.disposal.buyer ? ` to ${l.disposal.buyer}` : ''} · {money(l.disposal.saleValue)}
                {l.disposal.gainLoss != null && ` (${Number(l.disposal.gainLoss) >= 0 ? 'gain' : 'loss'} ${money(Math.abs(Number(l.disposal.gainLoss)))})`}
              </dd>
            </>
          )}
        </dl>
        <div>
          <p>
            <strong>{money(l.lifetime.total)}</strong> over {l.lifetime.km.toLocaleString()} km
            {l.lifetime.perKm != null && <> · {money(l.lifetime.perKm)} per km</>}
          </p>
          <p className="muted small">
            {formatDate(l.lifetime.from)} – {formatDate(l.lifetime.to)}
            {l.lifetime.partial ? ' (last 3 years)' : ''}: {cats.map(([k, v]) => `${humanize(k)} ${money(v)}`).join(' · ') || 'no costs'}
          </p>
          {l.advice && l.advice.reasons.length > 0 && (
            <ul className="small">
              {l.advice.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {canDispose && l.vehicle.status !== 'DISPOSED' && !open && (
        <button className="link danger" onClick={() => setOpen(true)}>
          Dispose of this vehicle…
        </button>
      )}
      {open && (
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const file = f.get('file') as File | null;
            if (!confirm('Dispose of this vehicle? It leaves the active fleet; this cannot be undone.')) return;
            dispose.mutate({
              disposedAt: f.get('disposedAt'),
              method: f.get('method'),
              buyer: f.get('buyer') || null,
              saleValue: Number(f.get('saleValue') || 0),
              odometerKm: f.get('odometerKm') ? Number(f.get('odometerKm')) : null,
              reason: f.get('reason') || null,
              ...(file?.size ? { fileId: (await uploadFile(file)).id } : {}),
            });
          }}
        >
          <label>
            Date
            <input name="disposedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </label>
          <label>
            How
            <select name="method" defaultValue="SALE">
              {Object.keys(DisposalMethod).map((m) => (
                <option key={m} value={m}>
                  {humanize(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Buyer / receiver
            <input name="buyer" />
          </label>
          <label>
            Sale value ({l.currency})
            <input name="saleValue" type="number" min={0} step="any" />
          </label>
          <label>
            Odometer (km)
            <input name="odometerKm" type="number" min={0} step="any" />
          </label>
          <label>
            Sale document
            <input name="file" type="file" accept="image/*,application/pdf" />
          </label>
          <label className="span-2">
            Reason
            <input name="reason" />
          </label>
          <p className="muted small span-2">Open trips and work orders must be closed first. The gain or loss is the sale value minus the book value on that day.</p>
          <div className="span-2 actions">
            <button className="btn btn-danger" disabled={dispose.isPending}>
              Dispose
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
