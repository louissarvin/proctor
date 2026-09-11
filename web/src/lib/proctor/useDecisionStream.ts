import { useEffect, useRef, useState } from 'react';
import { env } from '@/env';

export interface MeterFrame {
  elapsedMs: number;
  remainingMs: number;
  accruedUsd: string;
}

export interface StreamState {
  connected: boolean;
  state: string | null;
  meter: MeterFrame | null;
  outcome: 'APPROVE' | 'REFUSE' | 'EXPIRE' | null;
  reviewMs: number | null;
}

/** Live decision feed. Drives the on-camera meter and countdown. */
export function useDecisionStream(decisionId: string | null): StreamState {
  const [s, setS] = useState<StreamState>({
    connected: false, state: null, meter: null, outcome: null, reviewMs: null,
  });
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!decisionId) return;
    let resolved = false;

    const source = new EventSource(`${env.VITE_API_URL}/v1/gate/decisions/${decisionId}/stream`);
    sourceRef.current = source;

    const resolve = (state: string, outcome: StreamState['outcome'], reviewMs: number) => {
      if (resolved) return;
      resolved = true;
      setS((p) => ({ ...p, state, outcome, reviewMs, connected: false }));
      source.close();
      clearInterval(poll);
    };

    source.addEventListener('open', () => setS((p) => ({ ...p, connected: true })));

    source.addEventListener('message', (e) => {
      const frame = JSON.parse(e.data);
      if (frame.type === 'meter') setS((p) => ({ ...p, meter: frame }));
      if (frame.type === 'state') setS((p) => ({ ...p, state: frame.state }));
    });

    // EventSource auto-reconnects on close. The server ends the stream after
    // this frame, so without close() the browser reconnects forever.
    source.addEventListener('resolved', (e) => {
      const frame = JSON.parse(e.data);
      resolve(
        frame.outcome === 'APPROVE' ? 'APPROVED' : frame.outcome === 'REFUSE' ? 'REFUSED' : 'EXPIRED',
        frame.outcome,
        frame.reviewMs,
      );
    });

    source.addEventListener('error', () => setS((p) => ({ ...p, connected: false })));

    // Safety net: a single stalled or dropped stream must never be the only
    // path to "resolved" on a live demo. Poll the same record the stream is
    // built from until this decision is terminal, then stop.
    const poll = setInterval(async () => {
      if (resolved) return;
      try {
        const r = await fetch(`${env.VITE_API_URL}/v1/evidence/decisions/${decisionId}`,
          { headers: { 'ngrok-skip-browser-warning': '1' } });
        const body = await r.json();
        const d = body?.data as { state?: string; outcome?: StreamState['outcome']; reviewMs?: number } | undefined;
        if (d?.outcome) resolve(d.state ?? 'APPROVED', d.outcome, d.reviewMs ?? 0);
      } catch { /* transient network hiccup, next tick retries */ }
    }, 2000);

    return () => { source.close(); clearInterval(poll); };
  }, [decisionId]);

  return s;
}
