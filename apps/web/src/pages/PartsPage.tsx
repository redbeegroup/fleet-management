import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { accessToken, api, session, uploadFile } from '../lib/api';
import { formatDateTime, humanize, money } from '../lib/format';
import type { Branch, Part, Supplier } from '../lib/types';
import { errorText } from './IncidentsPage';

interface StockRow {
  id: string;
  part: { id: string; partNo: string; name: string; unit: string; category: string | null };
  branchId: string;
  branchName: string;
  qtyOnHand: number;
  avgCost: number;
  value: number;
  minQty: number;
  bin: string | null;
  belowMin: boolean;
  suggestedOrder: number | null;
}
interface Movement {
  id: string;
  kind: string;
  qty: string;
  unitCost: string;
  value: string;
  qtyAfter: string;
  branchId: string;
  reference: string | null;
  reason: string | null;
  occurredAt: string;
  part: { partNo: string; name: string; unit: string };
}
type Tab = 'stock' | 'reorder' | 'catalogue' | 'movements';
type Action = 'receive' | 'transfer' | 'count' | null;

/** Spare parts: stock per branch store at moving average cost, receipts, transfers, counts. */
export function PartsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'stock';
  const canWrite = session.can(Permission.INVENTORY_WRITE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const tabs: [Tab, string][] = [
    ['stock', 'Stock'],
    ['reorder', 'To reorder'],
    ['catalogue', 'Catalogue'],
    ['movements', 'Movements'],
  ];
  return (
    <>
      <header className="page-head">
        <h1>Parts & stock</h1>
      </header>
      <nav className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => (setMsg(null), setParams({ tab: k }))}>
            {label}
          </button>
        ))}
      </nav>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      {(tab === 'stock' || tab === 'reorder') && <StockTab branches={branches.data ?? []} reorder={tab === 'reorder'} canWrite={canWrite} setMsg={setMsg} />}
      {tab === 'catalogue' && <CatalogueTab canWrite={canWrite} setMsg={setMsg} />}
      {tab === 'movements' && <MovementsTab branches={branches.data ?? []} />}
    </>
  );
}

type SetMsg = (m: { ok: boolean; text: string } | null) => void;

function StockTab({ branches, reorder, canWrite, setMsg }: { branches: Branch[]; reorder: boolean; canWrite: boolean; setMsg: SetMsg }) {
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<Action>(null);
  const q = useQuery({
    queryKey: ['stock', branchId, search, reorder],
    queryFn: () => api<{ items: StockRow[]; totals: { value: number; byBranch: Record<string, number>; belowMin: number } }>(`/inventory/stock?${new URLSearchParams({ ...(branchId && { branchId }), ...(search && { search }), ...(reorder && { belowMin: 'true' }) })}`),
  });
  const done = (text: string) => {
    setMsg({ ok: true, text });
    setAction(null);
    void qc.invalidateQueries({ queryKey: ['stock'] });
    void qc.invalidateQueries({ queryKey: ['parts'] });
  };
  const t = q.data?.totals;
  return (
    <>
      <section className="tiles">
        <div className="card tile">
          <span className="tile-label">Stock value</span>
          <span className="tile-value small">{t ? money(t.value) : '…'}</span>
          <span className="muted small">{t ? Object.entries(t.byBranch).map(([b, v]) => `${b} ${money(v)}`).join(' · ') : ''}</span>
        </div>
        <div className="card tile">
          <span className="tile-label">At or below minimum</span>
          <span className="tile-value small">{t ? t.belowMin : '…'}</span>
        </div>
      </section>
      <div className="toolbar">
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Store">
          <option value="">All stores</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input placeholder="Part no. or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        {canWrite && (
          <div className="actions">
            <button className="btn btn-primary" onClick={() => setAction('receive')}>
              Receive
            </button>
            <button className="btn" onClick={() => setAction('transfer')}>
              Transfer
            </button>
            <button className="btn" onClick={() => setAction('count')}>
              Stock count
            </button>
          </div>
        )}
      </div>
      {action && <StockAction action={action} branches={branches} rows={q.data?.items ?? []} onDone={done} onClose={() => setAction(null)} setMsg={setMsg} />}
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Part</th>
                <th>Store</th>
                <th className="num">On hand</th>
                <th className="num">Min</th>
                <th className="num">Avg cost</th>
                <th className="num">Value</th>
                {reorder && <th className="num">Order</th>}
              </tr>
            </thead>
            <tbody>
              {q.data?.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {reorder ? 'Nothing to reorder.' : 'No stock yet. Add parts to the catalogue, then receive them into a store.'}
                  </td>
                </tr>
              )}
              {q.data?.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.part.partNo} · {r.part.name}
                    {r.bin && <div className="muted small">bin {r.bin}</div>}
                  </td>
                  <td>{r.branchName}</td>
                  <td className="num">
                    {r.qtyOnHand} {r.part.unit} {r.belowMin && <span className="badge badge-warn">low</span>}
                  </td>
                  <td className="num">{r.minQty || '—'}</td>
                  <td className="num">{money(r.avgCost)}</td>
                  <td className="num">{money(r.value)}</td>
                  {reorder && <td className="num">{r.suggestedOrder ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function StockAction({ action, branches, rows, onDone, onClose, setMsg }: { action: Exclude<Action, null>; branches: Branch[]; rows: StockRow[]; onDone: (t: string) => void; onClose: () => void; setMsg: SetMsg }) {
  const parts = useQuery({ queryKey: ['parts', ''], queryFn: () => api<Part[]>('/inventory/parts?active=true') });
  const suppliers = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api<Supplier[]>('/suppliers?active=true') });
  const [lines, setLines] = useState<{ partId: string; qty: string; unitCost: string }[]>([{ partId: '', qty: '1', unitCost: '' }]);
  const [store, setStore] = useState(branches[0]?.id ?? '');
  const path = { receive: '/inventory/receipts', transfer: '/inventory/transfers', count: '/inventory/counts' }[action];
  const post = useMutation({
    mutationFn: (b: unknown) => api<Record<string, number>>(path, { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: (r) => onDone(action === 'receive' ? `Received, value ${money(r.value)}.` : action === 'transfer' ? 'Transferred.' : `Count saved: ${r.changed} item(s) adjusted (${money(r.value)}).`),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ls = lines.filter((l) => l.partId);
    if (!ls.length) return setMsg({ ok: false, text: 'Add at least one part' });
    if (action === 'receive') {
      const file = f.get('file') as File | null;
      post.mutate({
        branchId: store,
        supplierId: f.get('supplierId') || null,
        reference: f.get('reference') || null,
        ...(file?.size ? { fileId: (await uploadFile(file)).id } : {}),
        lines: ls.map((l) => ({ partId: l.partId, qty: Number(l.qty), unitCost: Number(l.unitCost) })),
      });
    } else if (action === 'transfer') {
      post.mutate({ fromBranchId: store, toBranchId: f.get('toBranchId'), reference: f.get('reference') || null, lines: ls.map((l) => ({ partId: l.partId, qty: Number(l.qty) })) });
    } else {
      post.mutate({ branchId: store, reason: f.get('reason'), lines: ls.map((l) => ({ partId: l.partId, countedQty: Number(l.qty) })) });
    }
  }
  const onHand = (partId: string) => rows.find((r) => r.part.id === partId && r.branchId === store)?.qtyOnHand;
  const set = (i: number, k: 'partId' | 'qty' | 'unitCost', v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <form className="card form-grid" onSubmit={(e) => void submit(e)}>
      <h2 className="span-2">{{ receive: 'Receive goods', transfer: 'Transfer between stores', count: 'Stock count' }[action]}</h2>
      <label>
        {action === 'transfer' ? 'From store' : 'Store'}
        <select value={store} onChange={(e) => setStore(e.target.value)} required>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {action === 'receive' && (
        <label>
          Supplier
          <select name="supplierId" defaultValue="">
            <option value="">—</option>
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {action === 'transfer' && (
        <label>
          To store
          <select name="toBranchId" required>
            {branches
              .filter((b) => b.id !== store)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {action === 'count' ? (
        <label>
          Reason
          <input name="reason" required minLength={2} defaultValue="Stock count" />
        </label>
      ) : (
        <label>
          {action === 'receive' ? 'Invoice / delivery note no.' : 'Reference'}
          <input name="reference" />
        </label>
      )}
      {action === 'receive' && (
        <label>
          Invoice document
          <input name="file" type="file" accept="image/*,application/pdf" />
        </label>
      )}
      <div className="span-2">
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th className="num">{action === 'count' ? 'Counted' : 'Quantity'}</th>
              {action === 'receive' && <th className="num">Unit cost</th>}
              <th className="num">On hand</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select value={l.partId} onChange={(e) => set(i, 'partId', e.target.value)} aria-label="Part">
                    <option value="">Part…</option>
                    {parts.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partNo} · {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <input type="number" min={0} step="any" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} required aria-label="Quantity" style={{ width: 90 }} />
                </td>
                {action === 'receive' && (
                  <td className="num">
                    <input type="number" min={0} step="any" value={l.unitCost} onChange={(e) => set(i, 'unitCost', e.target.value)} required aria-label="Unit cost" style={{ width: 110 }} />
                  </td>
                )}
                <td className="num muted">{l.partId ? (onHand(l.partId) ?? 0) : ''}</td>
                <td>
                  {lines.length > 1 && (
                    <button type="button" className="link danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="link" onClick={() => setLines([...lines, { partId: '', qty: '1', unitCost: '' }])}>
          + Add line
        </button>
      </div>
      {action === 'count' && <p className="muted small span-2">Differences are booked as adjustments at the store's average cost.</p>}
      <div className="span-2 actions">
        <button className="btn btn-primary" disabled={post.isPending}>
          Save
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </form>
  );
}

/** Minimal CSV parser (quoted fields, comma or semicolon). */
function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function CatalogueTab({ canWrite, setMsg }: { canWrite: boolean; setMsg: SetMsg }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const parts = useQuery({ queryKey: ['parts', search], queryFn: () => api<Part[]>(`/inventory/parts${search ? `?search=${encodeURIComponent(search)}` : ''}`) });
  const suppliers = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api<Supplier[]>('/suppliers') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['parts'] });
  const create = useMutation({
    mutationFn: (b: unknown) => api('/inventory/parts', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => (setMsg({ ok: true, text: 'Part added.' }), refresh()),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const importParts = useMutation({
    mutationFn: (rows: unknown[]) => api<{ created: number; updated: number }>('/inventory/parts/import', { method: 'POST', body: JSON.stringify({ parts: rows }) }),
    onSuccess: (r) => (setMsg({ ok: true, text: `Imported: ${r.created} new, ${r.updated} updated.` }), refresh()),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    create.mutate({
      partNo: f.get('partNo'),
      name: f.get('name'),
      category: f.get('category') || null,
      unit: f.get('unit') || 'pcs',
      supplierId: f.get('supplierId') || null,
      minQty: n('minQty') ?? 0,
      reorderQty: n('reorderQty') ?? 0,
      warrantyMonths: n('warrantyMonths'),
      warrantyKm: n('warrantyKm'),
      externalRef: f.get('externalRef') || null,
    });
    e.currentTarget.reset();
  }
  async function importFile(file: File) {
    const rows = parseCsv(await file.text());
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
    const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
    const c = { partNo: col('partno', 'partnumber', 'code', 'material'), name: col('name', 'description'), unit: col('unit', 'uom'), category: col('category', 'group'), minQty: col('minqty', 'min', 'minimum'), reorderQty: col('reorderqty', 'reorder'), warrantyMonths: col('warrantymonths'), warrantyKm: col('warrantykm'), externalRef: col('externalref', 'sapmaterial', 'sap') };
    if (c.partNo < 0 || c.name < 0) return setMsg({ ok: false, text: 'The file needs columns "part no" and "name".' });
    const v = (r: string[], i: number) => (i >= 0 ? r[i]?.trim() || undefined : undefined);
    const num = (r: string[], i: number) => (v(r, i) ? Number(v(r, i)!.replace(',', '.')) : undefined);
    importParts.mutate(
      rows.slice(1).map((r) => ({
        partNo: v(r, c.partNo),
        name: v(r, c.name),
        unit: v(r, c.unit) ?? 'pcs',
        category: v(r, c.category) ?? null,
        minQty: num(r, c.minQty) ?? 0,
        reorderQty: num(r, c.reorderQty) ?? 0,
        warrantyMonths: num(r, c.warrantyMonths) ?? null,
        warrantyKm: num(r, c.warrantyKm) ?? null,
        externalRef: v(r, c.externalRef) ?? null,
      })),
    );
  }
  const sup = (id: string | null) => suppliers.data?.find((s) => s.id === id)?.name ?? '—';
  return (
    <>
      {canWrite && (
        <form className="card form-grid" onSubmit={submit}>
          <h2 className="span-2">New part</h2>
          <label>
            Part no.
            <input name="partNo" required />
          </label>
          <label>
            Name
            <input name="name" required minLength={2} />
          </label>
          <label>
            Category
            <input name="category" placeholder="e.g. Electrical, Filters, Brakes" />
          </label>
          <label>
            Unit
            <input name="unit" defaultValue="pcs" />
          </label>
          <label>
            Preferred supplier
            <select name="supplierId" defaultValue="">
              <option value="">—</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            SAP material no.
            <input name="externalRef" />
          </label>
          <label>
            Minimum stock
            <input name="minQty" type="number" min={0} step="any" />
          </label>
          <label>
            Reorder quantity
            <input name="reorderQty" type="number" min={0} step="any" />
          </label>
          <label>
            Warranty (months)
            <input name="warrantyMonths" type="number" min={0} />
          </label>
          <label>
            Warranty (km)
            <input name="warrantyKm" type="number" min={0} />
          </label>
          <div className="span-2 actions">
            <button className="btn btn-primary" disabled={create.isPending}>
              Add part
            </button>
            <label className="btn">
              Import CSV…
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
            </label>
            <span className="muted small">Columns: part no, name, unit, category, min, reorder, warranty months, warranty km, SAP material. Existing part numbers are updated.</span>
          </div>
        </form>
      )}
      <div className="toolbar">
        <input placeholder="Part no. or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
      </div>
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Part no.</th>
              <th>Name</th>
              <th>Category</th>
              <th>Supplier</th>
              <th className="num">Min / reorder</th>
              <th>Warranty</th>
              <th className="num">On hand</th>
            </tr>
          </thead>
          <tbody>
            {parts.data?.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'muted'}>
                <td>
                  {p.partNo}
                  {p.externalRef && <div className="muted small">SAP {p.externalRef}</div>}
                </td>
                <td>{p.name}</td>
                <td>{p.category ?? '—'}</td>
                <td>{sup(p.supplierId)}</td>
                <td className="num">
                  {Number(p.minQty)} / {Number(p.reorderQty)} {p.unit}
                </td>
                <td>{[p.warrantyMonths && `${p.warrantyMonths} mo`, p.warrantyKm && `${p.warrantyKm.toLocaleString()} km`].filter(Boolean).join(' / ') || '—'}</td>
                <td className="num">{p.stocks.reduce((a, s) => a + Number(s.qtyOnHand), 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function MovementsTab({ branches }: { branches: Branch[] }) {
  const [branchId, setBranchId] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['movements', branchId, kind, page],
    queryFn: () => api<{ items: Movement[]; total: number; pageSize: number }>(`/inventory/movements?${new URLSearchParams({ page: String(page), ...(branchId && { branchId }), ...(kind && { kind }) })}`),
  });
  async function exportCsv() {
    const res = await fetch(`/api/inventory/movements.csv${branchId ? `?branchId=${branchId}` : ''}`, { headers: { Authorization: `Bearer ${accessToken()}` } });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stock-movements.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  const bName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—';
  return (
    <>
      <div className="toolbar">
        <select value={branchId} onChange={(e) => (setBranchId(e.target.value), setPage(1))} aria-label="Store">
          <option value="">All stores</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => (setKind(e.target.value), setPage(1))} aria-label="Kind">
          <option value="">All movements</option>
          {['RECEIPT', 'ISSUE', 'RETURN', 'ADJUST', 'TRANSFER_OUT', 'TRANSFER_IN'].map((k) => (
            <option key={k} value={k}>
              {humanize(k)}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => void exportCsv()} title="For upload to SAP until the integration is connected">
          Export CSV
        </button>
      </div>
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Part</th>
              <th>Store</th>
              <th>Movement</th>
              <th className="num">Qty</th>
              <th className="num">Unit cost</th>
              <th className="num">Value</th>
              <th className="num">Balance</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((m) => (
              <tr key={m.id}>
                <td>{formatDateTime(m.occurredAt)}</td>
                <td>
                  {m.part.partNo} · {m.part.name}
                </td>
                <td>{bName(m.branchId)}</td>
                <td>{humanize(m.kind)}</td>
                <td className="num">{Number(m.qty)}</td>
                <td className="num">{money(m.unitCost)}</td>
                <td className="num">{money(m.value)}</td>
                <td className="num">{Number(m.qtyAfter)}</td>
                <td>{m.reference ?? m.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {q.data && q.data.total > q.data.pageSize && (
        <div className="actions">
          <button className="btn" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Newer
          </button>
          <button className="btn" disabled={page * q.data.pageSize >= q.data.total} onClick={() => setPage(page + 1)}>
            Older
          </button>
        </div>
      )}
    </>
  );
}
