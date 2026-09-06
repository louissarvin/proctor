import { test, expect } from 'bun:test';
import { meterTinybar, meterUsd, decisionIdFromPath } from '../src/lib/x402/meter.ts';

test('THE CLAIM: the price scales with real human attention, it is not flat', () => {
  // Hedera's extra-points list asks for "pay-per-call metering rather than a
  // flat per-request charge". This is what makes that true.
  const short = meterTinybar(2_000, 'APPROVE');
  const long = meterTinybar(60_000, 'APPROVE');
  expect(long).toBeGreaterThan(short);
  expect(long).toBe(short * 30n);          // exactly linear in seconds
});

test('an EXPIRE bills zero: no human attention was consumed', () => {
  expect(meterUsd(60_000, 'EXPIRE')).toBe('0.000000');
});

test('a refusal is billed: a human did look at it', () => {
  expect(Number(meterUsd(6_000, 'REFUSE'))).toBeGreaterThan(0);
});

test('integer arithmetic only, no float drift across a full decision', () => {
  // At $0.0021/s a float accumulates error within one 60s decision.
  expect(meterUsd(1_000, 'APPROVE')).toBe('0.002100');
  expect(meterUsd(60_000, 'APPROVE')).toBe('0.126000');
  expect(meterUsd(6_412, 'APPROVE')).toMatch(/^\d+\.\d{6}$/);
});

test('a floor is applied because x402 cannot quote a zero amount', () => {
  // A sub-millisecond approval would otherwise price at 0 and the library does
  // NOT reject a zero-amount accepts entry, which would be free oversight.
  expect(meterTinybar(0, 'APPROVE')).toBeGreaterThan(0n);
});

test('the decision id is read from the PATH, never the body', () => {
  // The x402 hook runs before Fastify parses a body, so a body-carried id would
  // silently price every release at zero.
  expect(decisionIdFromPath('/v1/gate/decisions/abc123/release')).toBe('abc123');
  expect(decisionIdFromPath('/v1/gate/decisions')).toBeNull();
});
