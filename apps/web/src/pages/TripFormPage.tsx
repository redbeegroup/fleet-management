import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AssignmentPicker } from '../components/AssignmentPicker';
import { api, ApiError } from '../lib/api';
import { toLocalInput } from '../lib/format';
import type { Trip } from '../lib/types';

const H = 3_600_000;

export function TripFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const initialStart = params.get('start') ? new Date(params.get('start')!) : new Date(Math.ceil(Date.now() / H) * H);
  const [start, setStart] = useState(toLocalInput(initialStart));
  const [end, setEnd] = useState(toLocalInput(new Date(initialStart.getTime() + 4 * H)));
  const [pick, setPick] = useState({ vehicleId: params.get('vehicleId') ?? '', driverId: '' });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Trip>('/trips', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['trips'] });
      navigate(`/trips/${t.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const b = e.body as { reasons?: string[]; errors?: { path: string; message: string }[] };
        setError(b.reasons?.join('; ') ?? b.errors?.map((x) => `${x.path}: ${x.message}`).join('; ') ?? e.message);
      } else setError(e.message);
    },
  });

  const iso = (v: string) => (v ? new Date(v).toISOString() : '');

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => (f.get(k) as string)?.trim() || null;
    if ((pick.vehicleId && !pick.driverId) || (!pick.vehicleId && pick.driverId)) {
      setError('Choose both a vehicle and a driver, or leave both empty to assign later.');
      return;
    }
    create.mutate({
      originName: str('originName'),
      destinationName: str('destinationName'),
      plannedStart: iso(start),
      plannedEnd: iso(end),
      purpose: str('purpose'),
      cargoDescription: str('cargoDescription'),
      cargoWeightKg: str('cargoWeightKg') ? Number(str('cargoWeightKg')) : null,
      notes: str('notes'),
      ...(pick.vehicleId && pick.driverId ? pick : {}),
    });
  }

  return (
    <>
      <header className="page-head">
        <h1>New trip</h1>
      </header>
      <form className="card form-grid" onSubmit={submit}>
        <label>
          From *
          <input name="originName" required placeholder="e.g. Yangon depot" />
        </label>
        <label>
          To *
          <input name="destinationName" required placeholder="e.g. Bago distributor" />
        </label>
        <label>
          Planned departure *
          <input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Planned arrival *
          <input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <AssignmentPicker from={iso(start)} to={iso(end)} vehicleId={pick.vehicleId} driverId={pick.driverId} onChange={setPick} />
        <label>
          Purpose
          <input name="purpose" placeholder="Delivery, transfer, service…" />
        </label>
        <label>
          Cargo weight (kg)
          <input name="cargoWeightKg" type="number" min={0} step="any" />
        </label>
        <label className="span-2">
          Cargo description
          <input name="cargoDescription" />
        </label>
        <label className="span-2">
          Notes
          <textarea name="notes" rows={2} />
        </label>
        {error && <p className="error span-2">{error}</p>}
        <div className="span-2 actions">
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            {pick.vehicleId ? 'Create & assign' : 'Create trip'}
          </button>
        </div>
      </form>
    </>
  );
}
