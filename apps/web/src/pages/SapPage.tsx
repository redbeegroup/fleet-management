import { CostCategory, SapSettings } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatDateTime, humanize, money } from '../lib/format';
import { errorText } from './IncidentsPage';

interface Run {
  id: string;
  kind: 'MASTER' | 'BILLING';
  status: string;
  stats: Record<string, unknown>;
  errors: string[];
  startedAt: string;
  finishedAt: string | null;
}
interface Posting {
  id: string;
  period: string;
  version: number;
  status: string;
  total: string;
  currency: string;
  sapDocNo: string | null;
  postedAt: string | null;
  lines?: { costCenter: string; glAccount: string; category: string; vehicles: number; amount: string }[];
}
interface Status {
  mode: 'none' | 'mock' | 'odata';
  settings: SapSettings;
  connection: { baseUrl: string; authType: string; username: string; tokenUrl: string | null; sapClient: string | null; updatedAt: string } | null;
  runs: Run[];
  outbox: Record<string, number>;
  postings: Posting[];
}
interface Doc {
  id: string;
  kind: string;
  ref: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  sapDocNo: string | null;
  lastError: string | null;
  createdAt: string;
}
const TONE: Record<string, string> = { OK: 'ok', POSTED: 'ok', SENT: 'ok', PARTIAL: 'warn', PENDING: 'info', RUNNING: 'info', FAILED: 'danger', REVERSED: 'muted' };
const lastMonth = () => {
  const d = new Date(`${new Date(Date.now() + 6.5 * 3_600_000).toISOString().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

/** SAP S/4HANA link: connection and mappings, master data, monthly cost posting, outbox, receipts, billing. */
export function SapPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'setup';
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useQuery({ queryKey: ['sap'], queryFn: () => api<Status>('/sap') });
  const s = q.data;
  return (
    <>
      <header className="page-head">
        <h1>SAP S/4HANA</h1>
        {s && (
          <span className={`badge badge-${s.mode === 'none' ? 'muted' : s.mode === 'mock' ? 'warn' : s.settings.enabled ? 'ok' : 'muted'}`}>
            {s.mode === 'none' ? 'Link not installed' : s.mode === 'mock' ? 'Demo mode (no real SAP)' : s.settings.enabled ? 'Connected' : 'Off'}
          </span>
        )}
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      <nav className="tabs" role="tablist" aria-label="SAP">
        {[
          ['setup', 'Connection & mapping'],
          ['master', 'Master data'],
          ['posting', 'Cost posting'],
          ['outbox', `Outbox${s?.outbox.FAILED ? ` (${s.outbox.FAILED} failed)` : ''}`],
          ['receipts', 'Receipts vs PO'],
          ['billing', 'Billing'],
        ].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setSp(k === 'setup' ? {} : { tab: k })}>
            {label}
          </button>
        ))}
      </nav>
      {s &&
        (tab === 'setup' ? (
          <Setup s={s} setMsg={setMsg} />
        ) : tab === 'master' ? (
          <Master runs={s.runs.filter((r) => r.kind === 'MASTER')} setMsg={setMsg} />
        ) : tab === 'posting' ? (
          <Postings s={s} setMsg={setMsg} />
        ) : tab === 'outbox' ? (
          <Outbox setMsg={setMsg} />
        ) : tab === 'receipts' ? (
          <Receipts />
        ) : (
          <Billing runs={s.runs.filter((r) => r.kind === 'BILLING')} setMsg={setMsg} />
        ))}
    </>
  );
}

type SetMsg = (m: { ok: boolean; text: string } | null) => void;

function Setup({ s, setMsg }: { s: Status; setMsg: SetMsg }) {
  const qc = useQueryClient();
  const done = (text: string) => () => (setMsg({ ok: true, text }), void qc.invalidateQueries({ queryKey: ['sap'] }));
  const conn = useMutation({ mutationFn: (b: unknown) => api('/sap/connection', { method: 'PUT', body: JSON.stringify(b) }), onSuccess: done('Connection saved.'), onError: (e) => setMsg({ ok: false, text: errorText(e) }) });
  const test = useMutation({ mutationFn: () => api<{ detail: string }>('/sap/test', { method: 'POST' }), onSuccess: (r) => setMsg({ ok: true, text: r.detail }), onError: (e) => setMsg({ ok: false, text: errorText(e) }) });
  const save = useMutation({ mutationFn: (sap: unknown) => api('/company/settings', { method: 'PATCH', body: JSON.stringify({ sap }) }), onSuccess: done('SAP settings saved.'), onError: (e) => setMsg({ ok: false, text: errorText(e) }) });
  const c = s.connection;
  const st = s.settings;
  const cats = ['default', ...Object.values(CostCategory)];
  function submitConn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    conn.mutate({ baseUrl: f.get('baseUrl'), authType: f.get('authType'), username: f.get('username'), ...(f.get('secret') ? { secret: f.get('secret') } : {}), tokenUrl: f.get('tokenUrl') || null, sapClient: f.get('sapClient') || null });
  }
  function submitSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? '').trim();
    save.mutate({
      enabled: f.get('enabled') === 'on',
      companyCode: str('companyCode'),
      controllingArea: str('controllingArea'),
      plant: str('plant'),
      purchasingOrg: str('purchasingOrg'),
      purchasingGroup: str('purchasingGroup'),
      currency: str('currency').toUpperCase() || 'MMK',
      offsetAccount: str('offsetAccount'),
      defaultCostCenter: str('defaultCostCenter'),
      serviceGlAccount: str('serviceGlAccount'),
      materialGroup: str('materialGroup'),
      postingDay: Number(f.get('postingDay') || 5),
      autoPost: f.get('autoPost') === 'on',
      poForGarageJobs: f.get('poForGarageJobs') === 'on',
      poForReceipts: f.get('poForReceipts') === 'on',
      poTolerancePct: Number(f.get('poTolerancePct') || 0),
      importBilling: f.get('importBilling') === 'on',
      glAccounts: Object.fromEntries(cats.map((k) => [k, str(`gl.${k}`)]).filter(([, v]) => v)),
    });
  }
  return (
    <>
      {s.mode === 'none' && <p className="muted">The SAP link is not switched on for this installation. Ask IT to set SAP_MODE=odata on the API and worker.</p>}
      {s.mode === 'mock' && <p className="muted">Demo mode: a built-in stand-in answers instead of SAP. Documents get demo numbers; nothing reaches a real SAP system.</p>}
      <section className="grid-2">
        <form className="card form-grid" onSubmit={submitConn}>
          <h2 className="span-all">Connection (communication user)</h2>
          <label className="span-all">
            SAP URL
            <input name="baseUrl" type="url" required defaultValue={c?.baseUrl ?? ''} placeholder="https://my000000-api.s4hana.cloud.sap" />
          </label>
          <label>
            Authentication
            <select name="authType" defaultValue={c?.authType ?? 'BASIC'}>
              <option value="BASIC">User + password</option>
              <option value="OAUTH">OAuth client credentials</option>
            </select>
          </label>
          <label>
            SAP client
            <input name="sapClient" pattern="\d{3}" defaultValue={c?.sapClient ?? ''} placeholder="100" />
          </label>
          <label>
            User / client ID
            <input name="username" required defaultValue={c?.username ?? ''} autoComplete="off" />
          </label>
          <label>
            Password / secret
            <input name="secret" type="password" autoComplete="new-password" placeholder={c ? 'stored (leave empty to keep)' : ''} />
          </label>
          <label className="span-all">
            Token URL (OAuth only)
            <input name="tokenUrl" type="url" defaultValue={c?.tokenUrl ?? ''} />
          </label>
          <div className="span-all">
            <button className="btn btn-primary" disabled={conn.isPending || s.mode === 'mock'}>
              Save connection
            </button>{' '}
            <button type="button" className="btn" disabled={test.isPending || s.mode === 'none'} onClick={() => test.mutate()}>
              Test
            </button>
            {c && <span className="muted small"> Saved {formatDateTime(c.updatedAt)}. The secret is stored encrypted and never shown.</span>}
          </div>
        </form>
        <form className="card form-grid" onSubmit={submitSettings}>
          <h2 className="span-all">Organisation</h2>
          <label className="check span-all">
            <input name="enabled" type="checkbox" defaultChecked={st.enabled} /> Use the SAP link for this company
          </label>
          {(
            [
              ['companyCode', 'Company code'],
              ['controllingArea', 'Controlling area'],
              ['plant', 'Plant'],
              ['purchasingOrg', 'Purchasing organisation'],
              ['purchasingGroup', 'Purchasing group'],
              ['currency', 'Currency'],
              ['defaultCostCenter', 'Default cost centre'],
              ['offsetAccount', 'Offset (credit) account'],
              ['serviceGlAccount', 'GL account for garage POs'],
              ['materialGroup', 'Material group for garage POs'],
            ] as [keyof SapSettings, string][]
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <input name={k} defaultValue={String(st[k] ?? '')} />
            </label>
          ))}
          <label>
            Posting day (month-end)
            <input name="postingDay" type="number" min={1} max={28} defaultValue={st.postingDay} />
          </label>
          <label>
            PO tolerance (%)
            <input name="poTolerancePct" type="number" min={0} max={50} step="0.5" defaultValue={st.poTolerancePct} />
          </label>
          <label className="check">
            <input name="autoPost" type="checkbox" defaultChecked={st.autoPost} /> Post last month automatically on the posting day
          </label>
          <label className="check">
            <input name="poForGarageJobs" type="checkbox" defaultChecked={st.poForGarageJobs} /> Create a PO when a garage job starts
          </label>
          <label className="check">
            <input name="poForReceipts" type="checkbox" defaultChecked={st.poForReceipts} /> Check parts receipts against their PO
          </label>
          <label className="check">
            <input name="importBilling" type="checkbox" defaultChecked={st.importBilling} /> Import billing documents (actual revenue)
          </label>
          <h3 className="span-all">GL expense account per cost category</h3>
          {cats.map((k) => (
            <label key={k}>
              {k === 'default' ? 'Default (all others)' : humanize(k)}
              <input name={`gl.${k}`} defaultValue={st.glAccounts[k] ?? ''} />
            </label>
          ))}
          <div className="span-all">
            <button className="btn btn-primary" disabled={save.isPending}>
              Save settings
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

interface Suggestion {
  assetNo: string;
  description: string;
  acquisitionValue: number | null;
  vehicleId: string | null;
  plateNumber: string | null;
  linked: boolean;
}

function Master({ runs, setMsg }: { runs: Run[]; setMsg: SetMsg }) {
  const qc = useQueryClient();
  const sync = useMutation({ mutationFn: () => api<Run>('/sap/sync', { method: 'POST' }), onSuccess: (r) => (setMsg({ ok: r.status === 'OK', text: r.status === 'OK' ? 'Master data imported.' : r.errors.join('; ') }), void qc.invalidateQueries({ queryKey: ['sap'] })), onError: (e) => setMsg({ ok: false, text: errorText(e) }) });
  const match = useMutation({ mutationFn: (b: unknown) => api('/sap/assets/match', { method: 'POST', body: JSON.stringify(b) }), onSuccess: () => (setMsg({ ok: true, text: 'Asset linked. SAP now depreciates this vehicle; FMS leaves depreciation out of the cost posting.' }), void qc.invalidateQueries({ queryKey: ['sap'] })), onError: (e) => setMsg({ ok: false, text: errorText(e) }) });
  const last = runs[0];
  const stat = (k: string) => last?.stats[k] as Record<string, number> | undefined;
  const suggestions = (last?.stats.assets as { suggestions?: Suggestion[] } | undefined)?.suggestions ?? [];
  const [linked, setLinked] = useState<Record<string, boolean>>({});
  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Imported from SAP</h2>
          <button className="btn btn-primary" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? 'Importing…' : 'Import now'}
          </button>
        </div>
        {last ? (
          <>
            <p className="muted small">
              Last import {formatDateTime(last.startedAt)} <span className={`badge badge-${TONE[last.status] ?? 'muted'}`}>{humanize(last.status)}</span> · runs nightly
            </p>
            <table>
              <tbody>
                <tr>
                  <td>Cost centres → departments</td>
                  <td>{stat('costCenters') ? `${stat('costCenters')!.received} received · ${stat('costCenters')!.matched} matched · ${stat('costCenters')!.created} new departments` : '—'}</td>
                </tr>
                <tr>
                  <td>Vendors → suppliers / garages</td>
                  <td>{stat('vendors') ? `${stat('vendors')!.received} received · ${stat('vendors')!.matched} matched · ${stat('vendors')!.created} new` : '—'}</td>
                </tr>
                <tr>
                  <td>Materials → parts</td>
                  <td>{stat('materials') ? `${stat('materials')!.matched} parts linked · ${stat('materials')!.unmatchedParts} parts without a SAP material` : '—'}</td>
                </tr>
                <tr>
                  <td>Customers (sold-to)</td>
                  <td>{stat('customers') ? `${stat('customers')!.received} received · ${stat('customers')!.matched} matched` : '—'}</td>
                </tr>
              </tbody>
            </table>
            {last.errors.length > 0 && <p className="error">{last.errors.join('; ')}</p>}
          </>
        ) : (
          <p className="muted">Nothing imported yet.</p>
        )}
      </section>
      <section className="card table-card">
        <div className="card-head">
          <h2>Fixed assets</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>SAP asset</th>
              <th>Description</th>
              <th className="num">Acquisition value</th>
              <th>Vehicle</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {suggestions.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No fixed assets imported.
                </td>
              </tr>
            )}
            {suggestions.map((a) => (
              <tr key={a.assetNo}>
                <td>{a.assetNo}</td>
                <td>{a.description}</td>
                <td className="num">{a.acquisitionValue != null ? money(a.acquisitionValue) : '—'}</td>
                <td>{a.vehicleId ? <Link to={`/vehicles/${a.vehicleId}`}>{a.plateNumber}</Link> : <span className="muted">no match</span>}</td>
                <td>
                  {a.linked || linked[a.assetNo] ? (
                    <span className="badge badge-ok">linked</span>
                  ) : (
                    a.vehicleId && (
                      <button className="btn" disabled={match.isPending} onClick={() => match.mutate({ vehicleId: a.vehicleId, sapAssetNo: a.assetNo }, { onSuccess: () => setLinked({ ...linked, [a.assetNo]: true }) })}>
                        Link
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Matches are suggested from the plate number or VIN in the asset description, serial or inventory number. Linked vehicles are depreciated in SAP, not in the FMS posting.</p>
      </section>
    </>
  );
}

function Postings({ s, setMsg }: { s: Status; setMsg: SetMsg }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(lastMonth());
  const pv = useQuery({
    queryKey: ['sap-preview', period],
    queryFn: () => api<{ lines: Posting['lines'] & object; total: number; errors: string[]; skippedDepreciation: number; currency: string; journal: { glAccount: string; costCenter: string | null; amount: number; side: 'S' | 'H' }[] }>(`/sap/postings/preview?period=${period}`),
  });
  const post = useMutation({
    mutationFn: () => api<Posting>('/sap/postings', { method: 'POST', body: JSON.stringify({ period }) }),
    onSuccess: (p) => (setMsg({ ok: true, text: `Posting ${p.period} (version ${p.version}) queued for SAP.` }), void qc.invalidateQueries({ queryKey: ['sap'] })),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const done = s.postings.find((p) => p.period === period && (p.status === 'POSTED' || p.status === 'PENDING'));
  return (
    <>
      <section className="card table-card">
        <div className="card-head">
          <h2>Month-end posting</h2>
          <div className="inline-form" style={{ marginTop: 0 }}>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month" />
            <button className="btn btn-primary" disabled={post.isPending || !!pv.data?.errors.length || !pv.data?.lines.length} onClick={() => post.mutate()}>
              {done ? 'Post again (reverses the previous document)' : 'Post to SAP'}
            </button>
          </div>
        </div>
        {pv.data?.errors.map((e) => (
          <p key={e} className="error">
            {e}
          </p>
        ))}
        <table>
          <thead>
            <tr>
              <th>Cost centre</th>
              <th>GL account</th>
              <th>Category</th>
              <th className="num">Vehicles</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {pv.data?.lines.map((l) => (
              <tr key={`${l.costCenter}${l.glAccount}${l.category}`}>
                <td>{l.costCenter}</td>
                <td>{l.glAccount}</td>
                <td>{humanize(l.category)}</td>
                <td className="num">{l.vehicles}</td>
                <td className="num">{money(l.amount)}</td>
              </tr>
            ))}
            {pv.data && (
              <tr className="total">
                <th colSpan={4}>Total debit (credit to {s.settings.offsetAccount || 'the offset account'})</th>
                <th className="num">{money(pv.data.total)}</th>
              </tr>
            )}
          </tbody>
        </table>
        {!!pv.data?.skippedDepreciation && <p className="muted small">Depreciation of {money(pv.data.skippedDepreciation)} is left out: those vehicles are SAP fixed assets.</p>}
      </section>
      <section className="card table-card">
        <h2>History</h2>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Version</th>
              <th>Status</th>
              <th>SAP document</th>
              <th className="num">Total</th>
              <th>Posted</th>
            </tr>
          </thead>
          <tbody>
            {s.postings.map((p) => (
              <tr key={p.id}>
                <td>{p.period}</td>
                <td>{p.version}</td>
                <td>
                  <span className={`badge badge-${TONE[p.status] ?? 'muted'}`}>{humanize(p.status)}</span>
                </td>
                <td>{p.sapDocNo ?? '—'}</td>
                <td className="num">
                  {money(p.total)} {p.currency}
                </td>
                <td>{p.postedAt ? formatDateTime(p.postedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Outbox({ setMsg }: { setMsg: SetMsg }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sap-docs'], queryFn: () => api<Doc[]>('/sap/documents'), refetchInterval: 15_000 });
  const again = useMutation({ mutationFn: (id: string) => api(`/sap/documents/${id}/redeliver`, { method: 'POST' }), onSuccess: () => (setMsg({ ok: true, text: 'Queued again.' }), void qc.invalidateQueries({ queryKey: ['sap-docs'] })), onError: (e) => setMsg({ ok: false, text: errorText(e) }) });
  return (
    <section className="card table-card">
      <table>
        <thead>
          <tr>
            <th>Created</th>
            <th>Document</th>
            <th>For</th>
            <th>Status</th>
            <th>SAP no.</th>
            <th>Last error</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {q.data?.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                Nothing sent yet.
              </td>
            </tr>
          )}
          {q.data?.map((d) => (
            <tr key={d.id}>
              <td>{formatDateTime(d.createdAt)}</td>
              <td>{d.kind === 'PO' ? 'Purchase order' : d.kind === 'REVERSAL' ? 'Reversal' : 'Journal entry'}</td>
              <td>{d.ref.startsWith('wo:') ? <Link to={`/maintenance/work-orders/${d.ref.slice(3)}`}>work order</Link> : 'cost posting'}</td>
              <td>
                <span className={`badge badge-${TONE[d.status] ?? 'muted'}`}>{humanize(d.status)}</span>
                {d.status === 'PENDING' && d.attempts > 0 && <div className="muted small">try {d.attempts + 1} at {formatDateTime(d.nextAttemptAt)}</div>}
              </td>
              <td>{d.sapDocNo ?? '—'}</td>
              <td className="small">{d.lastError ?? ''}</td>
              <td>
                {d.status === 'FAILED' && (
                  <button className="btn" onClick={() => again.mutate(d.id)}>
                    Send again
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Documents are sent every minute and retried with increasing delays for about a day. A failed journal holds back later journals of the company so months stay in order.</p>
    </section>
  );
}

function Receipts() {
  const q = useQuery({ queryKey: ['sap-receipts'], queryFn: () => api<{ id: string; poNumber: string; poCheck: { ok: boolean; issues: { detail: string }[] } | null; qty: string; unitCost: string; occurredAt: string; reference: string | null; part: { partNo: string; name: string } }[]>('/sap/receipts') });
  return (
    <section className="card table-card">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>PO</th>
            <th>Part</th>
            <th className="num">Qty</th>
            <th className="num">Unit cost</th>
            <th>Check</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No receipts against a PO yet. Enter the PO number when receiving parts.
              </td>
            </tr>
          )}
          {q.data?.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.occurredAt)}</td>
              <td>{r.poNumber}</td>
              <td>
                {r.part.partNo} <span className="muted small">{r.part.name}</span>
              </td>
              <td className="num">{Number(r.qty)}</td>
              <td className="num">{money(r.unitCost)}</td>
              <td>{!r.poCheck ? <span className="badge badge-info">checking</span> : r.poCheck.ok ? <span className="badge badge-ok">matches PO</span> : <span className="badge badge-danger">{r.poCheck.issues.map((i) => i.detail).join('; ')}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Billing({ runs, setMsg }: { runs: Run[]; setMsg: SetMsg }) {
  const qc = useQueryClient();
  const to = new Date(Date.now() + 6.5 * 3_600_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const q = useQuery({ queryKey: ['sap-billing', from], queryFn: () => api<{ items: { id: string }[]; compare: { tripId: string; tripNo: string; billed: number; rated: number; diff: number }[] }>(`/sap/billing?from=${from}&to=${to}`) });
  const imp = useMutation({ mutationFn: () => api<Run>('/sap/billing/import', { method: 'POST' }), onSuccess: () => (setMsg({ ok: true, text: 'Billing documents imported.' }), void qc.invalidateQueries({ queryKey: ['sap-billing'] }), void qc.invalidateQueries({ queryKey: ['sap'] })), onError: (e) => setMsg({ ok: false, text: errorText(e) }) });
  return (
    <section className="card table-card">
      <div className="card-head">
        <h2>Billed vs rate card (last 60 days)</h2>
        <button className="btn" disabled={imp.isPending} onClick={() => imp.mutate()}>
          Import now
        </button>
      </div>
      <p className="muted small">
        {runs[0] ? `Last import ${formatDateTime(runs[0].startedAt)} · ` : ''}
        {q.data?.items.length ?? 0} billing items. SD billing documents are matched by the customer reference (delivery order or trip number).
      </p>
      <table>
        <thead>
          <tr>
            <th>Trip</th>
            <th className="num">Rate card</th>
            <th className="num">Billed in SAP</th>
            <th className="num">Difference</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.compare.map((c) => (
            <tr key={c.tripId}>
              <td>
                <Link to={`/trips/${c.tripId}`}>{c.tripNo}</Link>
              </td>
              <td className="num">{money(c.rated)}</td>
              <td className="num">{money(c.billed)}</td>
              <td className={`num${Math.abs(c.diff) > 0.01 * Math.max(c.rated, 1) ? ' text-danger' : ''}`}>{money(c.diff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
