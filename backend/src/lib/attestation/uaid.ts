/**
 * HCS-14 Universal Agent Identifier (UAID).
 *
 * Implemented from the specification, deliberately WITHOUT depending on
 * @hashgraphonline/standards-sdk. HCS-14 is a Draft standard on a pre-1.0 SDK,
 * and a draft dependency must not be able to break the evidence writer. It is
 * ~40 lines and needs no new primitive: SHA-384 is already in the project for
 * the HCS running hash, and bs58 already ships with the starter.
 *
 * NORMATIVE RULES, quoted from the spec:
 *
 *   "The hash is computed from a canonical JSON representation containing ONLY
 *    these required fields: registry, name, version, protocol, nativeId, skills"
 *
 *   "All strings shall be trimmed of leading and trailing whitespace. registry
 *    and protocol values shall be normalized to lowercase. The skills array
 *    shall be sorted numerically in ascending order. Object keys shall be
 *    serialized in alphabetical order in JSON."
 *
 *   "SHA-384 shall be applied to UTF-8 encoded canonical JSON. The resulting
 *    hash shall be encoded using Base58."
 *
 *   "Parameters are ordered with uid first, followed by registry, proto,
 *    nativeId, and domain (if present)."
 *
 * HONEST CLAIM: "we generate a HCS-14 UAID per the draft specification,
 * deterministically, without depending on the SDK". NOT "we are HCS-14
 * compliant" — the standard is Draft and compliance is not ours to assert.
 */
import crypto from 'node:crypto';
import bs58 from 'bs58';

export interface UaidCanonicalFields {
  registry: string;
  name: string;
  version: string;
  protocol: string;
  /** CAIP-10 for Hedera and EVM, e.g. "hedera:testnet:0.0.1234". */
  nativeId: string;
  /** Numeric skill ids. Sorted ascending during canonicalisation. */
  skills: number[];
}

export interface UaidRouting {
  /** Required by the spec. Set to "0" when not applicable. */
  uid?: string;
  domain?: string;
}

/**
 * The exact bytes that get hashed.
 *
 * Note this is NOT our RFC 8785 canonicaliser: HCS-14 defines its own rules
 * (lowercase two named fields, numeric-sort one array). Reusing the generic one
 * would silently produce a different, non-conformant identifier. Two different
 * canonicalisations in one codebase is a smell, so the divergence is stated
 * here rather than discovered later.
 */
export const canonicalUaidJson = (f: UaidCanonicalFields): string => {
  const normalised = {
    name: f.name.trim(),
    nativeId: f.nativeId.trim(),
    protocol: f.protocol.trim().toLowerCase(),
    registry: f.registry.trim().toLowerCase(),
    skills: [...f.skills].sort((a, b) => a - b),
    version: f.version.trim(),
  };
  // Keys are already in alphabetical order above; JSON.stringify preserves it.
  return JSON.stringify(normalised);
};

/** Base58(SHA-384(canonical JSON)). */
export const uaidHash = (f: UaidCanonicalFields): string =>
  bs58.encode(crypto.createHash('sha384').update(Buffer.from(canonicalUaidJson(f), 'utf8')).digest());

/** Full `uaid:aid:...` identifier with routing parameters in spec order. */
export const makeUaid = (fields: UaidCanonicalFields, routing: UaidRouting = {}): string => {
  for (const [k, v] of Object.entries(fields)) {
    const empty = Array.isArray(v) ? false : !String(v ?? '').trim();
    if (empty) throw new Error(`HCS-14: required field "${k}" must be present and non-empty`);
  }

  const params = [
    `uid=${routing.uid ?? '0'}`,                       // required; "0" when N/A
    `registry=${fields.registry.trim().toLowerCase()}`,
    `proto=${fields.protocol.trim().toLowerCase()}`,
    `nativeId=${fields.nativeId.trim()}`,
    ...(routing.domain ? [`domain=${routing.domain}`] : []),
  ];

  return `uaid:aid:${uaidHash(fields)};${params.join(';')}`;
};

/** Parse a UAID back into its hash and parameters. Useful in the verifier. */
export const parseUaid = (uaid: string): { target: string; id: string; params: Record<string, string> } | null => {
  const m = /^uaid:(aid|did):([^;]+)(?:;(.*))?$/.exec(uaid);
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const part of (m[3] ?? '').split(';').filter(Boolean)) {
    const i = part.indexOf('=');
    if (i > 0) params[part.slice(0, i)] = part.slice(i + 1);
  }
  return { target: m[1]!, id: m[2]!, params };
};

/** Skill ids Proctor publishes. */
export const PROCTOR_SKILLS = { HUMAN_OVERSIGHT_GATE: 1 } as const;

export const proctorGateUaid = (hederaAccountId: string, network = 'testnet'): string =>
  makeUaid({
    registry: 'proctor',
    name: 'proctor-oversight-gate',
    version: '1.0.0',
    protocol: 'x402',
    nativeId: `hedera:${network}:${hederaAccountId}`,
    skills: [PROCTOR_SKILLS.HUMAN_OVERSIGHT_GATE],
  });

export const proctorAgentUaid = (hederaAccountId: string, network = 'testnet'): string =>
  makeUaid({
    registry: 'proctor',
    name: 'proctor-paying-agent',
    version: '1.0.0',
    protocol: 'x402',
    nativeId: `hedera:${network}:${hederaAccountId}`,
    skills: [PROCTOR_SKILLS.HUMAN_OVERSIGHT_GATE],
  });
