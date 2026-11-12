import { defaultLicenceExpiry, LICENCE_CLASSES } from '@fms/shared';
import { useState } from 'react';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/** "ဃ D — Taxi & commercial (3 yrs)" */
export const licenceOptionLabel = (c: (typeof LICENCE_CLASSES)[number]) =>
  `${c.myanmar} ${c.code} — ${c.label} (${c.validityYears} yr${c.validityYears > 1 ? 's' : ''})`;

/**
 * Licence class select + issue/expiry dates. Expiry is pre-filled from the
 * category's validity when an issue date is chosen (still editable).
 */
export function LicenceFields({ names, compact }: { names: { cls: string; issued: string; expires: string }; compact?: boolean }) {
  const [cls, setCls] = useState('D');
  const [issued, setIssued] = useState('');
  const [expires, setExpires] = useState('');
  const [touched, setTouched] = useState(false);
  const recompute = (c: string, i: string) => {
    if (!touched && i) setExpires(iso(defaultLicenceExpiry(new Date(`${i}T00:00:00Z`), c)));
  };
  const L = compact ? 'mini' : undefined;
  return (
    <>
      <label className={L}>
        Licence class
        <select
          name={names.cls}
          value={cls}
          onChange={(e) => {
            setCls(e.target.value);
            recompute(e.target.value, issued);
          }}
        >
          {LICENCE_CLASSES.map((c) => (
            <option key={c.code} value={c.code}>
              {licenceOptionLabel(c)}
            </option>
          ))}
        </select>
      </label>
      <label className={L}>
        Issued
        <input
          type="date"
          name={names.issued}
          value={issued}
          onChange={(e) => {
            setIssued(e.target.value);
            recompute(cls, e.target.value);
          }}
        />
      </label>
      <label className={L}>
        Expires
        <input
          type="date"
          name={names.expires}
          value={expires}
          onChange={(e) => {
            setTouched(true);
            setExpires(e.target.value);
          }}
        />
      </label>
    </>
  );
}

/** Short display, e.g. "ဃ D" for stored "D" or "B/E" → "ခ B, င E". */
export function licenceShort(raw: string): string {
  return raw
    .split(/[\s,/;|+]+/)
    .filter(Boolean)
    .map((t) => {
      const c = LICENCE_CLASSES.find((x) => x.code === t.toUpperCase());
      return c ? `${c.myanmar} ${c.code}` : t;
    })
    .join(', ');
}
