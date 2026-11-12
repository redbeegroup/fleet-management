import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { humanize } from '../lib/format';
import type { Availability } from '../lib/types';

interface Props {
  from: string; // ISO
  to: string; // ISO
  vehicleId: string;
  driverId: string;
  excludeTripId?: string;
  onChange: (v: { vehicleId: string; driverId: string }) => void;
}

/** Vehicle + driver selects that show who is free for the window, and why not. */
export function AssignmentPicker({ from, to, vehicleId, driverId, excludeTripId, onChange }: Props) {
  const valid = from && to && new Date(to) > new Date(from);
  const params = new URLSearchParams({ from, to });
  if (excludeTripId) params.set('excludeTripId', excludeTripId);
  if (vehicleId) params.set('vehicleId', vehicleId);
  const { data, isFetching } = useQuery({
    queryKey: ['availability', params.toString()],
    queryFn: () => api<Availability>(`/dispatch/availability?${params}`),
    enabled: Boolean(valid),
  });
  if (!valid) return <p className="muted span-2">Choose a valid time window to see available vehicles and drivers.</p>;
  const driver = data?.drivers.find((d) => d.id === driverId);
  const vehicle = data?.vehicles.find((v) => v.id === vehicleId);

  return (
    <>
      <label>
        Vehicle {isFetching && <span className="muted">(checking…)</span>}
        <select value={vehicleId} onChange={(e) => onChange({ vehicleId: e.target.value, driverId })}>
          <option value="">— not yet —</option>
          {data?.vehicles.map((v) => (
            <option key={v.id} value={v.id} disabled={!v.available}>
              {v.plateNumber} · {humanize(v.vehicleClass)} {v.make} {v.model}
              {v.available ? '' : ` — ${v.reasons[0]}`}
            </option>
          ))}
        </select>
        {vehicle && !vehicle.available && <small className="error">{vehicle.reasons.join('; ')}</small>}
      </label>
      <label>
        Driver
        <select value={driverId} onChange={(e) => onChange({ vehicleId, driverId: e.target.value })}>
          <option value="">— not yet —</option>
          {data?.drivers.map((d) => (
            <option key={d.id} value={d.id} disabled={!d.available}>
              {d.fullName} ({d.employeeNo}) · licence {d.licenceClasses.join(', ') || 'none'}
              {d.onDuty ? ' · on duty' : ''}
              {d.available ? '' : ` — ${d.reasons[0]}`}
            </option>
          ))}
        </select>
        {driver && !driver.available && <small className="error">{driver.reasons.join('; ')}</small>}
      </label>
    </>
  );
}
