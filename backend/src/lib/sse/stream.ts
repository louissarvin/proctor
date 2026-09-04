/**
 * Server-Sent Events, per the WHATWG HTML specification.
 *
 * Normative points this implementation honours:
 *   - MIME type is `text/event-stream`, always encoded as UTF-8
 *   - fields are `event`, `data`, `id`, `retry`
 *   - "data" lines are concatenated with LF; an event is DISPATCHED on a blank line
 *   - a line beginning with ":" is a comment and is ignored, which is how
 *     keepalives are sent
 *   - `retry` sets the client's reconnection interval in milliseconds
 *
 * WHY THIS EXISTS
 * The agent's terminal has to stay open while a human decides. That wait is
 * the demo: a countdown ticking down from 60, a meter charging per second, and
 * an HCS row landing. Nine of those seconds are a face-match on a phone, and
 * the wait only reads as dead air if the terminal is idle.
 *
 * SSE rather than WebSockets: the traffic is one-directional, it survives
 * proxies that mangle upgrades, and the browser reconnects on its own.
 */

export interface SseEvent {
  event?: string;
  data: unknown;
  id?: string;
  retry?: number;
}

/**
 * Serialise one event.
 *
 * Multi-line payloads must emit one `data:` line each, or a newline inside the
 * JSON silently truncates the event at the receiver.
 */
export const formatSse = (e: SseEvent): string => {
  const lines: string[] = [];
  if (e.retry !== undefined) lines.push(`retry: ${e.retry}`);
  if (e.id !== undefined) lines.push(`id: ${e.id}`);
  if (e.event !== undefined) lines.push(`event: ${e.event}`);

  const payload = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
  for (const line of payload.split('\n')) lines.push(`data: ${line}`);

  // The blank line is what dispatches the event. Without it the client buffers
  // forever and the terminal looks hung.
  return lines.join('\n') + '\n\n';
};

/** A comment line. Ignored by the client, keeps proxies from idling us out. */
export const sseKeepalive = (note = 'keepalive'): string => `: ${note}\n\n`;

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Nginx buffers proxied responses by default, which would hold every frame
  // until the stream closed and make the countdown arrive all at once.
  'x-accel-buffering': 'no',
} as const;

/** Frames the agent can receive. */
export type DecisionFrame =
  | { type: 'state'; state: string; at: string }
  | { type: 'meter'; elapsedMs: number; remainingMs: number; accruedUsd: string }
  | { type: 'resolved'; outcome: 'APPROVE' | 'REFUSE' | 'EXPIRE'; reviewMs: number };

/**
 * Accrued cost for elapsed review time.
 *
 * Integer arithmetic on the atomic unit. Money never touches a float: at
 * $0.0021/s, floating point drifts within the length of one decision.
 */
export const accruedUsd = (elapsedMs: number, ratePerSecond: string): string => {
  const rateAtomic = BigInt(Math.round(Number(ratePerSecond) * 1_000_000)); // 6dp
  const total = (rateAtomic * BigInt(Math.max(0, elapsedMs))) / 1000n;
  const whole = total / 1_000_000n;
  const frac = (total % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${frac}`;
};
