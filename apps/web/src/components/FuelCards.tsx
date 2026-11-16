import { Paginated, Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { accessToken, api, session } from '../lib/api';
import { formatDateTime, money } from '../lib/format';
import type { Vehicle } from '../lib/types';
import { errorText } from '../pages/IncidentsPage';

interface Card {
  id: string;
  provider: string;
  last4: string;
  label: string | null;
  vehicleId: string | null;
  active: boolean;
}
interface Txn {
  id: string;
  externalId: string;
  provider: string;
  cardLast4: string;
  plateNumber: string | null;
  occurredAt: string;
  station: string | null;
  product: string | null;
  litres: number | null;
  amount: number;
  status: string;
  differences: { litres?: number; amount?: number; minutes?: number } | null;
  note: string | null;
  record: { id: string; filledAt: string; litres: string; totalCost: string } | null;
}
interface Mapping {
  provider: string;
  columns: Record<string, string | null | undefined>;
  dateFormat: 'YMD' | 'DMY' | 'MDY';
}
interface Preview {
  headers: string[];
  savedMappings: Record<string, Mapping>;
  preview: {
    row: number;
    externalId: string;
    card: string;
    occurredAt: string;
    amount: number;
    litres: number | null;
    product: string | null;
    nonFuel: boolean;
  }[];
  errors: { row: number; message: string }[];
  total: number;
  valid?: number;
}

const FIELDS: [keyof Mapping['columns'] & string, string, boolean][] = [
  ['occurredAt', 'Date & time', true],
  ['card', 'Card number', true],
  ['amount', 'Amount', true],
  ['litres', 'Litres', false],
  ['station', 'Station', false],
  ['product', 'Product', false],
  ['plate', 'Plate', false],
  ['externalId', 'Transaction ID', false],
];
const TONE: Record<string, string> = {
  MATCHED: 'ok',
  ACCEPTED: 'ok',
  MISMATCH: 'danger',
  CARD_ONLY: 'warn',
  NON_FUEL: 'muted',
};
const STATUS: Record<string, string> = {
  MATCHED: 'Matched',
  ACCEPTED: 'Accepted',
  MISMATCH: 'Mismatch',
  CARD_ONLY: 'Not recorded in FMS',
  NON_FUEL: 'Not fuel',
};

/** Upload with the session token (multipart; the shared api() helper sends JSON). */
async function upload(file: File, mapping: Mapping | null, commit: boolean) {
  const body = new FormData();
  body.append('file', file);
  if (mapping) body.append('mapping', JSON.stringify(mapping));
  if (commit) body.append('commit', 'true');
  const res = await fetch('/api/fuel/card-statements', {
    method: 'POST',
    body,
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      json.errors
        ?.map((e: { path: string; message: string }) => `${e.path}: ${e.message}`)
        .join('; ') ??
        json.message ??
        `Error ${res.status}`,
    );
  return json;
}

export function FuelCards() {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.FUEL_WRITE);
  const [status, setStatus] = useState('MISMATCH,CARD_ONLY');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const cards = useQuery({ queryKey: ['fuel-cards'], queryFn: () => api<Card[]>('/fuel/cards') });
  const vehicles = useQuery({
    queryKey: ['vehicles', 'all'],
    queryFn: () => api<Paginated<Vehicle>>('/vehicles?pageSize=200'),
  });
  const statuses = status.split(',');
  const txns = useQuery({
    queryKey: ['card-txns', status],
    queryFn: async () => {
      const pages = await Promise.all(
        statuses.map((s) =>
          api<Paginated<Txn> & { summary: Record<string, { count: number; amount: number }> }>(
            `/fuel/card-transactions?status=${s}&pageSize=100`,
          ),
        ),
      );
      return {
        items: pages
          .flatMap((p) => p.items)
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
        summary: pages[0]?.summary ?? {},
      };
    },
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['card-txns'] });
    void qc.invalidateQueries({ queryKey: ['fuel-cards'] });
  };
  const plate = (id: string | null) =>
    vehicles.data?.items.find((v) => v.id === id)?.plateNumber ?? '—';

  const addCard = useMutation({
    mutationFn: (b: Record<string, unknown>) =>
      api('/fuel/cards', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => (setMsg({ ok: true, text: 'Card added.' }), refresh()),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const setCardVehicle = useMutation({
    mutationFn: ({ id, vehicleId }: { id: string; vehicleId: string | null }) =>
      api(`/fuel/cards/${id}`, { method: 'PATCH', body: JSON.stringify({ vehicleId }) }),
    onSuccess: refresh,
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const review = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/fuel/card-transactions/${id}/review`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => (
      setMsg(null),
      refresh(),
      void qc.invalidateQueries({ queryKey: ['fuel-records'] })
    ),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const sync = useMutation({
    mutationFn: () =>
      api<{ imported: number; status: { matched: number; mismatched: number } }>(
        '/fuel/card-sync',
        { method: 'POST' },
      ),
    onSuccess: (r) => (
      setMsg({
        ok: true,
        text: `Synced: ${r.imported} new transaction(s), ${r.status.matched} matched, ${r.status.mismatched} mismatched.`,
      }),
      refresh()
    ),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });

  async function pick(f: File | null) {
    setFile(f);
    setPreview(null);
    setMapping(null);
    if (!f) return;
    setBusy(true);
    try {
      const p: Preview = await upload(f, null, false);
      // Reuse a saved mapping whose columns all exist in this file, else guess by header names.
      const saved = Object.values(p.savedMappings).find((m) =>
        FIELDS.filter(([, , req]) => req).every(([k]) => p.headers.includes(String(m.columns[k]))),
      );
      const guess = (re: RegExp) => p.headers.find((h) => re.test(h)) ?? null;
      const m: Mapping = saved ?? {
        provider: '',
        dateFormat: 'DMY',
        columns: {
          occurredAt: guess(/date|time/i),
          card: guess(/card/i),
          amount: guess(/amount|total|value/i),
          litres: guess(/lit|qty|quantity|volume/i),
          station: guess(/station|site|merchant/i),
          product: guess(/product|item|grade/i),
          plate: guess(/plate|vehicle|reg/i),
          externalId: guess(/^(txn|trans|ref|id)/i),
        },
      };
      setMapping(m);
      setPreview(p);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function run(commit: boolean) {
    if (!file || !mapping) return;
    if (!mapping.provider.trim()) return setMsg({ ok: false, text: 'Name the card provider' });
    setBusy(true);
    try {
      const clean = {
        ...mapping,
        provider: mapping.provider.trim(),
        columns: Object.fromEntries(Object.entries(mapping.columns).filter(([, v]) => v)),
      };
      const r = await upload(file, clean as Mapping, commit);
      if (commit) {
        setMsg({
          ok: true,
          text: `Imported ${r.imported} transaction(s) (${r.duplicates} already there): ${r.status.matched} matched, ${r.status.mismatched} mismatched, ${r.status.cardOnly} not recorded in FMS.${r.errors.length ? ` ${r.errors.length} row(s) skipped.` : ''}`,
        });
        setFile(null);
        setPreview(null);
        setMapping(null);
        refresh();
      } else setPreview(r);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  function submitCard(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addCard.mutate({
      provider: f.get('provider'),
      number: f.get('number'),
      label: f.get('label') || null,
      vehicleId: f.get('vehicleId') || null,
    });
    e.currentTarget.reset();
  }

  const sum = txns.data?.summary ?? {};
  return (
    <>
      <header className="page-head">
        <h1>Fuel cards</h1>
        {canWrite && (
          <div className="actions">
            <button
              className="btn"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
              title="Pull new transactions from the card provider API"
            >
              Sync from provider
            </button>
          </div>
        )}
      </header>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}

      <section className="card table-card">
        <div className="card-head">
          <h2>Reconciliation</h2>
          <div className="actions">
            {[
              ['MISMATCH,CARD_ONLY', 'To review'],
              ['MATCHED,ACCEPTED', 'Settled'],
              ['NON_FUEL', 'Not fuel'],
            ].map(([k, l]) => (
              <button
                key={k}
                className={status === k ? 'btn btn-primary' : 'btn'}
                onClick={() => setStatus(k)}
              >
                {l}
                {k === 'MISMATCH,CARD_ONLY' &&
                  (sum.MISMATCH?.count ?? 0) + (sum.CARD_ONLY?.count ?? 0) > 0 &&
                  ` (${(sum.MISMATCH?.count ?? 0) + (sum.CARD_ONLY?.count ?? 0)})`}
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Card</th>
                <th>Vehicle</th>
                <th>Station / product</th>
                <th className="num">Litres</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>FMS record</th>
              </tr>
            </thead>
            <tbody>
              {txns.data?.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Nothing here.
                  </td>
                </tr>
              )}
              {txns.data?.items.map((t) => (
                <tr key={t.id}>
                  <td>{formatDateTime(t.occurredAt)}</td>
                  <td>
                    {t.provider} ****{t.cardLast4}
                  </td>
                  <td>{t.plateNumber ?? <span className="muted">unassigned card</span>}</td>
                  <td>
                    {t.station ?? '—'} <span className="muted">{t.product}</span>
                  </td>
                  <td className="num">{t.litres ?? '—'}</td>
                  <td className="num">{money(t.amount)}</td>
                  <td>
                    <span className={`badge badge-${TONE[t.status] ?? 'muted'}`}>
                      {STATUS[t.status] ?? t.status}
                    </span>
                    {t.differences &&
                      (t.differences.amount != null || t.differences.litres != null) && (
                        <span className="muted small">
                          {' '}
                          {t.differences.amount != null &&
                            `amount ${t.differences.amount > 0 ? '+' : ''}${money(t.differences.amount)}`}
                          {t.differences.litres != null &&
                            ` litres ${t.differences.litres > 0 ? '+' : ''}${t.differences.litres}`}{' '}
                          in FMS
                        </span>
                      )}
                    {t.note && <div className="muted small">{t.note}</div>}
                    {canWrite && (
                      <div className="row-actions">
                        {t.status === 'MISMATCH' && (
                          <button
                            className="link"
                            onClick={() => {
                              const note = prompt('Why is the difference acceptable?');
                              if (note)
                                review.mutate({ id: t.id, body: { action: 'accept', note } });
                            }}
                          >
                            Accept
                          </button>
                        )}
                        {t.status === 'CARD_ONLY' && t.plateNumber && t.litres != null && (
                          <button
                            className="link"
                            onClick={() => {
                              const odo = prompt(`Odometer (km) of ${t.plateNumber} at this fill`);
                              if (odo && Number(odo) >= 0)
                                review.mutate({
                                  id: t.id,
                                  body: { action: 'create_record', odometerKm: Number(odo) },
                                });
                            }}
                          >
                            Record fill
                          </button>
                        )}
                        {t.status === 'CARD_ONLY' && (
                          <button
                            className="link"
                            onClick={() => {
                              const note = prompt(
                                'Why was this not a recorded fill? (e.g. paid for another company vehicle)',
                              );
                              if (note)
                                review.mutate({ id: t.id, body: { action: 'accept', note } });
                            }}
                          >
                            Accept
                          </button>
                        )}
                        {t.status !== 'NON_FUEL' && t.status !== 'MATCHED' && (
                          <button
                            className="link"
                            onClick={() =>
                              review.mutate({ id: t.id, body: { action: 'non_fuel' } })
                            }
                          >
                            Not fuel
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {t.record ? `${Number(t.record.litres)} L · ${money(t.record.totalCost)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canWrite && (
        <section className="card">
          <h2>Import a statement</h2>
          <p className="muted">
            CSV or Excel export from the card provider. Columns are matched once per provider and
            remembered. Rows already imported are skipped.
          </p>
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            aria-label="Statement file"
          />
          {mapping && preview && (
            <>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <label>
                  Provider
                  <input
                    value={mapping.provider}
                    onChange={(e) =>
                      setMapping({ ...mapping, provider: e.target.value.toUpperCase() })
                    }
                    placeholder="e.g. MPT, Max Energy"
                  />
                </label>
                <label>
                  Date order
                  <select
                    value={mapping.dateFormat}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        dateFormat: e.target.value as Mapping['dateFormat'],
                      })
                    }
                  >
                    <option value="DMY">day/month/year</option>
                    <option value="MDY">month/day/year</option>
                    <option value="YMD">year-month-day</option>
                  </select>
                </label>
                {FIELDS.map(([k, label, req]) => (
                  <label key={k}>
                    {label}
                    {req && ' *'}
                    <select
                      value={mapping.columns[k] ?? ''}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          columns: { ...mapping.columns, [k]: e.target.value || null },
                        })
                      }
                    >
                      <option value="">{req ? 'Choose a column' : '— not in file —'}</option>
                      {preview.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button className="btn" disabled={busy} onClick={() => void run(false)}>
                  Preview
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || preview.valid == null}
                  onClick={() => void run(true)}
                >
                  Import {preview.valid != null ? `${preview.valid} row(s)` : ''}
                </button>
              </div>
              {preview.valid != null && (
                <>
                  <p className="muted small">
                    {preview.total} rows · {preview.valid} readable
                    {preview.errors.length
                      ? ` · ${preview.errors.length} skipped: ${preview.errors
                          .slice(0, 3)
                          .map((e) => `row ${e.row} ${e.message}`)
                          .join('; ')}`
                      : ''}
                  </p>
                  <div className="table-scroll">
                    <table>
                      <tbody>
                        {preview.preview.map((r) => (
                          <tr key={r.row}>
                            <td className="muted">row {r.row}</td>
                            <td>{formatDateTime(r.occurredAt)}</td>
                            <td>****{r.card}</td>
                            <td>{r.product}</td>
                            <td className="num">{r.litres ?? '—'}</td>
                            <td className="num">{money(r.amount)}</td>
                            <td>
                              {r.nonFuel && <span className="badge badge-muted">not fuel</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      <section className="card table-card">
        <div className="card-head">
          <h2>Cards</h2>
        </div>
        {canWrite && (
          <form className="inline-form" onSubmit={submitCard} style={{ padding: '0 16px 12px' }}>
            <input name="provider" required placeholder="Provider" aria-label="Provider" />
            <input
              name="number"
              required
              placeholder="Card number or last 4"
              aria-label="Card number"
            />
            <input name="label" placeholder="Label (optional)" aria-label="Label" />
            <select name="vehicleId" aria-label="Vehicle" defaultValue="">
              <option value="">No vehicle</option>
              {vehicles.data?.items.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={addCard.isPending}>
              Add card
            </button>
          </form>
        )}
        <table>
          <tbody>
            {cards.data?.length === 0 && (
              <tr>
                <td className="muted">No cards yet. Only the last 4 digits are stored.</td>
              </tr>
            )}
            {cards.data?.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.provider} ****{c.last4}
                </td>
                <td>{c.label}</td>
                <td>
                  {canWrite ? (
                    <select
                      aria-label={`Vehicle for card ${c.last4}`}
                      value={c.vehicleId ?? ''}
                      onChange={(e) =>
                        setCardVehicle.mutate({ id: c.id, vehicleId: e.target.value || null })
                      }
                    >
                      <option value="">No vehicle</option>
                      {vehicles.data?.items.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plateNumber}
                        </option>
                      ))}
                    </select>
                  ) : (
                    plate(c.vehicleId)
                  )}
                </td>
                <td>{!c.active && <span className="badge badge-muted">inactive</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
