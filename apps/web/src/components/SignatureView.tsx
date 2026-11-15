/** Renders a signature captured as normalised strokes ([0–1] x/y) in the driver app. */
export function SignatureView({
  strokes,
  name,
}: {
  strokes: [number, number][][];
  name: string | null;
}) {
  return (
    <figure className="signature">
      <svg viewBox="0 0 300 120" role="img" aria-label={`Signature of ${name ?? 'recipient'}`}>
        {strokes.map((s, i) => (
          <polyline
            key={i}
            points={s.map(([x, y]) => `${(x * 300).toFixed(1)},${(y * 120).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      {name && <figcaption className="muted small">{name}</figcaption>}
    </figure>
  );
}
