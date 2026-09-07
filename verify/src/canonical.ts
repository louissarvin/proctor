/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * A deliberate copy of the backend's implementation rather than an import: the
 * verifier must run standalone with no project dependencies. Any JCS library in
 * any language produces identical bytes, so an auditor need not use this one.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('canonical: NaN and Infinity are not representable in JSON');
    }
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    // Array order is data and is never sorted.
    return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}
