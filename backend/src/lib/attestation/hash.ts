/**
 * Every hash in the evidence record, in one place.
 *
 * A third party reproduces all of these from the export alone: the preimage
 * gives the decision hash, the raw World proof gives its digest, and the
 * policy rules give the policy hash. Nothing here depends on Proctor.
 */
import crypto from 'node:crypto';
import { keccak256 } from 'viem';
import { canonical, canonicalBytes } from './canonical.ts';

/**
 * THE WORLD `signal`.
 *
 * keccak256 over the canonical UTF-8 bytes of the decision preimage. This is
 * what the witness's liveness proof is bound to, which is what makes the proof
 * about THIS decision rather than about "a human approved something".
 */
export const decisionHash = (preimage: unknown): `0x${string}` =>
  keccak256(canonicalBytes(preimage));

/**
 * sha256 of the raw IDKitResult, byte for byte AS RECEIVED.
 *
 * Never re-serialise the proof before hashing. The export publishes these exact
 * bytes so a third party can POST them back to World's own verifier; if we
 * normalised them first, the digest would not correspond to anything
 * verifiable.
 */
export const worldProofDigest = (rawProofBytes: Buffer | string): string =>
  crypto.createHash('sha256')
    .update(typeof rawProofBytes === 'string' ? Buffer.from(rawProofBytes, 'utf8') : rawProofBytes)
    .digest('hex');

/** sha256 of the canonicalised policy rules. Proves WHICH rule fired. */
export const policyHash = (rules: unknown): string =>
  crypto.createHash('sha256').update(canonicalBytes(rules)).digest('hex');

/** sha384 of the attestation body. Cheap local check before touching the mirror node. */
export const bodyDigest = (body: string): string =>
  crypto.createHash('sha384').update(Buffer.from(body, 'utf8')).digest('hex');

export { canonical, canonicalBytes };
