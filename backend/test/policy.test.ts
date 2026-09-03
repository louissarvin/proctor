import { test, expect } from 'bun:test';
import { evaluatePolicy, buildHumanLine, DEMO_POLICY, type AgentAction } from '../src/lib/policy/evaluate.ts';

const act = (o: Partial<AgentAction> = {}): AgentAction => ({
  kind: 'transfer', asset: 'EUR', amount: '41200.00', counterparty: 'Meridian Logistics', ...o,
});

test('the demo action escalates on the amount threshold', () => {
  const d = evaluatePolicy(act(), DEMO_POLICY);
  expect(d.escalate).toBe(true);
  expect(d.reason).toBe('amount_threshold');
  expect(d.humanLine).toBe('Release EUR 41,200 to Meridian Logistics?');
});

test('below threshold does NOT escalate (the common path, and it is free)', () => {
  const d = evaluatePolicy(act({ amount: '120.00' }), DEMO_POLICY);
  expect(d.escalate).toBe(false);
  expect(d.reason).toBe('below_threshold');
});

test('exactly at the threshold escalates', () => {
  expect(evaluatePolicy(act({ amount: '25000' }), DEMO_POLICY).escalate).toBe(true);
  expect(evaluatePolicy(act({ amount: '24999.99' }), DEMO_POLICY).escalate).toBe(false);
});

test('decimal comparison does not use floats', () => {
  // 0.1 + 0.2 style errors must not be reachable. String compare, digit by digit.
  const rules = { ...DEMO_POLICY, amountThreshold: '0.3' };
  expect(evaluatePolicy(act({ amount: '0.30' }), rules).escalate).toBe(true);
  expect(evaluatePolicy(act({ amount: '0.29999' }), rules).escalate).toBe(false);
});

test('large amounts compare by magnitude, not lexicographically', () => {
  // '9' > '10' as strings. Must not be.
  const rules = { ...DEMO_POLICY, amountThreshold: '10' };
  expect(evaluatePolicy(act({ amount: '9' }), rules).escalate).toBe(false);
  expect(evaluatePolicy(act({ amount: '1000000' }), rules).escalate).toBe(true);
});

test('denylist beats allowlist and threshold', () => {
  const rules = { ...DEMO_POLICY, denylistedCounterparties: ['Sanctioned Co'], allowlistedCounterparties: ['Sanctioned Co'] };
  const d = evaluatePolicy(act({ amount: '1', counterparty: 'Sanctioned Co' }), rules);
  expect(d.escalate).toBe(true);
  expect(d.reason).toBe('denylisted');
});

test('allowlist skips the gate even above threshold', () => {
  const rules = { ...DEMO_POLICY, allowlistedCounterparties: ['Trusted Supplier'] };
  const d = evaluatePolicy(act({ amount: '999999', counterparty: 'Trusted Supplier' }), rules);
  expect(d.escalate).toBe(false);
  expect(d.reason).toBe('allowlisted');
});

test('data_export always escalates regardless of amount', () => {
  const d = evaluatePolicy(act({ kind: 'data_export', amount: '0' }), DEMO_POLICY);
  expect(d.escalate).toBe(true);
  expect(d.reason).toBe('action_kind');
});

test('humanLine is one line and readable on a phone', () => {
  const line = buildHumanLine(act());
  expect(line).not.toContain('\n');
  expect(line.length).toBeLessThan(80);
});
