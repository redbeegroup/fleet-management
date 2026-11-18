import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, openFile, session, uploadFile } from '../lib/api';
import { formatDate, money } from '../lib/format';
import type { Branch, Part, Supplier, WorkOrder } from '../lib/types';
import { errorText } from '../pages/IncidentsPage';

const num = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v));

/** Outside garage, its quote and its invoice. */
const PO_TONE: Record<string, string> = { REQUESTED: 'info', CREATED: 'info', MATCHED: 'ok', INVOICE_MISMATCH: 'danger', FAILED: 'danger', NO_SAP_VENDOR: 'warn' };
const PO_LABEL: Record<string, string> = { REQUESTED: 'sending to SAP', CREATED: 'created', MATCHED: 'invoice matches', INVOICE_MISMATCH: 'invoice differs from PO', FAILED: 'not created', NO_SAP_VENDOR: 'garage has no SAP vendor no.' };

export function GarageCard({ w, editable }: { w: WorkOrder; editable: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const garages = useQuery({ queryKey: ['suppliers', 'GARAGE'], queryFn: () => api<Supplier[]>('/suppliers?kind=GARAGE&active=true'), enabled: editable });
  const save = useMutation({
    mutationFn: (b: Record<string, unknown>) => api(`/maintenance/work-orders/${w.id}/garage`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: () => (setEdit(false), setErr(null), void qc.invalidateQueries({ queryKey: ['wo', w.id] })),
    onError: (e) => setErr(errorText(e)),
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const quoteFile = f.get('quoteFile') as File | null;
      const invoiceFile = f.get('invoiceFile') as File | null;
      save.mutate({
        supplierId: f.get('supplierId') || null,
        quoteAmount: num(f.get('quoteAmount')),
        invoiceNo: (f.get('invoiceNo') as string) || null,
        invoiceAmount: num(f.get('invoiceAmount')),
        invoiceDate: (f.get('invoiceDate') as string) || null,
        ...(quoteFile?.size ? { quoteFileId: (await uploadFile(quoteFile)).id } : {}),
        ...(invoiceFile?.size ? { invoiceFileId: (await uploadFile(invoiceFile)).id } : {}),
      });
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  const file = (id: string | null, label: string) =>
    id ? (
      <button type="button" className="link" onClick={() => void openFile(id).catch(() => setErr('Could not open the file'))}>
        {label}
      </button>
    ) : null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Garage</h2>
        {editable && !edit && (
          <button className="link" onClick={() => setEdit(true)}>
            {w.supplier ? 'Edit' : 'Send to a garage'}
          </button>
        )}
      </div>
      {err && <p className="error">{err}</p>}
      {!edit ? (
        <dl className="facts">
          <dt>Garage</dt>
          <dd>{w.supplier?.name ?? w.workshop ?? '— (in-house or not set)'}</dd>
          <dt>Quote</dt>
          <dd>
            {w.quoteAmount ? money(w.quoteAmount) : '—'} {file(w.quoteFileId, 'document')}
          </dd>
          <dt>Invoice</dt>
          <dd>
            {w.invoiceNo ? `${w.invoiceNo} · ${money(w.invoiceAmount)} · ${formatDate(w.invoiceDate)}` : '—'} {file(w.invoiceFileId, 'document')}
          </dd>
          {(w.poNumber || w.poStatus) && (
            <>
              <dt>SAP PO</dt>
              <dd>
                {w.poNumber ?? '—'} {w.poStatus && <span className={`badge badge-${PO_TONE[w.poStatus] ?? 'muted'}`}>{PO_LABEL[w.poStatus] ?? w.poStatus}</span>}
              </dd>
            </>
          )}
        </dl>
      ) : (
        <form className="form-grid" onSubmit={(e) => void submit(e)}>
          <label className="span-2">
            Garage
            <select name="supplierId" defaultValue={w.supplierId ?? ''} key={garages.data ? 'ready' : 'loading'}>
              <option value="">—</option>
              {garages.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quote amount
            <input name="quoteAmount" type="number" min={0} step="any" defaultValue={w.quoteAmount ?? ''} />
          </label>
          <label>
            Quote document
            <input name="quoteFile" type="file" accept="image/*,application/pdf" />
          </label>
          <label>
            Invoice no.
            <input name="invoiceNo" defaultValue={w.invoiceNo ?? ''} />
          </label>
          <label>
            Invoice amount
            <input name="invoiceAmount" type="number" min={0} step="any" defaultValue={w.invoiceAmount ?? ''} />
          </label>
          <label>
            Invoice date
            <input name="invoiceDate" type="date" defaultValue={w.invoiceDate?.slice(0, 10) ?? ''} />
          </label>
          <label>
            Invoice document
            <input name="invoiceFile" type="file" accept="image/*,application/pdf" />
          </label>
          <p className="muted small span-2">The quote is the planned cost: above the approval limit the job needs approval before it starts.</p>
          <div className="span-2 actions">
            <button className="btn btn-primary" disabled={save.isPending}>
              Save
            </button>
            <button type="button" className="btn" onClick={() => setEdit(false)}>
              Close
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Issue a part from a branch store (PART line at the store's average cost). */
export function IssuePartForm({ woId }: { woId: string }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [partId, setPartId] = useState('');
  const [search, setSearch] = useState('');
  const parts = useQuery({ queryKey: ['parts', search], queryFn: () => api<Part[]>(`/inventory/parts?active=true${search ? `&search=${encodeURIComponent(search)}` : ''}`) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const issue = useMutation({
    mutationFn: (b: unknown) => api(`/maintenance/work-orders/${woId}/parts`, { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => (setErr(null), setPartId(''), void qc.invalidateQueries({ queryKey: ['wo', woId] }), void qc.invalidateQueries({ queryKey: ['parts'] })),
    onError: (e) => setErr(errorText(e)),
  });
  if (!session.can(Permission.INVENTORY_WRITE)) return null;
  const part = parts.data?.find((p) => p.id === partId);
  const bName = (id: string) => branches.data?.find((b) => b.id === id)?.name ?? 'store';
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        issue.mutate({ partId, branchId: f.get('branchId'), qty: Number(f.get('qty')) });
      }}
    >
      <strong>Issue from store</strong>
      <input placeholder="Find part" value={search} onChange={(e) => setSearch(e.target.value)} size={14} aria-label="Find part" />
      <select value={partId} onChange={(e) => setPartId(e.target.value)} required aria-label="Part">
        <option value="">Part…</option>
        {parts.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.partNo} · {p.name}
          </option>
        ))}
      </select>
      <select name="branchId" required aria-label="Store" key={partId}>
        {(part?.stocks ?? [])
          .filter((s) => Number(s.qtyOnHand) > 0)
          .map((s) => (
            <option key={s.branchId} value={s.branchId}>
              {bName(s.branchId)} · {Number(s.qtyOnHand)} {part?.unit} @ {money(s.avgCost)}
            </option>
          ))}
      </select>
      <input name="qty" type="number" min={0.01} step="any" defaultValue={1} required aria-label="Quantity" style={{ width: 80 }} />
      <button className="btn" disabled={!partId || issue.isPending}>
        Issue
      </button>
      {part && !part.stocks.some((s) => Number(s.qtyOnHand) > 0) && <span className="error small">Out of stock in every store</span>}
      {err && <span className="error small">{err}</span>}
    </form>
  );
}

interface CoverageItem {
  basis: 'VEHICLE' | 'PART' | 'TIRE';
  ref: string;
  label: string;
  since: string;
  until: string | null;
  untilKm: number | null;
  supplierId: string | null;
  supplierName: string | null;
  relevant: boolean;
}
interface Claim {
  id: string;
  claimNo: string;
  status: string;
  amountClaimed: string;
  amountRecovered: string | null;
}

/** Warranties that may cover this repair, and claims made for it. */
export function WarrantyHint({ w }: { w: WorkOrder }) {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.MAINTENANCE_WRITE);
  const [claimFor, setClaimFor] = useState<CoverageItem | null>(null);
  const [all, setAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['wo-warranty', w.id], queryFn: () => api<{ items: CoverageItem[]; claims: Claim[] }>(`/maintenance/work-orders/${w.id}/warranty`) });
  const create = useMutation({
    mutationFn: (b: unknown) => api('/warranty-claims', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => (setClaimFor(null), setErr(null), void qc.invalidateQueries({ queryKey: ['wo-warranty', w.id] })),
    onError: (e) => setErr(errorText(e)),
  });
  const items = q.data?.items ?? [];
  const likely = items.filter((i) => i.relevant);
  const shown = all ? items : likely;
  if (!items.length && !q.data?.claims.length) return null;
  const limit = (i: CoverageItem) => [i.until && `until ${formatDate(i.until)}`, i.untilKm != null && `${Math.round(i.untilKm).toLocaleString('en-US')} km`].filter(Boolean).join(' / ');
  return (
    <section className={`card ${items.some((i) => i.relevant) ? 'card-attention' : ''}`}>
      <h2>Warranty</h2>
      {items.some((i) => i.relevant) && <p>This repair may be under warranty. Ask the supplier before paying, or make a claim.</p>}
      {err && <p className="error">{err}</p>}
      <table>
        <tbody>
          {shown.map((i) => (
            <tr key={`${i.basis}${i.ref}`}>
              <td>{i.relevant ? <span className="badge badge-warn">likely</span> : <span className="badge badge-muted">active</span>}</td>
              <td>{i.label}</td>
              <td className="muted small">{limit(i)}</td>
              <td className="muted small">{i.supplierName ?? ''}</td>
              <td>
                {canWrite && (
                  <button className="link" onClick={() => setClaimFor(i)}>
                    Claim
                  </button>
                )}
              </td>
            </tr>
          ))}
          {q.data?.claims.map((c) => (
            <tr key={c.id}>
              <td>
                <span className="badge badge-info">{c.status.toLowerCase()}</span>
              </td>
              <td colSpan={2}>
                Claim {c.claimNo}: {money(c.amountClaimed)}
                {c.amountRecovered ? `, recovered ${money(c.amountRecovered)}` : ''}
              </td>
              <td colSpan={2}>
                <a href="/maintenance?tab=warranty">Claims</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > likely.length && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? 'Show likely matches only' : `Show all ${items.length} active warranties of this vehicle`}
        </button>
      )}
      {claimFor && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.mutate({
              vehicleId: w.vehicle.id,
              workOrderId: w.id,
              supplierId: claimFor.supplierId ?? w.supplierId,
              basis: claimFor.basis,
              basisRef: claimFor.ref,
              description: f.get('description'),
              amountClaimed: Number(f.get('amount')),
            });
          }}
        >
          <strong>Claim for {claimFor.label}</strong>
          <input name="description" required minLength={3} size={36} defaultValue={w.title} aria-label="Description" />
          <input name="amount" type="number" min={0} step="any" required defaultValue={Number(w.totalCost) || ''} aria-label="Amount claimed" />
          <button className="btn btn-primary" disabled={create.isPending}>
            Create claim
          </button>
          <button type="button" className="btn" onClick={() => setClaimFor(null)}>
            Close
          </button>
        </form>
      )}
    </section>
  );
}
