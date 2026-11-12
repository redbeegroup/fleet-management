import { Permission } from '@fms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, openFile, session, uploadFile } from '../lib/api';
import { formatDate, humanize, isoDay, TRAINING_TONE } from '../lib/format';
import type { DriverTrainingInfo, TrainingCourse } from '../lib/types';

/** Training status + certificate records on the driver page. */
export function DriverTraining({ driverId }: { driverId: string }) {
  const qc = useQueryClient();
  const canWrite = session.can(Permission.DRIVER_WRITE);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['training', 'driver', driverId],
    queryFn: () => api<DriverTrainingInfo>(`/drivers/${driverId}/training`),
  });
  const courses = useQuery({
    queryKey: ['training', 'courses'],
    queryFn: () => api<TrainingCourse[]>('/training/courses'),
    enabled: canWrite,
  });
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['training'] });
  };
  const add = useMutation({
    mutationFn: async ({ body, file }: { body: Record<string, unknown>; file: File | null }) => {
      const certificateFileId = file ? (await uploadFile(file)).id : null;
      return api(`/drivers/${driverId}/training`, {
        method: 'POST',
        body: JSON.stringify({ ...body, certificateFileId }),
      });
    },
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/drivers/${driverId}/training/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get('file') as File | null;
    add.mutate(
      {
        body: {
          courseId: f.get('courseId'),
          completedAt: f.get('completedAt'),
          provider: (f.get('provider') as string) || null,
          certificateNo: (f.get('certificateNo') as string) || null,
          score: f.get('score') ? Number(f.get('score')) : null,
        },
        file: file && file.size ? file : null,
      },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <section className="card">
      <h2>Training & certificates</h2>
      {data && data.status.length > 0 && (
        <div className="photo-row" style={{ marginBottom: 12 }}>
          {data.status.map((s) => (
            <span
              key={s.courseId}
              className={`badge badge-${TRAINING_TONE[s.status]}`}
              title={s.name}
            >
              {s.code}:{' '}
              {s.status === 'VALID'
                ? s.expiresAt
                  ? `valid to ${formatDate(s.expiresAt)}`
                  : 'valid'
                : humanize(s.status)}
            </span>
          ))}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Course</th>
              <th>Completed</th>
              <th>Expires</th>
              <th>Provider</th>
              <th>Certificate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.records.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No training recorded.
                </td>
              </tr>
            )}
            {data?.records.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.course.name} <span className="muted">{r.course.code}</span>
                </td>
                <td>{formatDate(r.completedAt)}</td>
                <td>{r.expiresAt ? formatDate(r.expiresAt) : '—'}</td>
                <td>{r.provider ?? '—'}</td>
                <td>
                  {r.certificateNo ?? ''}{' '}
                  {r.certificateFileId && (
                    <button
                      className="link"
                      onClick={() =>
                        openFile(r.certificateFileId!).catch((e: Error) => setError(e.message))
                      }
                    >
                      scan
                    </button>
                  )}
                </td>
                <td>
                  {canWrite && (
                    <button
                      className="link danger"
                      onClick={() => confirm('Delete this training record?') && remove.mutate(r.id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="error">{error}</p>}
      {canWrite && (
        <form className="inline-form" onSubmit={submit}>
          <select name="courseId" required aria-label="Course">
            <option value="">Course…</option>
            {courses.data
              ?.filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
          </select>
          <input
            name="completedAt"
            type="date"
            required
            max={isoDay(new Date())}
            aria-label="Completed"
          />
          <input name="provider" placeholder="Provider" aria-label="Provider" />
          <input name="certificateNo" placeholder="Certificate no." aria-label="Certificate no." />
          <input
            name="score"
            type="number"
            min={0}
            max={100}
            placeholder="Score"
            aria-label="Score"
          />
          <input
            name="file"
            type="file"
            accept="application/pdf,image/*"
            aria-label="Certificate scan"
          />
          <button className="btn btn-primary" disabled={add.isPending}>
            Add record
          </button>
        </form>
      )}
    </section>
  );
}
