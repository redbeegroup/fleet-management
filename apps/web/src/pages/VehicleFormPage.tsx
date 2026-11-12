import { OwnershipType, VehicleClass } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { humanize } from '../lib/format';
import type { Branch, Vehicle } from '../lib/types';

export function VehicleFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Vehicle>('/vehicles', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (v) => {
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      navigate(`/vehicles/${v.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body.errors) {
        setError(err.body.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      } else setError(err.message);
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => (f.get(k) as string)?.trim() || null;
    const num = (k: string) => (str(k) ? Number(str(k)) : null);
    create.mutate({
      plateNumber: str('plateNumber'),
      vin: str('vin'),
      make: str('make'),
      model: str('model'),
      year: num('year'),
      vehicleClass: str('vehicleClass'),
      ownership: str('ownership'),
      fuelType: str('fuelType'),
      capacityKg: num('capacityKg'),
      odometerKm: num('odometerKm') ?? 0,
      branchId: str('branchId'),
      gpsDeviceId: str('gpsDeviceId'),
    });
  }

  return (
    <>
      <header className="page-head">
        <h1>Register vehicle</h1>
      </header>
      <form className="card form-grid" onSubmit={submit}>
        <label>
          Plate number *
          <input name="plateNumber" required />
        </label>
        <label>
          VIN
          <input name="vin" />
        </label>
        <label>
          Make *
          <input name="make" required />
        </label>
        <label>
          Model *
          <input name="model" required />
        </label>
        <label>
          Year
          <input name="year" type="number" min={1950} max={2100} />
        </label>
        <label>
          Class *
          <select name="vehicleClass" required defaultValue="TRUCK">
            {Object.values(VehicleClass).map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ownership
          <select name="ownership" defaultValue="OWNED">
            {Object.values(OwnershipType).map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fuel type
          <input name="fuelType" placeholder="Diesel" />
        </label>
        <label>
          Capacity (kg)
          <input name="capacityKg" type="number" min={0} />
        </label>
        <label>
          Odometer (km)
          <input name="odometerKm" type="number" min={0} />
        </label>
        <label>
          Branch
          <select name="branchId" defaultValue="">
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
          <input name="gpsDeviceId" />
        </label>
        {error && <p className="error span-2">{error}</p>}
        <div className="span-2 actions">
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save vehicle'}
          </button>
        </div>
      </form>
    </>
  );
}
