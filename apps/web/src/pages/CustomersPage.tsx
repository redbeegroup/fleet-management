import { Paginated, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, session } from '../lib/api';
import type { CustomerRow } from '../lib/types';
import { errorText } from './IncidentsPage';

/** Customers / outlets from the DMS; dispatch can fix locations and phones. */
export function CustomersPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.LOGISTICS_WRITE);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['customers', search],
    queryFn: () =>
      api<Paginated<CustomerRow>>(
        `/customers?pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });
  const save = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      setEditing(null);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => setError(errorText(e)),
  });
  function submit(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    save.mutate({
      id,
      body: {
        phone: (f.get('phone') as string) || null,
        latitude: num('latitude'),
        longitude: num('longitude'),
      },
    });
  }
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Customers & outlets</h1>
          <p className="muted">
            Created and named by the DMS. Correct locations here so stops are ordered well.
          </p>
        </div>
        <input
          type="search"
          placeholder="Code, name or township"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search"
        />
      </header>
      {error && <p className="error">{error}</p>}
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Area</th>
              <th>Phone</th>
              <th>Location</th>
              <th className="num">Orders</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((c) =>
              editing === c.id ? (
                <tr key={c.id}>
                  <td colSpan={7}>
                    <form className="inline-form" onSubmit={(e) => submit(e, c.id)}>
                      <strong>{c.name}</strong>
                      <input
                        name="phone"
                        defaultValue={c.phone ?? ''}
                        placeholder="Phone"
                        aria-label="Phone"
                      />
                      <input
                        name="latitude"
                        type="number"
                        step="any"
                        min={-90}
                        max={90}
                        defaultValue={c.latitude ?? ''}
                        placeholder="Latitude"
                        aria-label="Latitude"
                      />
                      <input
                        name="longitude"
                        type="number"
                        step="any"
                        min={-180}
                        max={180}
                        defaultValue={c.longitude ?? ''}
                        placeholder="Longitude"
                        aria-label="Longitude"
                      />
                      <button className="btn btn-primary" disabled={save.isPending}>
                        Save
                      </button>
                      <button type="button" className="btn" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <td>{c.code}</td>
                  <td>
                    {c.name}
                    {c.address && <div className="muted">{c.address}</div>}
                  </td>
                  <td>{[c.township, c.city].filter(Boolean).join(', ') || '—'}</td>
                  <td>{c.phone ?? '—'}</td>
                  <td>
                    {c.latitude != null ? (
                      <a
                        href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.latitude.toFixed(4)}, {c.longitude?.toFixed(4)}
                      </a>
                    ) : (
                      <span className="badge badge-warn">missing</span>
                    )}
                  </td>
                  <td className="num">{c._count.orders}</td>
                  <td>
                    {canWrite && (
                      <button className="link" onClick={() => setEditing(c.id)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
