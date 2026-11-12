import { isoDay, lastDays } from '../lib/format';

export interface Range {
  from: string;
  to: string;
}

const presets: [string, () => Range][] = [
  ['7 days', () => lastDays(7)],
  ['30 days', () => lastDays(30)],
  [
    'This month',
    () => {
      const d = new Date();
      return { from: isoDay(new Date(d.getFullYear(), d.getMonth(), 1)), to: isoDay(d) };
    },
  ],
  [
    'Last month',
    () => {
      const d = new Date();
      return { from: isoDay(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: isoDay(new Date(d.getFullYear(), d.getMonth(), 0)) };
    },
  ],
];

/** Date-range control: presets + explicit inclusive from/to days (company-local days on the server). */
export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="actions">
      {presets.map(([label, fn]) => {
        const r = fn();
        const active = r.from === value.from && r.to === value.to;
        return (
          <button key={label} type="button" className={`btn ${active ? 'btn-primary' : ''}`} onClick={() => onChange(r)}>
            {label}
          </button>
        );
      })}
      <input type="date" aria-label="From" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
      <input type="date" aria-label="To" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
    </div>
  );
}
