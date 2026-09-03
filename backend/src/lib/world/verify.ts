/**
 * World ID witness proof verification.
 *
 * Pure. No database, no side effects, so every branch is unit testable.
 *
 * ORDER MATTERS. Cheap local checks run first so a bad proof is rejected before
 * we spend a network round trip on World. The TTL check in particular must be
 * evaluated against the moment the request ARRIVED, not after the round trip,
 * or a slow verifier call silently extends the witness's deadline.
 *
 * ASSERTION 4 IS THE PRODUCT. Re-deriving hashSignal(decisionHash) and matching
 * it against the proof's signal_hash is what binds a liveness proof to THIS
 * decision. Without it, a valid proof for a different decision is accepted, and
 * Proctor is a paid captcha.
 */
import { hashSignal } from '@worldcoin/idkit-core/hashing';

export type WitnessMode = 'SELFIE' | 'ORB_PRESENCE' | 'DEVICE_DEV_ONLY';

export type VerifyFailure =
  | 'decision_expired'
  | 'malformed_proof'
  | 'protocol_mismatch'
  | 'identifier_mismatch'
  | 'signal_mismatch'
  | 'no_liveness'
  | 'duplicate_nonce'
  | 'witness_is_operator'
  | 'verification_failed';

/** Minimal shape we depend on. Deliberately structural, not the SDK's full union. */
export interface ProofResponseItem {
  identifier: string;
  /** OPTIONAL in the SDK type. Dereferencing without a guard does not compile under strict. */
  signal_hash?: string;
  nullifier?: string;
}

export interface ProofResult {
  protocol_version: string;
  nonce: string;
  action?: string;
  environment?: string;
  user_presence_completed?: boolean;
  responses: ProofResponseItem[];
}

export interface VerifyInput {
  raw: ProofResult;
  decision: { decisionHash: string; expiresAt: Date };
  /** null when the org has not enrolled an operator. Assertion 7 then cannot run. */
  operatorNullifier: bigint | null;
  mode: WitnessMode;
  /** Whether the RP nonce was found unused and unexpired. */
  nonceValid: boolean;
  /** Injected so tests are deterministic and the TTL is judged at arrival. */
  now?: Date;
}

export type VerifyOutcome =
  | { ok: true; nullifier: bigint; identifier: string }
  | { ok: false; reason: VerifyFailure };

/**
 * Expected proof shape per mode.
 * `issuer_schema_id` mapping from the SDK: 1=proof_of_human, 11=selfie.
 * Selfie Check returns a World ID 3.0 proof, which is why the nullifier is a
 * stable pseudonym there and one-time-use on the v4 paths.
 */
const EXPECTED: Record<WitnessMode, { identifier: string; protocol: string; presence: boolean }> = {
  SELFIE:          { identifier: 'selfie',         protocol: '3.0', presence: false },
  ORB_PRESENCE:    { identifier: 'proof_of_human', protocol: '4.0', presence: true  },
  DEVICE_DEV_ONLY: { identifier: 'device',         protocol: '3.0', presence: false },
};

const fail = (reason: VerifyFailure): VerifyOutcome => ({ ok: false, reason });

/**
 * Nullifiers arrive as hex and are stored as Decimal(78,0). Parse once, here.
 * Casing and 0x-prefix differences would otherwise silently produce two rows
 * for one witness.
 */
export const parseNullifier = (hex: string): bigint => BigInt(hex.startsWith('0x') ? hex : `0x${hex}`);

export function verifyWitnessProof(input: VerifyInput): VerifyOutcome {
  const want = EXPECTED[input.mode];
  const now = input.now ?? new Date();

  // 1. TTL. Judged at arrival, before any network work.
  if (now.getTime() > input.decision.expiresAt.getTime()) return fail('decision_expired');

  const item = input.raw?.responses?.[0];
  if (!item) return fail('malformed_proof');

  // 2. Protocol version. v3 and v4 proof shapes are incompatible.
  if (input.raw.protocol_version !== want.protocol) return fail('protocol_mismatch');

  // 3. Credential identifier. Proves we got the credential we asked for.
  if (item.identifier !== want.identifier) return fail('identifier_mismatch');

  // 4. THE ONE THAT MATTERS. signal_hash is OPTIONAL in the SDK type, so guard
  //    before comparing or a missing signal reads as a pass.
  if (!item.signal_hash) return fail('signal_mismatch');
  if (hashSignal(input.decision.decisionHash).toLowerCase() !== item.signal_hash.toLowerCase()) {
    return fail('signal_mismatch');
  }

  // 5. Liveness, when the mode requires it.
  if (want.presence && input.raw.user_presence_completed !== true) return fail('no_liveness');

  // 6. RP nonce single-use.
  if (!input.nonceValid) return fail('duplicate_nonce');

  // 7. Segregation of duties: the witness must not be the operator.
  if (!item.nullifier) return fail('verification_failed');
  let witnessNullifier: bigint;
  try {
    witnessNullifier = parseNullifier(item.nullifier);
  } catch {
    return fail('verification_failed');
  }
  if (input.operatorNullifier !== null && witnessNullifier === input.operatorNullifier) {
    return fail('witness_is_operator');
  }

  return { ok: true, nullifier: witnessNullifier, identifier: item.identifier };
}

/**
 * Does this mode give a nullifier that is stable across requests?
 *
 * World's docs contradict each other here and the answer decides whether
 * assertion 7 is meaningful:
 *   - idkit/integrate: "the same person verifying the same action always
 *     produces the same nullifier"
 *   - 4-0-migration:   "In 4.0, nullifiers are one-time-use, and session_id is
 *     the stable link across requests"
 *
 * The migration guide is newer and version-qualified, so it is the correction.
 * On a v4 uniqueness proof, two proofs from the SAME account produce DIFFERENT
 * nullifiers, so `witness !== operator` would pass trivially and the security
 * property would be silently false.
 */
export const hasStableNullifier = (mode: WitnessMode): boolean =>
  EXPECTED[mode].protocol === '3.0';
