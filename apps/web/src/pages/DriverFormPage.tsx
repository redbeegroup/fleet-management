import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LicenceFields } from '../components/LicenceFields';
import { api, ApiError } from '../lib/api';
import type { Branch, Driver } from '../lib/types';

export function DriverFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Driver>('/drivers', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['drivers'] });
      navigate(`/drivers/${d.id}`);
    },
    onError: (err) =>
      setError(err instanceof ApiError && err.body.errors ? err.body.errors.map((e) => `${e.path}: ${e.message}`).join('; ') : err.message),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => (f.get(k) as string)?.trim() || null;
    create.mutate({
      employeeNo: str('employeeNo'),
      fullName: str('fullName'),
      phone: str('phone'),
      branchId: str('branchId'),
      licenseNumber: str('licenseNumber'),
      licenseClass: str('licenseNumber') ? str('licenseClass') : null,
      licenseIssuedAt: str('licenseIssuedAt'),
      licenseExpiresAt: str('licenseExpiresAt'),
    });
  }

  return (
    <>
      <header className="page-head">
        <h1>Add driver</h1>
      </header>
      <form className="card form-grid" onSubmit={submit}>
        <label>
          Employee no. *
          <input name="employeeNo" required />
        </label>
        <label>
          Full name *
          <input name="fullName" required />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" />
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
          Licence number
          <input name="licenseNumber" />
        </label>
        <LicenceFields names={{ cls: 'licenseClass', issued: 'licenseIssuedAt', expires: 'licenseExpiresAt' }} />
        {error && <p className="error span-2">{error}</p>}
        <div className="span-2 actions">
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            Save driver
          </button>
        </div>
      </form>
    </>
  );
}
