import { useState } from 'react';
import { openFile } from '../lib/api';
import type { FileRef } from '../lib/types';

export function FileLink({ file }: { file: FileRef | null | undefined }) {
  const [error, setError] = useState(false);
  if (!file) return <span className="muted">—</span>;
  return (
    <button
      type="button"
      className="link"
      title={file.filename}
      onClick={() => openFile(file.id).catch(() => setError(true))}
    >
      {file.contentType === 'application/pdf' ? 'PDF' : 'Image'} · {file.filename.slice(0, 24)}
      {error && <span className="error"> (failed)</span>}
    </button>
  );
}
