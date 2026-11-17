import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { RangePicker } from '../components/RangePicker';
import { api, session } from '../lib/api';
import { humanize, lastDays, money } from '../lib/format';
import type { Supplier } from '../lib/types';
import { errorText } from './IncidentsPage';

interface Perf {
  supplierId: string;
  name: string;
  jobs: number;
  cost: number;
  avgCost: number;
  avgTurnaroundHours: number;
  repeatRepairs: number;
  repeatPct: number;
  invoiceVsQuotePct: number | null;
  warrantyRecovered: number;
}

const KINDS = ['GARAGE', 'PARTS', 'TIRES', 'OTHER'] as const;

/** Outside garages and parts / tire suppliers, with garage performance. */
export function SuppliersPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.INVENTORY_WRITE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [kinds, setKinds] = useState<string[]>(['GARAGE']);
  const [range, setRange] = useState(() => lastDays(90));
  const list = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api<Supplier[]>('/suppliers') });
  const perf = useQuery({
    queryKey: ['garage-perf', range],
    queryFn: () => api<Perf[]>(`/maintenance/garages?from=${range.from}T00:00:00Z&to=${range.to}T23:59:59Z`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['suppliers'] });
  const create = useMutation({
    mutationFn: (b: unknown) => api('/suppliers', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => (setMsg({ ok: true, text: 'Supplier added.' }), refresh()),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const update = useMutation({
    mutationFn: ({ id, b }: { id: string; b: unknown }) => api(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: refresh,
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!kinds.length) return setMsg({ ok: false, text: 'Choose at least one type' });
    create.mutate({
      name: f.get('name'),
      kinds,
      phone: f.get('phone') || null,
      email: f.get('email') || null,
      address: f.get('address') || null,
      taxId: f.get('taxId') || null,
      paymentTermsDays: f.get('paymentTermsDays') ? Number(f.get('paymentTermsDays')) : null,
      externalRef: f.get('externalRef') || null,
    });
    e.currentTarget.reset();
  }
  return (
    <>
      <header className="page-head">
        <h1>Suppliers & garages</h1>
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      <section className="card table-card">
        <div className="card-head">
          <h2>Garage performance</h2>
          <div className="actions">
            <RangePicker value={range} onChange={setRange} />
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Garage</th>
              <th className="num">Jobs</th>
              <th className="num">Cost</th>
              <th className="num">Avg per job</th>
              <th className="num">Avg turnaround</th>
              <th className="num">Back within 30 days</th>
              <th className="num">Invoice vs quote</th>
              <th className="num">Warranty recovered</th>
            </tr>
          </thead>
          <tbody>
            {perf.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No garage jobs completed in this period. Choose the garage on a work order to track it.
                </td>
              </tr>
            )}
            {perf.data?.map((g) => (
              <tr key={g.supplierId}>
                <td>{g.name}</td>
                <td className="num">{g.jobs}</td>
                <td className="num">{money(g.cost)}</td>
                <td className="num">{money(g.avgCost)}</td>
                <td className="num">{g.avgTurnaroundHours < 48 ? `${g.avgTurnaroundHours} h` : `${Math.round((g.avgTurnaroundHours / 24) * 10) / 10} days`}</td>
                <td className="num">
                  {g.repeatRepairs} ({g.repeatPct} %)
                </td>
                <td className="num">{g.invoiceVsQuotePct == null ? '—' : `${g.invoiceVsQuotePct > 0 ? '+' : ''}${g.invoiceVsQuotePct} %`}</td>
                <td className="num">{money(g.warrantyRecovered)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">"Back within 30 days": the same vehicle was opened again for a repair within 30 days after the garage finished.</p>
      </section>
      {canWrite && (
        <form className="card form-grid" onSubmit={submit}>
          <h2 className="span-2">New supplier</h2>
          <label>
            Name
            <input name="name" required minLength={2} />
          </label>
          <div>
            <span className="muted small">Type</span>
            <div className="chips">
              {KINDS.map((k) => (
                <button type="button" key={k} className={kinds.includes(k) ? 'chip on' : 'chip'} aria-pressed={kinds.includes(k)} onClick={() => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])}>
                  {humanize(k)}
                </button>
              ))}
            </div>
          </div>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            E-mail
            <input name="email" type="email" />
          </label>
          <label className="span-2">
            Address
            <input name="address" />
          </label>
          <label>
            Tax ID
            <input name="taxId" />
          </label>
          <label>
            Payment terms (days)
            <input name="paymentTermsDays" type="number" min={0} max={365} />
          </label>
          <label>
            SAP vendor no.
            <input name="externalRef" />
          </label>
          <div className="span-2">
            <button className="btn btn-primary" disabled={create.isPending}>
              Add supplier
            </button>
          </div>
        </form>
      )}
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Contact</th>
              <th>Terms</th>
              <th>SAP</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {list.data?.map((s) => (
              <tr key={s.id} className={s.active ? '' : 'muted'}>
                <td>
                  {s.name}
                  {s.address && <div className="muted small">{s.address}</div>}
                </td>
                <td>{s.kinds.map(humanize).join(', ')}</td>
                <td>{[s.phone, s.email].filter(Boolean).join(' · ') || '—'}</td>
                <td>{s.paymentTermsDays != null ? `${s.paymentTermsDays} days` : '—'}</td>
                <td>{s.externalRef ?? '—'}</td>
                {canWrite && (
                  <td>
                    <button className="link" onClick={() => update.mutate({ id: s.id, b: { active: !s.active } })}>
                      {s.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
