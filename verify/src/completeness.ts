/**
 * Offline completeness, derived from the topic alone.
 *
 * The running hash answers "was this log altered?". It cannot answer "is this
 * log complete?". An operator who simply never submits an inconvenient refusal
 * breaks no hash and no signature: the chain over what WAS submitted stays
 * perfectly intact, and every check passes.
 *
 * Proctor signs a dense per-org issuance number into every attestation as `sq`.
 * Reading those numbers straight off the topic and looking for holes is
 * therefore a check a third party can run with no access to Proctor's database,
 * no API key, and no trust in Proctor at all. That last property is the point:
 * the operator cannot be the one who tells you their evidence is complete.
 *
 * WHAT THIS DOES NOT PROVE, stated so nobody claims otherwise:
 *
 *  1. An operator can stop writing entirely from some point on, and a trailing
 *     absence is indistinguishable from "nothing further happened".
 *     Suppression in the middle is caught; abandonment is merely loud.
 *
 *  2. A decision that is still OPEN is, from outside, indistinguishable from
 *     one that was suppressed: both are simply absent. Only the operator knows
 *     which. So an interior hole is a QUESTION, not a verdict, and callers must
 *     report it as one. Decisions resolve out of order, so transient holes are
 *     normal during live operation and fill in as decisions resolve.
 */

export interface SeqGapResult {
  ok: boolean;
  /** Issuance numbers parsed off the topic, across all issuers. */
  found: number[];
  /** Interior numbers absent from the topic. */
  missing: number[];
  /** Records carrying no `sq` at all, by HCS sequence number. */
  unnumbered: string[];
  /** How many distinct issuers wrote to this topic. */
  issuers: number;
  reason?: string;
}

/**
 * `sq` is dense PER ISSUER, and one topic may carry several.
 *
 * Checking density across the whole topic without grouping is wrong twice over:
 * it invents gaps wherever two issuers interleave, and it reads a second
 * issuer's #1 as a duplicate. Both are false accusations of withholding
 * evidence, which is worse than no check at all.
 *
 * The operator nullifier `on` is the discriminator, and it is already in every
 * record: it is per-org, published, and stable, so grouping costs no extra
 * bytes on a 1024-byte budget.
 */
interface Numbered { sq: number; issuer: string }

/** Attestation bodies are RFC 8785 canonical JSON; `sq` is a decimal string. */
const parse = (body: string): Numbered | null => {
  try {
    const o = JSON.parse(body) as { sq?: unknown; on?: unknown };
    if (typeof o.sq !== 'string' && typeof o.sq !== 'number') return null;
    const n = Number(o.sq);
    if (!Number.isInteger(n) || n <= 0) return null;
    return { sq: n, issuer: typeof o.on === 'string' ? o.on : 'unknown' };
  } catch {
    return null;
  }
};

/**
 * @param messages base64 message payloads in topic order, with their HCS sequence numbers
 */
export function verifyCompleteness(
  messages: { sequence_number: number | string; message: string }[],
): SeqGapResult {
  const byIssuer = new Map<string, number[]>();
  const unnumbered: string[] = [];

  for (const m of messages) {
    const body = Buffer.from(m.message, 'base64').toString('utf8');
    const row = parse(body);
    if (row === null) {
      // Not every message on a topic must be an attestation: trust roots and
      // other envelopes legitimately carry no issuance number. Report them
      // rather than counting them as evidence or as gaps.
      unnumbered.push(String(m.sequence_number));
      continue;
    }
    const list = byIssuer.get(row.issuer) ?? [];
    list.push(row.sq);
    byIssuer.set(row.issuer, list);
  }

  const found = [...byIssuer.values()].flat().sort((a, b) => a - b);
  if (found.length === 0) {
    return {
      ok: true, found: [], missing: [], unnumbered, issuers: 0,
      reason: 'no numbered attestations on this topic',
    };
  }

  const missing: number[] = [];
  let duplicated = false;

  for (const seqs of byIssuer.values()) {
    const present = new Set(seqs);
    if (present.size !== seqs.length) duplicated = true;

    // Check only the range actually observed, lowest to highest.
    //
    // Starting at 1 would be an overclaim in two ordinary situations: records
    // written before this field existed carry no `sq` at all, and a mirror
    // query window may simply not reach back to the first one. Both would be
    // reported as suppressed decisions that nobody suppressed.
    //
    // Anything above the highest is unissued or still in flight; anything below
    // the lowest is outside what this view can speak to. The claim is bounded:
    // no decision was withheld WITHIN the range visible here.
    const lowest = Math.min(...seqs);
    const highest = Math.max(...seqs);
    for (let n = lowest; n <= highest; n++) if (!present.has(n)) missing.push(n);
  }

  return {
    ok: missing.length === 0 && !duplicated,
    found,
    missing: [...new Set(missing)].sort((a, b) => a - b),
    unnumbered,
    issuers: byIssuer.size,
    // A duplicate within one issuer means two records claim one issuance
    // number: renumbering rather than suppression. A different attack, and
    // still worth naming rather than folding into "missing".
    reason: duplicated ? 'two records from one issuer share an issuance number' : undefined,
  };
}
