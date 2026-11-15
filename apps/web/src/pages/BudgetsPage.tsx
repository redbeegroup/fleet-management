import { CostCategory, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, session } from '../lib/api';
import { humanize, money } from '../lib/format';
import type { BudgetCell, BudgetGrid } from '../lib/types';
import { errorText } from './IncidentsPage';

const MONTH = (p: string) =>
  new Date(`${p}-01T00:00`).toLocaleDateString('en-GB', { month: 'short' });
const TONE: Record<string, string> = {
  OK: 'ok',
  AT_RISK: 'warn',
  OVER: 'danger',
  NO_BUDGET: 'muted',
};
const STATUS_TEXT: Record<string, string> = {
  OK: 'on track',
  AT_RISK: 'at risk',
  OVER: 'over',
  NO_BUDGET: '',
};

/** Monthly budgets per branch, department or company and cost category, with actuals from the cost ledger. */
export function BudgetsPage() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.BUDGET_WRITE);
  const [year, setYear] = useState(new Date().getFullYear());
  const [dimension, setDimension] = useState<'branch' | 'department' | 'company'>('branch');
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { data } = useQuery({
    queryKey: ['budgets', year, dimension],
    queryFn: () => api<BudgetGrid>(`/costs/budgets?year=${year}&dimension=${dimension}`),
  });

  useEffect(() => {
    setEdits({});
    setExtra([]);
  }, [year, dimension, scopeKey]);
  useEffect(() => {
    if (data && !data.scopes.some((s) => s.key === scopeKey))
      setScopeKey((data.scopes.find((s) => s.budget || s.actual) ?? data.scopes[0])?.key ?? null);
  }, [data, scopeKey]);
  const scope = data?.scopes.find((s) => s.key === scopeKey) ?? null;

  const rows = useMemo(() => {
    if (!scope) return [];
    const have = new Set(scope.lines.map((l) => l.category));
    return [
      ...scope.lines,
      ...extra
        .filter((c) => !have.has(c))
        .map((category) => ({
          category,
          budget: 0,
          actual: 0,
          months: data!.periods.map(
            (period) =>
              ({
                period,
                budget: null,
                actual: 0,
                variance: null,
                usedPct: null,
                forecast: 0,
                status: 'NO_BUDGET',
              }) as BudgetCell,
          ),
        })),
    ];
  }, [scope, extra, data]);

  const save = useMutation({
    mutationFn: () => {
      const lines = Object.entries(edits).map(([k, v]) => {
        const [category, period] = k.split('|');
        return {
          period,
          category,
          amount: v.trim() === '' ? null : Number(v),
          branchId: dimension === 'branch' ? scope!.id : null,
          departmentId: dimension === 'department' ? scope!.id : null,
        };
      });
      return api<{ saved: number; removed: number }>('/costs/budgets', {
        method: 'PUT',
        body: JSON.stringify({ lines }),
      });
    },
    onSuccess: (r) => {
      setEdits({});
      setMsg({
        ok: true,
        text: `Saved ${r.saved} budget line(s)${r.removed ? `, removed ${r.removed}` : ''}.`,
      });
      void qc.invalidateQueries({ queryKey: ['budgets'] });
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const copy = useMutation({
    mutationFn: (changePct: number) =>
      api<{ copied: number; skipped: number }>('/costs/budgets/copy', {
        method: 'POST',
        body: JSON.stringify({ fromYear: year - 1, toYear: year, changePct }),
      }),
    onSuccess: (r) => {
      setMsg({
        ok: true,
        text: `Copied ${r.copied} line(s) from ${year - 1}${r.skipped ? `; ${r.skipped} already set and kept` : ''}.`,
      });
      void qc.invalidateQueries({ queryKey: ['budgets'] });
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });

  const dirty = Object.keys(edits).length > 0;
  const cur = data?.currency ?? '';
  const cell = (category: string, m: BudgetCell) => {
    const k = `${category}|${m.period}`;
    const value = edits[k] ?? (m.budget != null ? String(m.budget) : '');
    return (
      <td key={m.period} className={`budget-cell tone-${TONE[m.status]}`}>
        {canWrite ? (
          <input
            aria-label={`${humanize(category)} budget ${m.period}`}
            inputMode="decimal"
            value={value}
            placeholder="—"
            onChange={(e) =>
              setEdits((x) => ({ ...x, [k]: e.target.value.replace(/[^\d.]/g, '') }))
            }
          />
        ) : (
          <span className="num">{m.budget != null ? money(m.budget) : '—'}</span>
        )}
        <span
          className="budget-actual"
          title={
            m.usedPct != null
              ? `${m.usedPct} % used · forecast ${money(m.forecast)}`
              : `forecast ${money(m.forecast)}`
          }
        >
          {m.actual ? money(m.actual) : ''}
          {m.status !== 'NO_BUDGET' && m.actual > 0 ? ` · ${STATUS_TEXT[m.status]}` : ''}
        </span>
      </td>
    );
  };

  return (
    <>
      <header className="page-head">
        <h1>Budgets</h1>
        <div className="actions">
          <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[-1, 0, 1].map((d) => {
              const y = new Date().getFullYear() + d;
              return (
                <option key={y} value={y}>
                  {y}
                </option>
              );
            })}
          </select>
          <div className="segmented" role="tablist">
            {(['branch', 'department', 'company'] as const).map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={dimension === d}
                className={dimension === d ? 'btn btn-primary' : 'btn'}
                onClick={() => setDimension(d)}
              >
                {d === 'branch' ? 'Branches' : d === 'department' ? 'Departments' : 'Company'}
              </button>
            ))}
          </div>
          {canWrite && (
            <button
              className="btn"
              disabled={copy.isPending}
              onClick={() => {
                const pct = prompt(`Copy all ${year - 1} budgets into ${year}. Change by (%)`, '0');
                if (pct !== null && !Number.isNaN(Number(pct))) copy.mutate(Number(pct));
              }}
            >
              Copy from {year - 1}
            </button>
          )}
        </div>
      </header>
      <p className="muted">
        Actuals come from the cost ledger: approved fuel and expenses, completed work orders,
        document fees, depreciation or lease, and shared costs allocated by km. Vehicles count
        towards their current branch and department.
      </p>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
      {data && data.scopes.length === 0 && (
        <p className="muted">No {dimension === 'branch' ? 'branches' : 'departments'} yet.</p>
      )}
      <div className="budget-layout">
        <nav className="card budget-scopes" aria-label="Budget scopes">
          {data?.scopes.map((s) => {
            const over = s.months.filter((m) => m.status === 'OVER').length;
            const risk = s.months.filter((m) => m.status === 'AT_RISK').length;
            return (
              <button
                key={s.key}
                className={s.key === scopeKey ? 'active' : ''}
                onClick={() => setScopeKey(s.key)}
              >
                <strong>{s.name}</strong>
                <span className="muted small">
                  {s.budget
                    ? `${money(s.actual)} of ${money(s.budget)}`
                    : s.actual
                      ? `${money(s.actual)} spent, no budget`
                      : 'no budget'}
                </span>
                {(over > 0 || risk > 0) && (
                  <span className={`badge badge-${over ? 'danger' : 'warn'}`}>
                    {over ? `${over} month(s) over` : `${risk} at risk`}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        {scope && data && (
          <section className="card table-card">
            <div className="card-head">
              <h2>
                {scope.name} · {year} <span className="muted small">({cur})</span>
              </h2>
              {canWrite && (
                <div className="actions">
                  <select
                    aria-label="Add a category"
                    value=""
                    onChange={(e) => e.target.value && setExtra((x) => [...x, e.target.value])}
                  >
                    <option value="">Add category…</option>
                    {Object.values(CostCategory)
                      .filter((c) => !rows.some((r) => r.category === c))
                      .map((c) => (
                        <option key={c} value={c}>
                          {humanize(c)}
                        </option>
                      ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    disabled={!dirty || save.isPending}
                    onClick={() => save.mutate()}
                  >
                    Save budgets
                  </button>
                </div>
              )}
            </div>
            <div className="table-scroll">
              <table className="budget-grid">
                <thead>
                  <tr>
                    <th>Category</th>
                    {data.periods.map((p) => (
                      <th key={p} className="num">
                        {MONTH(p)}
                      </th>
                    ))}
                    <th className="num">Year</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={14} className="muted">
                        No budget or cost yet{canWrite ? ' — add a category to start.' : '.'}
                      </td>
                    </tr>
                  )}
                  {rows.map((l) => (
                    <tr key={l.category}>
                      <th scope="row">{humanize(l.category)}</th>
                      {l.months.map((m) => cell(l.category, m))}
                      <td className="num">
                        <strong>{money(l.budget)}</strong>
                        <span className="budget-actual">{money(l.actual)}</span>
                      </td>
                    </tr>
                  ))}
                  {rows.length > 0 && (
                    <tr className="total">
                      <th scope="row">Total</th>
                      {scope.months.map((m) => (
                        <td key={m.period} className={`num tone-${TONE[m.status]}`}>
                          <strong>{m.budget ? money(m.budget) : '—'}</strong>
                          <span className="budget-actual">{m.actual ? money(m.actual) : ''}</span>
                        </td>
                      ))}
                      <td className="num">
                        <strong>{money(scope.budget)}</strong>
                        <span className="budget-actual">{money(scope.actual)}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ padding: '0 16px 12px' }}>
              Each cell: budget (editable) and actual spend below. Colour: green on track, amber ≥
              90 % used or forecast above budget, red over budget. Clear a cell to remove that
              budget.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
