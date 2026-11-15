import { checkLoad, LIMIT_LABEL, limitsOf, type Limit, type LoadTotals } from '@fms/shared';
import type { VehicleCap } from '../lib/types';

const ORDER: Limit[] = ['kg', 'm3', 'cases', 'pallets', 'stops'];
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Capacity bars for a vehicle and a load; red when a limit is exceeded. */
export function CapBars({
  vehicle,
  totals,
  defaultMaxStops,
}: {
  vehicle: VehicleCap;
  totals: LoadTotals;
  defaultMaxStops: number | null;
}) {
  const limits = limitsOf(vehicle, defaultMaxStops);
  const used: Record<Limit, number> = {
    kg: totals.kg,
    m3: totals.m3,
    cases: totals.cases,
    pallets: totals.pallets,
    stops: totals.stops,
  };
  const check = checkLoad(vehicle, totals, defaultMaxStops);
  const shown = ORDER.filter((k) => limits[k] != null);
  return (
    <div className="cap-bars">
      {shown.length === 0 && (
        <span className="muted small">No capacity limits recorded for this vehicle.</span>
      )}
      {shown.map((k) => {
        const cap = limits[k]!;
        const pct = cap > 0 ? Math.min(100, (used[k] / cap) * 100) : 100;
        const over = used[k] > cap;
        return (
          <div key={k} className="cap-row" title={LIMIT_LABEL[k]}>
            <span className="cap-label">{LIMIT_LABEL[k]}</span>
            <span className="bar-track">
              <span
                className={`bar-fill ${over ? 'over' : pct > 85 ? 'near' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className={`num ${over ? 'text-danger' : ''}`}>
              {fmt(used[k])} / {fmt(cap)}
            </span>
          </div>
        );
      })}
      {check.warnings.map((w) => (
        <span key={w} className="muted small">
          {w}
        </span>
      ))}
    </div>
  );
}
