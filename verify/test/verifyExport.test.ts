import { test, expect } from 'bun:test';
import { checkAttestationsOnChain, type ExportRecord } from '../src/verifyExport.ts';

const msg = (seq: number, body: string) => ({
  sequence_number: seq,
  message: Buffer.from(body, 'utf8').toString('base64'),
  running_hash: '',
  running_hash_version: 3,
  consensus_timestamp: '0.0',
  payer_account_id: '0.0.1',
  topic_id: '0.0.1',
});

const rec = (id: string, seq: string, body: string, topicId: string | null): ExportRecord => ({
  decisionId: id,
  preimage: {},
  decisionHash: '0x0',
  idkitResult: null,
  outcome: 'APPROVE',
  attestation: { body, attestorSig: '0x0', topicId, sequenceNumber: seq },
});

test('records from ANOTHER topic are skipped, not reported as tampered', () => {
  // Found by verifying a real export: sequence numbers are PER TOPIC and restart
  // at 1 on a new one, so a record attested to an old topic collides with an
  // unrelated message here. Comparing them produced "attestation body differs"
  // and the export failed for a reason that had nothing to do with integrity.
  const messages = [msg(1, '{"sq":"18"}')];
  const records = [
    rec('current', '1', '{"sq":"18"}', '0.0.NEW'),
    rec('older', '1', '{"sq":"1"}', '0.0.OLD'),
  ];

  const r = checkAttestationsOnChain(records, messages, '0.0.NEW');

  expect(r.ok).toBe(true);
  expect(r.checked).toBe(1);
  expect(r.name).toContain('1 record(s) on other topics, skipped');
});

test('a genuine mismatch ON THIS TOPIC still fails', () => {
  // The scoping must not become a way to excuse real tampering.
  const messages = [msg(1, '{"sq":"18"}')];
  const records = [rec('tampered', '1', '{"sq":"99"}', '0.0.NEW')];

  const r = checkAttestationsOnChain(records, messages, '0.0.NEW');

  expect(r.ok).toBe(false);
  expect(r.failures[0]).toContain('differs from the message at sequence 1');
});

test('a record with no topicId is still checked, not silently skipped', () => {
  // Older exports predate the field. Skipping them would let an export opt out
  // of the check by omitting a value.
  const messages = [msg(1, '{"sq":"18"}')];
  const records = [rec('legacy', '1', '{"sq":"99"}', null)];

  const r = checkAttestationsOnChain(records, messages, '0.0.NEW');

  expect(r.ok).toBe(false);
  expect(r.checked).toBe(1);
});

test('a record referencing a sequence not in the export is reported', () => {
  const r = checkAttestationsOnChain(
    [rec('orphan', '42', '{}', '0.0.NEW')],
    [msg(1, '{}')],
    '0.0.NEW',
  );

  expect(r.ok).toBe(false);
  expect(r.failures[0]).toContain('not in the export');
});
