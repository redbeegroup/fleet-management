/** Timezone helpers without external dependencies (uses Intl). */

/** Offset (ms) of `tz` from UTC at instant `at`. */
export function tzOffsetMs(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** UTC instants for local midnight..next midnight of `day` (YYYY-MM-DD) in `tz`. */
export function dayBounds(day: string, tz: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(guess.getTime() - tzOffsetMs(tz, guess));
  const nextGuess = new Date(Date.UTC(y, m - 1, d + 1));
  const end = new Date(nextGuess.getTime() - tzOffsetMs(tz, nextGuess));
  return { start, end };
}

/** Local calendar date (YYYY-MM-DD) of `at` in `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Date(at.getTime() + tzOffsetMs(tz, at)).toISOString().slice(0, 10);
}
