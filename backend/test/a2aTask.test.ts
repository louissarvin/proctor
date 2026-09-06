import { test, expect } from 'bun:test';
import { buildA2ATask, type TaskSource } from '../src/lib/a2a/task.ts';

const src = (over: Partial<TaskSource> = {}): TaskSource => ({
  id: 'dec_1', state: 'DISPATCHED', humanLine: 'Release EUR 41,200?',
  orgSlug: 'demo-org', orgSeq: 7,
  decisionHash: '0xabc', outcome: null, statusMessage: 'Awaiting a human.',
  attestation: null, events: [], ...over,
});

test('an in-flight task is the interrupted auth-required state', () => {
  const t = buildA2ATask(src());
  expect(t.status.state).toBe('TASK_STATE_AUTH_REQUIRED');
  expect(t.id).toBe('dec_1');
  expect(t.contextId).toBe('demo-org');
  expect(t.status.message.parts[0]?.text).toContain('Awaiting');
});

test('an in-flight task carries NO evidence artifact', () => {
  // A half-formed record invites a client to treat it as final. There is no
  // attestation until the decision is terminal.
  expect(buildA2ATask(src()).artifacts).toEqual([]);
  expect(buildA2ATask(src({ state: 'OPEN' })).artifacts).toEqual([]);
});

test('a terminal task returns the attestation as an artifact', () => {
  const t = buildA2ATask(src({
    state: 'REFUSED', outcome: 'REFUSE',
    attestation: { sequenceNumber: '29', topicId: '0.0.10390147' },
  }));
  expect(t.status.state).toBe('TASK_STATE_REJECTED');
  const data = t.artifacts[0]?.parts[0]?.data as Record<string, unknown>;
  expect(data['sequenceNumber']).toBe('29');
  expect(data['topicId']).toBe('0.0.10390147');
  expect(data['outcome']).toBe('REFUSE');
});

test('a terminal decision whose record never reached HCS emits no artifact', () => {
  // The unpublished-gap case. Emitting an artifact with a null sequence number
  // would hand a client a citation it cannot verify.
  const t = buildA2ATask(src({
    state: 'REFUSED', outcome: 'REFUSE',
    attestation: { sequenceNumber: null, topicId: '0.0.10390147' },
  }));
  expect(t.artifacts).toEqual([]);
});

test('history comes from the append-only trail, and carries only the kind', () => {
  // detail holds payer addresses and verification outcomes. A task response is
  // read by the CALLING agent, which has no business seeing either.
  const t = buildA2ATask(src({
    events: [
      { kind: 'state.DISPATCHED', at: new Date() },
      { kind: 'world.verify.rejected', at: new Date() },
    ],
  }));
  expect(t.history).toHaveLength(2);
  expect(t.history[0]?.parts[0]?.text).toBe('state.DISPATCHED');
  expect(JSON.stringify(t.history)).not.toContain('detail');
});
