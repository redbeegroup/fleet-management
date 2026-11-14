import { ApiScope, WebhookEvent } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import type { ApiKeyRow, WebhookDeliveryRow, WebhookEndpointRow } from '../lib/types';
import { errorText } from './IncidentsPage';

const DELIVERY_TONE = { PENDING: 'warn', SENT: 'ok', FAILED: 'danger' } as const;

/** Shows a secret exactly once with a copy button. */
function SecretOnce({
  label,
  value,
  onClose,
}: {
  label: string;
  value: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card secret-once">
      <strong>{label}</strong>
      <p className="muted">Copy it now — it will not be shown again.</p>
      <code>{value}</code>
      <div className="actions">
        <button
          className="btn"
          onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

export function IntegrationsPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Integrations</h1>
          <p className="muted">
            API keys for your DMS and other systems (contract:{' '}
            <a href="/api/integrations/docs">/api/integrations/docs</a>) and webhooks that push FMS
            events to them.
          </p>
        </div>
      </header>
      <ApiKeys />
      <Webhooks />
    </>
  );
}

function ApiKeys() {
  const qc = useQueryClient();
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api<ApiKeyRow[]>('/integrations/api-keys'),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<ApiKeyRow>('/integrations/api-keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (k) => {
      setCreated(k.key ?? null);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/integrations/api-keys/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      name: f.get('name'),
      scopes: f.getAll('scopes'),
      expiresAt: f.get('expiresAt') ? new Date(f.get('expiresAt') as string).toISOString() : null,
    });
    e.currentTarget.reset();
  }
  return (
    <section className="card">
      <h2>API keys</h2>
      {created && (
        <SecretOnce
          label="New API key (send it in the X-API-Key header)"
          value={created}
          onClose={() => setCreated(null)}
        />
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Scopes</th>
              <th>Last used</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No API keys yet.
                </td>
              </tr>
            )}
            {data?.map((k) => {
              const expired = k.expiresAt && new Date(k.expiresAt) < new Date();
              return (
                <tr key={k.id} className={k.revokedAt || expired ? 'inactive' : ''}>
                  <td>{k.name}</td>
                  <td>
                    <code>fms_{k.prefix}_…</code>
                  </td>
                  <td>{k.scopes.join(', ')}</td>
                  <td>{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : 'never'}</td>
                  <td>{k.expiresAt ? formatDate(k.expiresAt) : '—'}</td>
                  <td>
                    {k.revokedAt ? (
                      <span className="badge badge-danger">revoked</span>
                    ) : expired ? (
                      <span className="badge badge-muted">expired</span>
                    ) : (
                      <span className="badge badge-ok">active</span>
                    )}
                  </td>
                  <td>
                    {!k.revokedAt && (
                      <button
                        className="link danger"
                        onClick={() =>
                          confirm(
                            `Revoke "${k.name}"? Systems using it stop working immediately.`,
                          ) && revoke.mutate(k.id)
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="error">{error}</p>}
      <form className="inline-form" onSubmit={submit}>
        <input
          name="name"
          required
          minLength={2}
          placeholder="Name, e.g. DMS production"
          aria-label="Key name"
        />
        {Object.values(ApiScope).map((s) => (
          <label key={s} className="check">
            <input
              type="checkbox"
              name="scopes"
              value={s}
              defaultChecked={s.startsWith('orders')}
            />{' '}
            {s}
          </label>
        ))}
        <input name="expiresAt" type="date" aria-label="Expires" title="Optional expiry date" />
        <button className="btn btn-primary" disabled={create.isPending}>
          Create key
        </button>
      </form>
    </section>
  );
}

function Webhooks() {
  const qc = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const { data } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api<WebhookEndpointRow[]>('/integrations/webhooks'),
  });
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', deliveryStatus],
    queryFn: () =>
      api<WebhookDeliveryRow[]>(
        `/integrations/webhook-deliveries?take=50${deliveryStatus ? `&status=${deliveryStatus}` : ''}`,
      ),
    refetchInterval: 15_000,
  });
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['webhooks'] });
    void qc.invalidateQueries({ queryKey: ['webhook-deliveries'] });
  };
  const onError = (e: Error) => setError(errorText(e));
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<WebhookEndpointRow>('/integrations/webhooks', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (w) => {
      setSecret(w.secret ?? null);
      setShowForm(false);
      refresh();
    },
    onError,
  });
  const call = useMutation({
    mutationFn: ({
      path,
      method = 'POST',
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) => api<{ secret?: string }>(path, { method, body: body ? JSON.stringify(body) : undefined }),
    onSuccess: (r) => {
      if (r && 'secret' in r && r.secret) setSecret(r.secret);
      refresh();
    },
    onError,
  });
  const urlOf = (id: string) => data?.find((w) => w.id === id)?.url ?? id;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({
      url: f.get('url'),
      description: (f.get('description') as string) || null,
      events: f.getAll('events'),
    });
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Webhooks</h2>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'Add endpoint'}
        </button>
      </div>
      {secret && (
        <SecretOnce
          label="Signing secret (verify X-FMS-Signature with it)"
          value={secret}
          onClose={() => setSecret(null)}
        />
      )}
      {error && <p className="error">{error}</p>}
      {showForm && (
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>
              URL (https)
              <input
                name="url"
                type="url"
                required
                placeholder="https://dms.example.com/fms/webhook"
              />
            </label>
            <label>
              Description
              <input name="description" />
            </label>
          </div>
          <fieldset className="chips">
            <legend>Events</legend>
            {Object.values(WebhookEvent).map((ev) => (
              <label key={ev} className="check">
                <input
                  type="checkbox"
                  name="events"
                  value={ev}
                  defaultChecked={ev.startsWith('order.') || ev.startsWith('trip.')}
                />{' '}
                {ev}
              </label>
            ))}
          </fieldset>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={create.isPending}>
              Save endpoint
            </button>
          </div>
        </form>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>URL</th>
              <th>Events</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No endpoints.
                </td>
              </tr>
            )}
            {data?.map((w) => (
              <tr key={w.id} className={w.active ? '' : 'inactive'}>
                <td>
                  <code>{w.url}</code>
                  {w.description && <div className="muted">{w.description}</div>}
                  <div>
                    <span className="actions">
                      <button
                        className="link"
                        onClick={() => call.mutate({ path: `/integrations/webhooks/${w.id}/test` })}
                      >
                        Send test
                      </button>
                      <button
                        className="link"
                        onClick={() =>
                          call.mutate({
                            path: `/integrations/webhooks/${w.id}`,
                            method: 'PATCH',
                            body: { active: !w.active },
                          })
                        }
                      >
                        {w.active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="link"
                        onClick={() =>
                          confirm('Rotate the signing secret? The receiver must be updated.') &&
                          call.mutate({ path: `/integrations/webhooks/${w.id}/rotate-secret` })
                        }
                      >
                        Rotate secret
                      </button>
                      <button
                        className="link danger"
                        onClick={() =>
                          confirm('Delete this endpoint?') &&
                          call.mutate({ path: `/integrations/webhooks/${w.id}`, method: 'DELETE' })
                        }
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                </td>
                <td>{w.events.join(', ')}</td>
                <td>
                  {w.active ? (
                    <span className="badge badge-ok">active</span>
                  ) : (
                    <span className="badge badge-danger">disabled</span>
                  )}
                  {w.consecutiveFailures > 0 && (
                    <div className="muted">{w.consecutiveFailures} failures in a row</div>
                  )}
                  {w.disabledReason && <div className="muted">{w.disabledReason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-head" style={{ marginTop: 16 }}>
        <h3>Recent deliveries</h3>
        <select
          value={deliveryStatus}
          onChange={(e) => setDeliveryStatus(e.target.value)}
          aria-label="Delivery status"
        >
          <option value="">All</option>
          <option value="PENDING">Pending / retrying</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Event</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th className="num">Attempts</th>
              <th>Last result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {deliveries.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No deliveries yet.
                </td>
              </tr>
            )}
            {deliveries.data?.map((d) => (
              <tr key={d.id}>
                <td>{formatDateTime(d.createdAt)}</td>
                <td>{d.event}</td>
                <td>
                  <code>{urlOf(d.endpointId)}</code>
                </td>
                <td>
                  <span className={`badge badge-${DELIVERY_TONE[d.status]}`}>
                    {d.status.toLowerCase()}
                  </span>
                  {d.status === 'PENDING' && d.attempts > 0 && (
                    <div className="muted">next try {formatDateTime(d.nextAttemptAt)}</div>
                  )}
                </td>
                <td className="num">{d.attempts}</td>
                <td>{d.lastError ?? (d.responseStatus ? `HTTP ${d.responseStatus}` : '—')}</td>
                <td>
                  {d.status !== 'PENDING' && (
                    <button
                      className="link"
                      onClick={() =>
                        call.mutate({ path: `/integrations/webhook-deliveries/${d.id}/redeliver` })
                      }
                    >
                      Redeliver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
