/**
 * The evidence record.
 *
 * Under 1024 bytes, deliberately, so it is ONE HCS chunk: one sequence number,
 * one consensus timestamp, one running-hash link, and a verification story a
 * judge can follow in ten seconds. A chunked message becomes N mirror rows
 * linked by chunk_info, and reassembly becomes the auditor's problem.
 *
 * Field names are terse for the same reason. Hashes go in; payloads do not.
 */
import { privateKeyToAccount } from 'viem/accounts';
import { canonical } from './canonical.ts';
import { bodyDigest } from './hash.ts';
import {
  ATTESTOR_PRIVATE_KEY, ATTESTATION_SPEC_VERSION, ATTESTATION_MAX_BYTES,
  HEDERA_TOPIC_ID,
} from '../../config/main-config.ts';

export type Outcome = 'APPROVE' | 'REFUSE' | 'EXPIRE';
/** How the witness authenticated. See `wa` below. */
export type WitnessAuth = 'proof' | 'token';
/** Whether witness/operator independence is cryptographic or merely policy. */
export type Independence = 'crypto' | 'policy';

export interface AttestationCore {
  /** spec version */
  v: number;
  /** decision hash. The World `signal`. What the witness actually saw. */
  dh: string;
  /** outcome */
  out: Outcome;
  /** agent HCS-14 UAID */
  agt: string;
  /** sha256 of the raw World proof. NULL on a refusal, and that is CORRECT. */
  wid: string | null;
  /** witness nullifier, decimal string */
  wn: string | null;
  /** operator nullifier, decimal string. Lets a third party check independence. */
  on: string;
  /**
   * What authenticated the witness.
   * "proof" = a verified liveness proof. "token" = the bearer token alone.
   * Without this field a refusal names a witness on bearer-token evidence and
   * an attacker can argue the record overstates what was proven.
   */
  wa: WitnessAuth;
  /**
   * Independence class. Two distinct nullifiers do NOT prove two humans: one
   * person can hold two World ID accounts. Recording which property we have is
   * the difference between an honest record and an overclaim.
   */
  ind: Independence;
  /** sha256 of the canonical policy rules that fired */
  pol: string;
  /** metered milliseconds. A QUOTE at attestation time, not a settlement. */
  mtr: string;
  /** review milliseconds actually elapsed. Factual even when mtr is "0". */
  rev: string;
  /** our clock, ISO 8601. HCS supplies the authoritative one. */
  ts: string;
}

export interface BuiltAttestation {
  core: AttestationCore;
  /** exact UTF-8 bytes submitted to HCS */
  body: string;
  bodyBytes: number;
  bodyDigest: string;
  attestorSig: string;
  attestorAddress: string;
}

/** EIP-712 domain. No verifyingContract: nothing is verified on chain. */
export const eip712Domain = () => ({
  name: 'Proctor',
  version: String(ATTESTATION_SPEC_VERSION),
} as const);

export const eip712Types = {
  OversightRecord: [
    { name: 'dh',  type: 'string' },
    { name: 'out', type: 'string' },
    { name: 'wid', type: 'string' },
    { name: 'wn',  type: 'string' },
    { name: 'on',  type: 'string' },
    { name: 'wa',  type: 'string' },
    { name: 'ind', type: 'string' },
    { name: 'pol', type: 'string' },
    { name: 'mtr', type: 'string' },
    { name: 'rev', type: 'string' },
    { name: 'ts',  type: 'string' },
  ],
} as const;

export const attestorAccount = () => {
  if (!ATTESTOR_PRIVATE_KEY) throw new Error('ATTESTOR_PRIVATE_KEY is not configured');
  return privateKeyToAccount(ATTESTOR_PRIVATE_KEY as `0x${string}`);
};

/**
 * Sign the core. Every field the signature covers is in eip712Types, so a
 * verifier learns exactly what was attested and cannot be shown a record with
 * extra unsigned fields smuggled in.
 */
export const signAttestation = async (core: AttestationCore): Promise<string> => {
  const account = attestorAccount();
  return account.signTypedData({
    domain: eip712Domain(),
    types: eip712Types,
    primaryType: 'OversightRecord',
    message: {
      dh: core.dh, out: core.out,
      wid: core.wid ?? '', wn: core.wn ?? '',
      on: core.on, wa: core.wa, ind: core.ind,
      pol: core.pol, mtr: core.mtr, rev: core.rev, ts: core.ts,
    },
  });
};

export interface BuildInput {
  decisionHash: string;
  outcome: Outcome;
  agentUaid: string;
  worldProofDigest: string | null;
  witnessNullifier: string | null;
  operatorNullifier: string;
  witnessAuth: WitnessAuth;
  independence: Independence;
  policyHash: string;
  meteredMs: number;
  reviewMs: number;
  at?: Date;
}

export const buildAttestation = async (input: BuildInput): Promise<BuiltAttestation> => {
  const core: AttestationCore = {
    v: ATTESTATION_SPEC_VERSION,
    dh: input.decisionHash,
    out: input.outcome,
    agt: input.agentUaid,
    wid: input.worldProofDigest,
    wn: input.witnessNullifier,
    on: input.operatorNullifier,
    wa: input.witnessAuth,
    ind: input.independence,
    pol: input.policyHash,
    mtr: String(input.meteredMs),
    rev: String(input.reviewMs),
    ts: (input.at ?? new Date()).toISOString(),
  };

  const attestorSig = await signAttestation(core);
  const body = canonical({ ...core, sig: attestorSig, top: HEDERA_TOPIC_ID || undefined });
  const bodyBytes = Buffer.byteLength(body, 'utf8');

  // Assert BEFORE submitting. Above 1024 the SDK silently chunks into N
  // messages with N sequence numbers, and the single-chunk verification story
  // dies without an error.
  if (bodyBytes > ATTESTATION_MAX_BYTES) {
    throw new Error(`attestation is ${bodyBytes} bytes, max ${ATTESTATION_MAX_BYTES}`);
  }

  return {
    core, body, bodyBytes,
    bodyDigest: bodyDigest(body),
    attestorSig,
    attestorAddress: attestorAccount().address,
  };
};

/**
 * Independence, derived rather than asserted.
 *
 * Cryptographic ONLY when the credential yields a stable nullifier (World ID
 * 3.0) AND the two nullifiers actually differ. On a v4 uniqueness proof the
 * nullifier is one-time-use, so two proofs from the SAME account differ and the
 * comparison proves nothing: that case is "policy", enforced by the rota.
 */
export const classifyIndependence = (
  stableNullifier: boolean,
  witnessNullifier: string | null,
  operatorNullifier: string,
): Independence =>
  stableNullifier && witnessNullifier !== null && witnessNullifier !== operatorNullifier
    ? 'crypto'
    : 'policy';
