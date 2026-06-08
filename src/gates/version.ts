// Per the spec, `version()` mints the next version string for a re-extracted
// obligation. We use monotonic integer-strings ('1', '2', '3', ...). When a new
// obligation is committed for the first time, the caller passes `undefined`
// and gets back '1'.
export function version(current?: string): string {
  if (current === undefined) return '1';
  if (current === '' || !/^\d+$/.test(current)) {
    throw new Error(
      `version: expected a non-negative integer-string, got ${JSON.stringify(current)}`
    );
  }
  const n = Number.parseInt(current, 10);
  return String(n + 1);
}
