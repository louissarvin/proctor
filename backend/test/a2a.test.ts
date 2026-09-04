import { test, expect } from 'bun:test';
import {
  toA2ATaskState, isInterrupted, isTerminal, toTaskView,
  A2A_INTERRUPTED_STATES,
} from '../src/lib/a2a/taskState.ts';

test('DISPATCHED maps to the INTERRUPTED auth-required state', () => {
  // Spec: "TASK_STATE_AUTH_REQUIRED: Indicates that authentication is required
  // to proceed. This is an interrupted state."
  expect(toA2ATaskState('DISPATCHED')).toBe('TASK_STATE_AUTH_REQUIRED');
  expect(isInterrupted('DISPATCHED')).toBe(true);
  expect(isTerminal('DISPATCHED')).toBe(false);
});

test('a REFUSAL is REJECTED, not FAILED', () => {
  // A refusal is a legitimate outcome of oversight, not an error. Mapping it to
  // FAILED would misrepresent a working control as a malfunction.
  expect(toA2ATaskState('REFUSED')).toBe('TASK_STATE_REJECTED');
  expect(toA2ATaskState('FAILED')).toBe('TASK_STATE_FAILED');
});

test('an EXPIRY is terminal and in the same class as an explicit refusal', () => {
  expect(toA2ATaskState('EXPIRED')).toBe('TASK_STATE_REJECTED');
  expect(isTerminal('EXPIRED')).toBe(true);
});

test('an APPROVAL completes the task', () => {
  expect(toA2ATaskState('APPROVED')).toBe('TASK_STATE_COMPLETED');
  expect(isTerminal('APPROVED')).toBe(true);
});

test('the pre-payment and witness-selection states are not interrupted', () => {
  expect(toA2ATaskState('PENDING_PAYMENT')).toBe('TASK_STATE_SUBMITTED');
  expect(toA2ATaskState('OPEN')).toBe('TASK_STATE_WORKING');
  expect(isInterrupted('OPEN')).toBe(false);
});

test('exactly one decision state is interrupted', () => {
  const states = ['PENDING_PAYMENT','OPEN','DISPATCHED','APPROVED','REFUSED','EXPIRED','FAILED'] as const;
  expect(states.filter(isInterrupted)).toEqual(['DISPATCHED']);
  expect(A2A_INTERRUPTED_STATES.has('TASK_STATE_AUTH_REQUIRED')).toBe(true);
});

test('every decision state maps to a valid A2A state', () => {
  const states = ['PENDING_PAYMENT','OPEN','DISPATCHED','APPROVED','REFUSED','EXPIRED','FAILED'] as const;
  for (const s of states) expect(toA2ATaskState(s)).toMatch(/^TASK_STATE_/);
});

test('the task view carries the human line while interrupted', () => {
  const v = toTaskView('dec_1', 'DISPATCHED', 'Release EUR 41,200 to Meridian Logistics?');
  expect(v.state).toBe('TASK_STATE_AUTH_REQUIRED');
  expect(v.interrupted).toBe(true);
  expect(v.statusMessage).toContain('Release EUR 41,200');
});

test('a rejected task states plainly that the agent is not released', () => {
  expect(toTaskView('d', 'EXPIRED', 'x').statusMessage).toContain('not released');
  expect(toTaskView('d', 'FAILED', 'x').statusMessage).toContain('not released');
});
