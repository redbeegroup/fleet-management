import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { AppNotification } from '../lib/types';

const tone = { info: 'info', warning: 'warn', critical: 'danger' } as const;

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'list', unreadOnly],
    queryFn: () => api<AppNotification[]>(`/notifications${unreadOnly ? '?unread=true' : ''}`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });

  return (
    <>
      <header className="page-head">
        <h1>Notifications</h1>
        <div className="actions">
          <label className="check">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
          </label>
          <button className="btn" onClick={() => readAll.mutate()} disabled={!data?.some((n) => !n.readAt)}>
            Mark all read
          </button>
        </div>
      </header>
      <div className="card list">
        {isLoading && <p className="muted">Loading…</p>}
        {data?.length === 0 && <p className="muted">You're all caught up.</p>}
        {data?.map((n) => (
          <article key={n.id} className={`notice ${n.readAt ? 'read' : ''}`}>
            <span className={`badge badge-${tone[n.severity]}`}>{n.severity}</span>
            <div className="notice-body">
              <strong>{n.title}</strong>
              <p>{n.body}</p>
              <time className="muted">{new Date(n.createdAt).toLocaleString('en-GB')}</time>
            </div>
            <div className="actions">
              {n.data?.link && (
                <button
                  className="btn"
                  onClick={() => {
                    if (!n.readAt) read.mutate(n.id);
                    navigate(n.data!.link!);
                  }}
                >
                  Open
                </button>
              )}
              {!n.readAt && (
                <button className="btn" onClick={() => read.mutate(n.id)}>
                  Mark read
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
