import { test, expect } from 'bun:test';
import { formatSse, sseKeepalive, SSE_HEADERS, accruedUsd, type DecisionFrame } from '../src/lib/sse/stream.ts';

// --- WHATWG wire format ----------------------------------------------------

test('an event is dispatched by a BLANK LINE', () => {
  // Without the trailing blank line the client buffers forever and the agent's
  // terminal looks hung.
  expect(formatSse({ data: { a: 1 } })).toBe('data: {"a":1}\n\n');
});

test('multi-line payloads emit one data: line each', () => {
  // A newline inside the payload would otherwise truncate the event.
  expect(formatSse({ data: 'one\ntwo' })).toBe('data: one\ndata: two\n\n');
});

test('field order is retry, id, event, data', () => {
  const out = formatSse({ retry: 2000, id: '7', event: 'resolved', data: 'x' });
  expect(out).toBe('retry: 2000\nid: 7\nevent: resolved\ndata: x\n\n');
});

test('comments start with a colon and are ignored by clients', () => {
  expect(sseKeepalive()).toBe(': keepalive\n\n');
});

test('the content type is text/event-stream and UTF-8', () => {
  expect(SSE_HEADERS['content-type']).toBe('text/event-stream; charset=utf-8');
});

test('buffering is disabled, or frames arrive all at once', () => {
  // nginx buffers proxied responses by default, which would hold the whole
  // countdown until the stream closed.
  expect(SSE_HEADERS['x-accel-buffering']).toBe('no');
  expect(SSE_HEADERS['cache-control']).toContain('no-transform');
});

// --- the meter -------------------------------------------------------------

test('the meter uses integer arithmetic, never floats', () => {
  // At $0.0021/s a float drifts within the length of one 60s decision.
  expect(accruedUsd(1000, '0.0021')).toBe('0.002100');
  expect(accruedUsd(60_000, '0.0021')).toBe('0.126000');
  expect(accruedUsd(0, '0.0021')).toBe('0.000000');
});

test('the meter is monotonic across a full decision', () => {
  let prev = -1;
  for (let ms = 0; ms <= 60_000; ms += 250) {
    const v = Number(accruedUsd(ms, '0.0021'));
    expect(v).toBeGreaterThanOrEqual(prev);
    prev = v;
  }
});

test('negative elapsed time cannot produce a negative charge', () => {
  expect(accruedUsd(-5000, '0.0021')).toBe('0.000000');
});

test('always six decimal places, matching USDC atomic units', () => {
  expect(accruedUsd(1, '0.0021')).toMatch(/^\d+\.\d{6}$/);
  expect(accruedUsd(123_456, '0.0021')).toMatch(/^\d+\.\d{6}$/);
});

// --- the terminal frame ----------------------------------------------------
//
// Verified live against a running decision: meter frames at 4Hz, then a single
// `resolved` event, then the stream closes. These lock the parts a client
// depends on, because every failure here is SILENT — a listener simply never
// fires and the terminal looks like it is still waiting.

test('the resolved frame is a NAMED event', () => {
  // The route sends it as `event: resolved`. A client using
  // addEventListener('resolved', ...) never fires if the name is dropped, and
  // nothing errors: the wait just never ends on camera.
  const frame = formatSse({
    event: 'resolved',
    data: { type: 'resolved', outcome: 'REFUSE', reviewMs: 14383 },
  });

  expect(frame).toContain('event: resolved');
  expect(frame.endsWith('\n\n')).toBe(true);
});

test('the resolved frame carries the outcome and the review time', () => {
  const frame = formatSse({
    event: 'resolved',
    data: { type: 'resolved', outcome: 'APPROVE', reviewMs: 6412 } satisfies DecisionFrame,
  });
  const payload = JSON.parse(frame.split('data: ')[1]!.trim());

  expect(payload.outcome).toBe('APPROVE');
  expect(payload.reviewMs).toBe(6412);
});

test('an EXPIRE is a resolution like any other', () => {
  // A decision nobody answered still ends the stream. If expiry were not a
  // terminal frame the agent would hang on a decision that is already refused.
  const frame = formatSse({
    event: 'resolved',
    data: { type: 'resolved', outcome: 'EXPIRE', reviewMs: 60000 } satisfies DecisionFrame,
  });

  expect(frame).toContain('event: resolved');
  expect(frame).toContain('"outcome":"EXPIRE"');
});
