import { OwnershipType, VehicleClass } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { humanize } from '../lib/format';
import type { Branch, Vehicle } from '../lib/types';

/** Create (/vehicles/new) or edit (/vehicles/:id/edit) a vehicle. */
export function VehicleFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const existing = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => api<Vehicle>(`/vehicles/${id}`),
    enabled: editing,
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Vehicle>(editing ? `/vehicles/${id}` : '/vehicles', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (v) => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      void qc.invalidateQueries({ queryKey: ['vehicle', v.id] });
      navigate(`/vehicles/${v.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body.errors) {
        setError(err.body.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      } else setError(err.message);
    },
  });

  if (editing && !existing.data) return <p className="muted">Loading…</p>;
  const v = existing.data;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => (f.get(k) as string)?.trim() || null;
    const num = (k: string) => (str(k) ? Number(str(k)) : null);
    save.mutate({
      plateNumber: str('plateNumber'),
      vin: str('vin'),
      make: str('make'),
      model: str('model'),
      year: num('year'),
      vehicleClass: str('vehicleClass'),
      ownership: str('ownership'),
      fuelType: str('fuelType'),
      capacityKg: num('capacityKg'),
      capacityM3: num('capacityM3'),
      odometerKm: num('odometerKm') ?? 0,
      branchId: str('branchId'),
      gpsDeviceId: str('gpsDeviceId'),
      speedLimitKmh: num('speedLimitKmh'),
      tankCapacityL: num('tankCapacityL'),
      acquiredAt: str('acquiredAt'),
      notes: str('notes'),
    });
  }

  return (
    <>
      <header className="page-head">
        <h1>{editing ? `Edit ${v?.plateNumber}` : 'Register vehicle'}</h1>
      </header>
      <form className="card form-grid" onSubmit={submit}>
        <label>
          Plate number *
          <input name="plateNumber" required defaultValue={v?.plateNumber} />
        </label>
        <label>
          VIN
          <input name="vin" defaultValue={v?.vin ?? ''} />
        </label>
        <label>
          Make *
          <input name="make" required defaultValue={v?.make} />
        </label>
        <label>
          Model *
          <input name="model" required defaultValue={v?.model} />
        </label>
        <label>
          Year
          <input name="year" type="number" min={1950} max={2100} defaultValue={v?.year ?? ''} />
        </label>
        <label>
          Class *
          <select name="vehicleClass" required defaultValue={v?.vehicleClass ?? 'TRUCK'}>
            {Object.values(VehicleClass).map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ownership
          <select name="ownership" defaultValue={v?.ownership ?? 'OWNED'}>
            {Object.values(OwnershipType).map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fuel type
          <input name="fuelType" placeholder="Diesel" defaultValue={v?.fuelType ?? ''} />
        </label>
        <label>
          Capacity (kg)
          <input name="capacityKg" type="number" min={0} step="any" defaultValue={v?.capacityKg ?? ''} />
        </label>
        <label>
          Capacity (m³)
          <input name="capacityM3" type="number" min={0} step="any" defaultValue={v?.capacityM3 ?? ''} />
        </label>
        <label>
          Odometer (km)
          <input name="odometerKm" type="number" min={0} step="any" defaultValue={v ? Number(v.odometerKm) : ''} />
        </label>
        <label>
          Acquired on
          <input name="acquiredAt" type="date" defaultValue={v?.acquiredAt?.slice(0, 10) ?? ''} />
        </label>
        <label>
          Branch
          <select name="branchId" defaultValue={v?.branchId ?? ''}>
            <option value="">—</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          GPS device ID (Watch Tower)
          <input name="gpsDeviceId" defaultValue={v?.gpsDeviceId ?? ''} />
        </label>
        <label>
          Speed limit override (km/h)
          <input name="speedLimitKmh" type="number" min={10} max={200} placeholder="Company default" defaultValue={v?.speedLimitKmh ?? ''} />
        </label>
        <label>
          Fuel tank capacity (L)
          <input name="tankCapacityL" type="number" min={1} step="any" defaultValue={v?.tankCapacityL ?? ''} />
        </label>
        <label className="span-2">
          Notes
          <textarea name="notes" rows={3} defaultValue={v?.notes ?? ''} />
        </label>
        {error && <p className="error span-2">{error}</p>}
        <div className="span-2 actions">
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Save vehicle'}
          </button>
        </div>
      </form>
    </>
  );
}
