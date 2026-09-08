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

    const source = new EventSource(`${env.VITE_API_URL}/v1/gate/decisions/${decisionId}/stream`);
    sourceRef.current = source;

    source.addEventListener('open', () => setS((p) => ({ ...p, connected: true })));

    source.addEventListener('message', (e) => {
      const frame = JSON.parse((e as MessageEvent).data);
      if (frame.type === 'meter') setS((p) => ({ ...p, meter: frame }));
      if (frame.type === 'state') setS((p) => ({ ...p, state: frame.state }));
    });

    // EventSource auto-reconnects on close. The server ends the stream after
    // this frame, so without close() the browser reconnects forever.
    source.addEventListener('resolved', (e) => {
      const frame = JSON.parse((e as MessageEvent).data);
      setS((p) => ({ ...p, outcome: frame.outcome, reviewMs: frame.reviewMs, connected: false }));
      source.close();
    });

    source.addEventListener('error', () => setS((p) => ({ ...p, connected: false })));

    return () => source.close();
  }, [decisionId]);

  return s;
}
