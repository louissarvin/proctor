/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * WHY A STANDARD AND NOT OUR OWN
 * ------------------------------
 * The product claim is that a third party can re-derive every hash without
 * trusting us. If our canonicalisation were bespoke, they would have to
 * reimplement it from our prose. Because it is JCS, they can use any
 * off-the-shelf JCS library in any language and get the same bytes.
 *
 * VERIFIED: JavaScript's native primitives already satisfy JCS.
 *   - Array.prototype.sort() compares strings by UTF-16 code units, which is
 *     exactly what RFC 8785 section 3.2.3 requires.
 *   - JSON.stringify() emits lowercase \uhhhh for control characters, the five
 *     predefined escapes, and ECMAScript Number::toString for numbers.
 *
 * THE BUG THIS FILE EXISTS TO PREVENT
 * -----------------------------------
 * The obvious implementation,
 *
 *     Object.keys(o).sort().map(k => `"${k}":${JSON.stringify(o[k])}`)
 *
 * looks correct and is catastrophically wrong: JSON.stringify on a nested
 * VALUE does not sort that value's keys. Nested objects then serialise in
 * insertion order, so two logically identical records hash differently, and
 * two different records can hash the same. Both evidence hashes silently break
 * and every test that uses a flat object still passes.
 *
 * Hence: recursion, at every depth. The test suite deliberately includes a
 * nested object and an array of objects, because a flat-only suite cannot
 * detect the bug.
 */

/** JSON values we accept. `undefined` is dropped, matching JSON semantics. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export function canonical(value: unknown): string {
  // Primitives, including null. JSON.stringify handles JCS escaping and
  // number formatting correctly.
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('canonical: NaN and Infinity are not representable in JSON');
    }
    if (typeof value === 'bigint') {
      throw new Error('canonical: bigint is not JSON. Convert to a decimal string at the boundary.');
    }
    return JSON.stringify(value) ?? 'null';
  }

  // Arrays: order is DATA and must never be sorted. But elements are still
  // canonicalised recursively, so objects inside arrays get sorted keys.
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  }

  if (value instanceof Date) {
    throw new Error('canonical: Date is ambiguous. Pass an ISO 8601 string.');
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined) // absent, not null
    .sort();                              // UTF-16 code units, per RFC 8785

  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

/** UTF-8 bytes of the canonical form. This is what gets hashed. */
export const canonicalBytes = (value: unknown): Buffer =>
  Buffer.from(canonical(value), 'utf8');
