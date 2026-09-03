/**
 * The Article 12 evidence export.
 *
 * WHY THIS SHAPE
 * --------------
 * The export is not "a JSON dump of our database". It is the artefact an
 * auditor uses to check our claims WITHOUT us. Everything in it is either
 * (a) raw third-party output we must not touch, or (b) an input from which a
 * hash can be re-derived.
 *
 * EU AI ACT MAPPING, quoted from the Act itself so a reader can check it:
 *
 *   Art 12(1)  "High-risk AI systems shall technically allow for the automatic
 *               recording of events (logs) over the lifetime of the system."
 *              -> HCS is append-only with no admin key. Not even we can delete.
 *
 *   Art 12(3)(a) "recording of the period of each use of the system (start date
 *               and time and end date and time of each use)"
 *              -> issuedAt / dispatchedAt / respondedAt, plus the consensus
 *                 timestamp, which is a clock the deployer did not choose.
 *
 *   Art 12(3)(d) "the identification of the natural persons involved in the
 *               verification of the results"
 *              -> the witness nullifier, an identifier issued by a party that
 *                 is not the deployer, bound to a liveness proof.
 *
 *   Art 14(5)  "no action or decision is taken by the deployer on the basis of
 *               the identification resulting from the system unless that
 *               identification has been separately verified and confirmed by at
 *               least two natural persons"
 *              -> operator nullifier AND witness nullifier, recorded together,
 *                 with `ind` stating whether their distinctness is
 *                 cryptographic or a policy property of the rota.
 *
 * WHAT WE DO NOT CLAIM: that using Proctor makes a deployer compliant.
 * Compliance is a property of their whole system. Proctor produces one piece of
 * evidence that is hard to produce otherwise. Say that, and nothing more.
 */

export interface ExportAnchors {
  /** Everything a verifier needs that is NOT us. */
  topicId: string;
  mirrorNodeBaseUrl: string;
  attestorAddress: string;
  rpId: string;
  worldVerifyUrl: string;
  /** The HCS message that published these roots. Authoritative over this file. */
  rootsSequenceNumber: string | null;
}

/** A mirror node row, byte-identical to what the mirror node returned. */
export interface RawMirrorMessage {
  consensus_timestamp: string;
  message: string;           // base64. NEVER prettify or re-encode.
  payer_account_id: string;
  running_hash: string;      // base64
  running_hash_version: number;
  sequence_number: number;
}

export interface ExportRecord {
  decisionId: string;
  /** Re-derive decisionHash from this with any RFC 8785 library. */
  preimage: Record<string, unknown>;
  decisionHash: string;
  humanLine: string;
  /**
   * The raw IDKitResult exactly as World returned it. An auditor POSTs this
   * back to World's own verifier. Null on a refusal, which is correct: refuse
   * is the default outcome and requires no proof.
   */
  idkitResult: unknown | null;
  attestation: {
    body: string;
    attestorSig: string;
    sequenceNumber: string | null;
    consensusTimestamp: string | null;
    runningHash: string | null;
  } | null;
  /** Art 12(3)(a): the period of each use. */
  period: {
    issuedAt: string;
    dispatchedAt: string | null;
    respondedAt: string | null;
    expiresAt: string;
    reviewMs: number | null;
  };
  outcome: string | null;
  payments: Array<{
    leg: string; rail: string; amountUsd: string;
    externalId: string | null; explorerUrl: string | null; state: string;
  }>;
  /** Append-only transition log. Makes a disputed record reconstructable. */
  events: Array<{ at: string; kind: string }>;
}

export interface EvidenceExportV1 {
  v: 1;
  generatedAt: string;
  /** Which Act provisions each part of this document speaks to. */
  regulatoryMapping: Record<string, string>;
  anchors: ExportAnchors;
  /** RAW mirror rows, UNMODIFIED. Prettifying these breaks the chain. */
  hcsMessages: RawMirrorMessage[];
  records: ExportRecord[];
  /** How to check this file without trusting us. */
  howToVerify: string[];
}

export const REGULATORY_MAPPING: Record<string, string> = {
  'Art 12(1)':
    'Append-only HCS topic with no admin key. Records cannot be edited or deleted by the deployer, or by Proctor.',
  'Art 12(3)(a)':
    'records[].period carries start and end timestamps, plus a consensus timestamp assigned by the Hedera network rather than by the deployer.',
  'Art 12(3)(d)':
    'records[].attestation binds the witness nullifier, an identifier issued by World rather than by the deployer, to a liveness proof for that specific decision.',
  'Art 14(5)':
    'Each attestation records both the operator and witness nullifiers, and an `ind` field stating whether their distinctness is cryptographic or a policy property of the rota.',
};

export const HOW_TO_VERIFY: string[] = [
  'Recompute each decisionHash: RFC 8785 canonicalise records[].preimage, then keccak256. It must equal records[].decisionHash.',
  'Recompute the HCS running hash chain from hcsMessages, from genesis. Run: bun verify/bin/verify.ts --export <this file>.',
  'Re-verify each World proof by POSTing records[].idkitResult unchanged to anchors.worldVerifyUrl + /api/v4/verify/ + anchors.rpId.',
  'Recover the EIP-712 signer of each attestation body and compare against anchors.attestorAddress.',
  'Confirm the witness nullifier differs from the operator nullifier in each attestation core.',
  'None of the above contacts Proctor. If any step fails, the record is not evidence.',
];

/** Assemble the export. Pure: callers supply already-fetched rows. */
export const buildExport = (input: {
  anchors: ExportAnchors;
  hcsMessages: RawMirrorMessage[];
  records: ExportRecord[];
  generatedAt?: Date;
}): EvidenceExportV1 => ({
  v: 1,
  generatedAt: (input.generatedAt ?? new Date()).toISOString(),
  regulatoryMapping: REGULATORY_MAPPING,
  anchors: input.anchors,
  hcsMessages: input.hcsMessages,
  records: input.records,
  howToVerify: HOW_TO_VERIFY,
});
