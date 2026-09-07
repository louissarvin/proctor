/**
 * Verify every claim an evidence export makes, offline.
 *
 * The export instructs an auditor to check five things. Checking only the HCS
 * chain would leave the other four asserted rather than proven, so this covers
 * everything that is checkable without a network:
 *
 *   1. decisionHash re-derives from the preimage        (RFC 8785 + keccak256)
 *   2. the HCS running hash chain is intact             (verifyChain)
 *   3. World proof re-verification                       NETWORK, out of scope here
 *   4. the attestation body matches the HCS message      (byte comparison)
 *   5. witness nullifier differs from the operator's     (attestation core)
 */
import crypto from 'node:crypto';
import { canonical } from './canonical.js';
import { keccak256Hex } from './keccak256.js';
import { verifyChain, type MirrorMessage } from './verifyTopic.js';
import { verifyCompleteness } from './completeness.ts';

export interface ExportRecord {
  decisionId: string;
  preimage: Record<string, unknown>;
  decisionHash: string;
  idkitResult: unknown | null;
  outcome: string | null;
  attestation: {
    body: string;
    attestorSig: string;
    /** Sequence numbers are per-topic, so the pair is meaningless without this. */
    topicId?: string | null;
    sequenceNumber: string | null;
  } | null;
}

export interface EvidenceExport {
  v: number;
  anchors: { topicId: string; attestorAddress: string; [k: string]: unknown };
  hcsMessages: MirrorMessage[];
  records: ExportRecord[];
}

export interface CheckResult {
  name: string;
  ok: boolean;
  checked: number;
  failures: string[];
}

/** 1. Every decisionHash must re-derive from its own preimage. */
export function checkDecisionHashes(records: ExportRecord[]): CheckResult {
  const failures: string[] = [];
  let checked = 0;
  for (const r of records) {
    if (!r.preimage || !r.decisionHash) continue;
    checked++;
    const derived = keccak256Hex(Buffer.from(canonical(r.preimage), 'utf8'));
    if (derived.toLowerCase() !== r.decisionHash.toLowerCase()) {
      failures.push(`${r.decisionId}: expected ${r.decisionHash}, re-derived ${derived}`);
    }
  }
  return { name: 'decision hashes re-derive from their preimages', ok: failures.length === 0, checked, failures };
}

/** 4. Every attestation body must appear verbatim on the topic. */
export function checkAttestationsOnChain(
  records: ExportRecord[],
  messages: MirrorMessage[],
  topicId?: string,
): CheckResult {
  const onChain = new Map<string, string>();
  for (const m of messages) {
    onChain.set(String(m.sequence_number), Buffer.from(m.message, 'base64').toString('utf8'));
  }

  const failures: string[] = [];
  let checked = 0;
  let outOfScope = 0;

  for (const r of records) {
    const a = r.attestation;
    if (!a?.sequenceNumber) continue;

    // SEQUENCE NUMBERS ARE PER-TOPIC and restart at 1 on a new one. A record
    // attested to a different topic shares numbers with this one by
    // coincidence, so comparing them reports a mismatch that says nothing
    // about either record's integrity. Those records are out of scope for this
    // export, not evidence of tampering.
    if (topicId && a.topicId && a.topicId !== topicId) {
      outOfScope++;
      continue;
    }

    checked++;
    const body = onChain.get(a.sequenceNumber);
    if (body === undefined) {
      failures.push(`${r.decisionId}: sequence ${a.sequenceNumber} is not in the export's HCS messages`);
    } else if (body !== a.body) {
      failures.push(`${r.decisionId}: attestation body differs from the message at sequence ${a.sequenceNumber}`);
    }
  }

  const name = outOfScope > 0
    ? `attestation bodies match the on-chain messages (${outOfScope} record(s) on other topics, skipped)`
    : 'attestation bodies match the on-chain messages';

  return { name, ok: failures.length === 0, checked, failures };
}

/** 5. The witness must not be the operator, read from the attestation itself. */
export function checkIndependence(records: ExportRecord[]): CheckResult {
  const failures: string[] = [];
  let checked = 0;
  for (const r of records) {
    if (!r.attestation?.body) continue;
    let core: { wn?: string | null; on?: string; ind?: string; out?: string };
    try { core = JSON.parse(r.attestation.body); } catch { continue; }
    if (!core.on) continue;
    checked++;

    if (core.wn && core.wn === core.on) {
      failures.push(`${r.decisionId}: witness nullifier equals the operator's`);
    }
    // An attestation claiming cryptographic independence must carry a distinct
    // witness nullifier to back it.
    if (core.ind === 'crypto' && (!core.wn || core.wn === core.on)) {
      failures.push(`${r.decisionId}: claims ind=crypto without a distinct witness nullifier`);
    }
  }
  return { name: 'witness is not the operator', ok: failures.length === 0, checked, failures };
}

/** sha384 of each attestation body, so a reader can spot-check integrity. */
export const bodyDigest = (body: string): string =>
  crypto.createHash('sha384').update(Buffer.from(body, 'utf8')).digest('hex');

export interface ExportVerdict {
  ok: boolean;
  checks: CheckResult[];
  chain: { ok: boolean; checked: number; brokeAt: number | null; reason?: string };
}


/**
 * 4. Completeness. Different question from every check above.
 *
 * The three preceding checks all ask "is what is here correct?". None asks "is
 * everything that should be here, here?". An export that omits an inconvenient
 * decision passes all of them, because each record it DOES contain is genuine.
 *
 * The issuance numbers are signed into the on-chain messages, so this reads
 * them from `hcsMessages` rather than from `records`: an exporter that drops a
 * record cannot also drop the number, because the number is on a topic with no
 * admin key.
 */
export function checkCompleteness(messages: MirrorMessage[]): CheckResult {
  const r = verifyCompleteness(messages as never);
  const failures: string[] = [];

  if (r.reason && !r.ok) failures.push(r.reason);
  for (const n of r.missing) failures.push(`issuance number ${n} never reached the log`);

  return {
    name: 'no decision was withheld from the log',
    ok: r.ok,
    checked: r.found.length,
    failures,
  };
}

export function verifyExport(doc: EvidenceExport): ExportVerdict {
  const chain = verifyChain(doc.anchors.topicId, doc.hcsMessages);
  const checks = [
    checkDecisionHashes(doc.records),
    checkAttestationsOnChain(doc.records, doc.hcsMessages, doc.anchors.topicId),
    checkIndependence(doc.records),
    checkCompleteness(doc.hcsMessages),
  ];
  return {
    ok: chain.ok && checks.every((c) => c.ok),
    checks,
    chain: { ok: chain.ok, checked: doc.hcsMessages.length, brokeAt: chain.brokeAt, reason: chain.reason },
  };
}
