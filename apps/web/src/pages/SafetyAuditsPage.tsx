import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, session } from '../lib/api';
import { formatDate, formatDateTime, humanize } from '../lib/format';
import type { Paginated } from '@fms/shared';
import type { Branch, Vehicle } from '../lib/types';
import { errorText } from './IncidentsPage';

interface Question {
  key: string;
  section: string;
  label: string;
  weight: number;
  critical: boolean;
}
interface Template {
  id: string;
  name: string;
  target: 'BRANCH' | 'VEHICLE';
  questions: Question[];
  passMark: number;
  active: boolean;
}
type Result = 'PASS' | 'NEEDS_ACTION' | 'FAIL';
interface Audit {
  id: string;
  auditNo: string;
  templateId: string;
  templateName: string | null;
  target: string;
  subject: string | null;
  branchId: string | null;
  vehicleId: string | null;
  performedAt: string;
  auditorName: string | null;
  score: string;
  result: Result;
  notes: string | null;
  answers?: { key: string; label: string; section: string; result: 'PASS' | 'FAIL' | 'NA'; critical: boolean; note: string | null }[];
  actions?: Action[];
}
interface Action {
  id: string;
  auditId: string;
  questionKey: string | null;
  description: string;
  ownerUserId: string | null;
  ownerName?: string | null;
  dueDate: string;
  status: 'OPEN' | 'DONE' | 'VERIFIED';
  closedAt: string | null;
  closureNote: string | null;
  verifiedAt: string | null;
  overdue?: boolean;
  audit?: { auditNo: string };
}
interface Trend {
  branchId: string;
  branchName: string;
  audits: number;
  averageScore: number | null;
  failed: number;
  openActions: number;
  overdueActions: number;
  months: { month: string; averageScore: number; audits: number }[];
}
interface UserRow {
  id: string;
  fullName: string;
  active: boolean;
}
const RESULT_TONE: Record<Result, string> = { PASS: 'ok', NEEDS_ACTION: 'warn', FAIL: 'danger' };
const ACTION_TONE = { OPEN: 'warn', DONE: 'info', VERIFIED: 'ok' } as const;

const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users'), enabled: session.can(Permission.USER_READ), select: (u) => u.filter((x) => x.active) });

/** Safety audits of sites and vehicles: list and branch trend, corrective actions, templates. */
export function SafetyAuditsPage() {
  const [sp, setSp] = useSearchParams();
  const canRead = session.can(Permission.AUDIT_SAFETY_READ);
  const tab = canRead ? (sp.get('tab') ?? 'audits') : 'mine';
  const tabs: [string, string][] = canRead
    ? [
        ['audits', 'Audits'],
        ['actions', 'Corrective actions'],
        ['mine', 'My actions'],
        ['templates', 'Templates'],
      ]
    : [['mine', 'My actions']];
  return (
    <>
      <header className="page-head">
        <h1>Safety audits</h1>
        {session.can(Permission.AUDIT_SAFETY_WRITE) && (
          <Link className="btn btn-primary" to="/audits/new">
            Perform audit
          </Link>
        )}
      </header>
      <nav className="tabs" role="tablist" aria-label="Safety audits">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setSp(k === 'audits' ? {} : { tab: k })}>
            {label}
          </button>
        ))}
      </nav>
      {tab === 'audits' ? <AuditList /> : tab === 'actions' ? <Actions mine={false} /> : tab === 'mine' ? <Actions mine /> : <Templates />}
    </>
  );
}

function AuditList() {
  const audits = useQuery({ queryKey: ['audits'], queryFn: () => api<Audit[]>('/safety-audits') });
  const trend = useQuery({ queryKey: ['audit-trend'], queryFn: () => api<Trend[]>('/safety-audits/trend') });
  const months = useMemo(() => [...new Set((trend.data ?? []).flatMap((b) => b.months.map((m) => m.month)))].sort().slice(-6), [trend.data]);
  const tone = (s: number | null | undefined) => (s == null ? '' : s >= 80 ? 'ok' : s >= 60 ? 'warn' : 'danger');
  return (
    <>
      <section className="card table-card">
        <div className="card-head">
          <h2>Average score per branch</h2>
          <span className="muted small">last 12 months, vehicle audits count for the vehicle's branch</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th className="num">Audits</th>
                <th className="num">Average</th>
                {months.map((m) => (
                  <th key={m} className="num">
                    {m}
                  </th>
                ))}
                <th className="num">Failed</th>
                <th className="num">Open actions</th>
                <th className="num">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {trend.data
                ?.filter((b) => b.audits || b.openActions)
                .map((b) => (
                  <tr key={b.branchId}>
                    <td>{b.branchName}</td>
                    <td className="num">{b.audits}</td>
                    <td className="num">{b.averageScore != null ? <span className={`badge badge-${tone(b.averageScore)}`}>{b.averageScore} %</span> : '—'}</td>
                    {months.map((m) => {
                      const x = b.months.find((y) => y.month === m);
                      return (
                        <td key={m} className="num" title={x ? `${x.audits} audit(s)` : undefined}>
                          {x ? `${x.averageScore} %` : '—'}
                        </td>
                      );
                    })}
                    <td className="num">{b.failed || '—'}</td>
                    <td className="num">{b.openActions || '—'}</td>
                    <td className="num">{b.overdueActions ? <span className="badge badge-danger">{b.overdueActions}</span> : '—'}</td>
                  </tr>
                ))}
              {trend.data && !trend.data.some((b) => b.audits) && (
                <tr>
                  <td colSpan={months.length + 6} className="muted">
                    No audits yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Audit</th>
              <th>Date</th>
              <th>Template</th>
              <th>Site / vehicle</th>
              <th className="num">Score</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {audits.data?.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link to={`/audits/${a.id}`}>{a.auditNo}</Link>
                </td>
                <td>{formatDate(a.performedAt)}</td>
                <td>{a.templateName}</td>
                <td>{a.vehicleId ? <Link to={`/vehicles/${a.vehicleId}`}>{a.subject}</Link> : a.subject}</td>
                <td className="num">{Number(a.score)} %</td>
                <td>
                  <span className={`badge badge-${RESULT_TONE[a.result]}`}>{humanize(a.result)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Actions({ mine }: { mine: boolean }) {
  const [status, setStatus] = useState(mine ? 'OPEN' : '');
  const q = useQuery({ queryKey: ['corrective-actions', mine, status], queryFn: () => api<Action[]>(`/corrective-actions?${new URLSearchParams({ ...(mine && { mine: 'true' }), ...(status && { status }) })}`) });
  return (
    <section className="card table-card">
      <div className="card-head">
        <h2>{mine ? 'Actions I am responsible for' : 'Corrective actions'}</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All</option>
          <option value="OPEN">Open</option>
          <option value="DONE">Done, to verify</option>
          <option value="VERIFIED">Verified</option>
        </select>
      </div>
      <ActionTable rows={q.data ?? []} showAudit />
    </section>
  );
}

function ActionTable({ rows, showAudit }: { rows: Action[]; showAudit?: boolean }) {
  const qc = useQueryClient();
  const me = session.user()?.id;
  const manager = session.can(Permission.AUDIT_SAFETY_WRITE);
  const [err, setErr] = useState<string | null>(null);
  const upd = useMutation({
    mutationFn: ({ id, b }: { id: string; b: unknown }) => api(`/corrective-actions/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: () => (setErr(null), void qc.invalidateQueries({ queryKey: ['corrective-actions'] }), void qc.invalidateQueries({ queryKey: ['audit'] }), void qc.invalidateQueries({ queryKey: ['audit-trend'] })),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <>
      {err && <p className="error">{err}</p>}
      <table>
        <thead>
          <tr>
            {showAudit && <th>Audit</th>}
            <th>Action</th>
            <th>Owner</th>
            <th>Due</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No actions.
              </td>
            </tr>
          )}
          {rows.map((a) => (
            <tr key={a.id}>
              {showAudit && (
                <td>
                  <Link to={`/audits/${a.auditId}`}>{a.audit?.auditNo}</Link>
                </td>
              )}
              <td>
                {a.description}
                {a.closureNote && <div className="muted small">Done: {a.closureNote}</div>}
              </td>
              <td>{a.ownerName ?? (a.ownerUserId ? '…' : <span className="muted">unassigned</span>)}</td>
              <td>
                {formatDate(a.dueDate)} {a.overdue && <span className="badge badge-danger">overdue</span>}
              </td>
              <td>
                <span className={`badge badge-${ACTION_TONE[a.status]}`}>{humanize(a.status)}</span>
                {a.verifiedAt && <div className="muted small">{formatDateTime(a.verifiedAt)}</div>}
              </td>
              <td>
                {a.status === 'OPEN' && (manager || a.ownerUserId === me) && (
                  <button
                    className="btn"
                    onClick={() => {
                      const note = window.prompt('What was done?');
                      if (note?.trim()) upd.mutate({ id: a.id, b: { action: 'DONE', closureNote: note.trim() } });
                    }}
                  >
                    Mark done
                  </button>
                )}
                {a.status === 'DONE' && manager && a.ownerUserId !== me && (
                  <button className="btn btn-primary" onClick={() => upd.mutate({ id: a.id, b: { action: 'VERIFY' } })}>
                    Verify
                  </button>
                )}
                {a.status !== 'OPEN' && manager && (
                  <button className="btn btn-ghost" onClick={() => upd.mutate({ id: a.id, b: { action: 'REOPEN' } })}>
                    Reopen
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const toLines = (q: Question[]) => q.map((x) => `${x.section} | ${x.label} | ${x.weight}${x.critical ? ' | critical' : ''}`).join('\n');
function fromLines(text: string, old: Question[]): Question[] {
  const used = new Set<string>();
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [section, label, weight, crit] = l.split('|').map((x) => x.trim());
      const prev = old.find((o) => o.label === label);
      let key = prev?.key ?? ((label || section).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36) || 'q');
      while (used.has(key)) key = `${key}_2`;
      used.add(key);
      return { key, section: label ? section : 'General', label: label || section, weight: Math.min(5, Math.max(1, Number(weight) || 1)), critical: /crit/i.test(crit ?? '') };
    });
}

function Templates() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.AUDIT_SAFETY_WRITE);
  const q = useQuery({ queryKey: ['audit-templates'], queryFn: () => api<Template[]>('/audit-templates') });
  const [edit, setEdit] = useState<Template | 'new' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (b: { id?: string; body: unknown }) => api(b.id ? `/audit-templates/${b.id}` : '/audit-templates', { method: b.id ? 'PATCH' : 'POST', body: JSON.stringify(b.body) }),
    onSuccess: () => (setEdit(null), setErr(null), void qc.invalidateQueries({ queryKey: ['audit-templates'] })),
    onError: (e) => setErr(errorText(e)),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const t = edit === 'new' ? null : edit;
    save.mutate({
      id: t?.id,
      body: { name: f.get('name'), target: f.get('target'), passMark: Number(f.get('passMark')), active: f.get('active') === 'on', questions: fromLines(String(f.get('questions')), t?.questions ?? []) },
    });
  }
  const t = edit && edit !== 'new' ? edit : null;
  return (
    <>
      {err && <p className="error">{err}</p>}
      {edit && (
        <form className="card form-grid" onSubmit={submit} key={t?.id ?? 'new'}>
          <label>
            Name
            <input name="name" required defaultValue={t?.name ?? ''} />
          </label>
          <label>
            For
            <select name="target" defaultValue={t?.target ?? 'BRANCH'}>
              <option value="BRANCH">Site / branch</option>
              <option value="VEHICLE">Vehicle</option>
            </select>
          </label>
          <label>
            Pass mark (%)
            <input name="passMark" type="number" min={1} max={100} defaultValue={t?.passMark ?? 80} />
          </label>
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={t?.active ?? true} /> Active
          </label>
          <label className="span-all">
            Questions, one per line: section | question | weight 1–5 | critical
            <textarea name="questions" rows={12} required defaultValue={t ? toLines(t.questions) : 'Fire safety | Extinguishers in date and accessible | 3 | critical\nHousekeeping | Walkways clear | 1'} />
          </label>
          <div className="span-all">
            <button className="btn btn-primary" disabled={save.isPending}>
              Save template
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <section className="card table-card">
        <div className="card-head">
          <h2>Templates</h2>
          {canWrite && !edit && (
            <button className="btn" onClick={() => setEdit('new')}>
              New template
            </button>
          )}
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>For</th>
              <th className="num">Questions</th>
              <th className="num">Critical</th>
              <th className="num">Pass mark</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((x) => (
              <tr key={x.id} className={x.active ? '' : 'muted'}>
                <td>{x.name}</td>
                <td>{x.target === 'BRANCH' ? 'Site / branch' : 'Vehicle'}</td>
                <td className="num">{x.questions.length}</td>
                <td className="num">{x.questions.filter((y) => y.critical).length}</td>
                <td className="num">{x.passMark} %</td>
                <td>
                  {canWrite && (
                    <button className="btn btn-ghost" onClick={() => setEdit(x)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">The score is the weighted share of passed items (N/A items do not count). A failed critical item fails the audit; a score below the pass mark needs action.</p>
      </section>
    </>
  );
}

/** Perform an audit: pick a template and a site or vehicle, answer each item, add corrective actions for failures. */
export function PerformAuditPage() {
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ['audit-templates'], queryFn: () => api<Template[]>('/audit-templates'), select: (t) => t.filter((x) => x.active) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const vehicles = useQuery({ queryKey: ['vehicles', 'all'], queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200'), select: (p) => p.items.filter((v) => v.status !== 'DISPOSED') });
  const users = useUsers();
  const [tplId, setTplId] = useState('');
  const [subject, setSubject] = useState('');
  const [answers, setAnswers] = useState<Record<string, { result: 'PASS' | 'FAIL' | 'NA'; note: string }>>({});
  const [actions, setActions] = useState<Record<string, { description: string; ownerUserId: string; dueDate: string }>>({});
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const tpl = templates.data?.find((t) => t.id === tplId);
  const save = useMutation({
    mutationFn: (b: unknown) => api<Audit>('/safety-audits', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: (a) => navigate(`/audits/${a.id}`),
    onError: (e) => setErr(errorText(e)),
  });
  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const sections = tpl ? [...new Set(tpl.questions.map((q) => q.section))] : [];
  const answered = tpl ? tpl.questions.filter((q) => answers[q.key]).length : 0;
  const score = useMemo(() => {
    if (!tpl) return null;
    let got = 0;
    let max = 0;
    for (const q of tpl.questions) {
      const a = answers[q.key]?.result;
      if (!a || a === 'NA') continue;
      max += q.weight;
      if (a === 'PASS') got += q.weight;
    }
    return max ? Math.round((got / max) * 1000) / 10 : null;
  }, [tpl, answers]);
  function submit() {
    if (!tpl) return;
    save.mutate({
      templateId: tpl.id,
      ...(tpl.target === 'BRANCH' ? { branchId: subject } : { vehicleId: subject }),
      notes: notes || null,
      answers: tpl.questions.map((q) => ({ key: q.key, result: answers[q.key]?.result, note: answers[q.key]?.note || null })),
      actions: Object.entries(actions)
        .filter(([k, a]) => answers[k]?.result === 'FAIL' && a.description.trim())
        .map(([k, a]) => ({ questionKey: k, description: a.description.trim(), ownerUserId: a.ownerUserId || null, dueDate: a.dueDate || inTwoWeeks })),
    });
  }
  return (
    <>
      <header className="page-head">
        <h1>Perform safety audit</h1>
      </header>
      {err && <p className="error">{err}</p>}
      <section className="card form-grid">
        <label>
          Template
          <select value={tplId} onChange={(e) => (setTplId(e.target.value), setSubject(''), setAnswers({}), setActions({}))}>
            <option value="">Choose…</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {tpl && (
          <label>
            {tpl.target === 'BRANCH' ? 'Site / branch' : 'Vehicle'}
            <select value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Choose…</option>
              {tpl.target === 'BRANCH'
                ? branches.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))
                : vehicles.data?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plateNumber}
                    </option>
                  ))}
            </select>
          </label>
        )}
        {tpl && (
          <div className="muted">
            {answered} of {tpl.questions.length} answered · score {score != null ? `${score} %` : '—'} (pass mark {tpl.passMark} %)
          </div>
        )}
      </section>
      {tpl &&
        sections.map((s) => (
          <section className="card" key={s}>
            <h2>{s}</h2>
            {tpl.questions
              .filter((q) => q.section === s)
              .map((q) => {
                const a = answers[q.key];
                const set = (patch: Partial<{ result: 'PASS' | 'FAIL' | 'NA'; note: string }>) => setAnswers({ ...answers, [q.key]: { result: a?.result ?? 'PASS', note: a?.note ?? '', ...patch } });
                const act = actions[q.key] ?? { description: '', ownerUserId: '', dueDate: inTwoWeeks };
                return (
                  <div className="audit-q" key={q.key}>
                    <span>
                      {q.label}
                      {q.critical && <span className="badge badge-danger"> critical</span>}
                      {q.weight > 1 && <span className="muted small"> ×{q.weight}</span>}
                    </span>
                    <span className="chips" role="radiogroup" aria-label={q.label}>
                      {(['PASS', 'FAIL', 'NA'] as const).map((r) => (
                        <button key={r} type="button" role="radio" aria-checked={a?.result === r} className={`chip${a?.result === r ? ' on' : ''}`} onClick={() => set({ result: r })}>
                          {r === 'NA' ? 'N/A' : humanize(r)}
                        </button>
                      ))}
                    </span>
                    {a?.result === 'FAIL' && (
                      <div className="form-grid span-all">
                        <label>
                          Finding
                          <input value={a.note} onChange={(e) => set({ note: e.target.value })} placeholder="What is wrong" />
                        </label>
                        <label>
                          Corrective action
                          <input value={act.description} onChange={(e) => setActions({ ...actions, [q.key]: { ...act, description: e.target.value } })} placeholder="What must be done" />
                        </label>
                        <label>
                          Owner
                          <select value={act.ownerUserId} onChange={(e) => setActions({ ...actions, [q.key]: { ...act, ownerUserId: e.target.value } })}>
                            <option value="">Unassigned</option>
                            {users.data?.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.fullName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Due
                          <input type="date" value={act.dueDate} onChange={(e) => setActions({ ...actions, [q.key]: { ...act, dueDate: e.target.value } })} />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
          </section>
        ))}
      {tpl && (
        <section className="card">
          <label>
            Notes
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={!subject || answered < tpl.questions.length || save.isPending} onClick={submit}>
            Submit audit
          </button>
          {answered < tpl.questions.length && <span className="muted small"> Answer every item first.</span>}
        </section>
      )}
    </>
  );
}

/** One audit: answers, score and its corrective actions. */
export function AuditDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const users = useUsers();
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['audit', id], queryFn: () => api<Audit>(`/safety-audits/${id}`), enabled: session.can(Permission.AUDIT_SAFETY_READ) });
  const add = useMutation({
    mutationFn: (b: unknown) => api(`/safety-audits/${id}/actions`, { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => (setErr(null), void qc.invalidateQueries({ queryKey: ['audit', id] })),
    onError: (e) => setErr(errorText(e)),
  });
  const a = q.data;
  if (!session.can(Permission.AUDIT_SAFETY_READ)) return <Actions mine />;
  if (!a) return null;
  const names = new Map(users.data?.map((u) => [u.id, u.fullName]));
  const failed = a.answers?.filter((x) => x.result === 'FAIL') ?? [];
  return (
    <>
      <header className="page-head">
        <h1>
          {a.auditNo} · {a.subject}
        </h1>
        <span className={`badge badge-${RESULT_TONE[a.result]}`}>
          {humanize(a.result)} · {Number(a.score)} %
        </span>
      </header>
      <p className="muted">
        {a.templateName} · {formatDateTime(a.performedAt)}
        {a.auditorName ? ` · ${a.auditorName}` : ''}
      </p>
      {a.notes && <p>{a.notes}</p>}
      {err && <p className="error">{err}</p>}
      <section className="card table-card">
        <div className="card-head">
          <h2>Corrective actions</h2>
        </div>
        <ActionTable rows={(a.actions ?? []).map((x) => ({ ...x, ownerName: x.ownerUserId ? (names.get(x.ownerUserId) ?? null) : null, overdue: x.status === 'OPEN' && x.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10) }))} />
        {session.can(Permission.AUDIT_SAFETY_WRITE) && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              add.mutate({ description: f.get('description'), ownerUserId: f.get('owner') || null, dueDate: f.get('due'), questionKey: f.get('question') || null });
              e.currentTarget.reset();
            }}
          >
            <select name="question" aria-label="Finding">
              <option value="">General</option>
              {failed.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
            <input name="description" required minLength={3} placeholder="New corrective action" aria-label="Action" />
            <select name="owner" aria-label="Owner">
              <option value="">Unassigned</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
            <input name="due" type="date" required aria-label="Due date" />
            <button className="btn">Add action</button>
          </form>
        )}
      </section>
      <section className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Section</th>
              <th>Item</th>
              <th>Result</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {a.answers?.map((x) => (
              <tr key={x.key}>
                <td className="muted small">{x.section}</td>
                <td>
                  {x.label}
                  {x.critical && <span className="badge badge-danger"> critical</span>}
                </td>
                <td>
                  <span className={`badge badge-${x.result === 'PASS' ? 'ok' : x.result === 'FAIL' ? 'danger' : 'muted'}`}>{x.result === 'NA' ? 'N/A' : humanize(x.result)}</span>
                </td>
                <td>{x.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
