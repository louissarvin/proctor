/**
 * Countdown against the SERVER clock.
 *
 * The API returns `serverNow` alongside `expiresAt`. We compute the offset once
 * and apply it to every subsequent tick, so a phone with a skewed clock shows
 * the same deadline everyone else sees.
 *
 * The server is authoritative regardless: an approval at second 61 is refused
 * by a conditional UPDATE no matter what this displays. This is about not
 * lying to the witness.
 */
import { useEffect, useState } from 'react';
import { formatRemaining } from './formatRemaining';

export function useCountdown(expiresAt: string | null, serverNow: string | null) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt || !serverNow) return;

    // Positive when the device clock runs ahead of the server.
    const skewMs = Date.now() - new Date(serverNow).getTime();
    const deadline = new Date(expiresAt).getTime();

    const tick = () => setRemainingMs(Math.max(0, deadline - (Date.now() - skewMs)));
    tick();
    const id = setInterval(tick, 100);   // 10Hz: the number must look alive
    return () => clearInterval(id);
  }, [expiresAt, serverNow]);

  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);

  return {
    remainingMs,
    seconds,
    /**
     * MM:SS. Do NOT hardcode the minutes digit: the TTL is configurable and a
     * rehearsal deadline of 900s rendered as "0:837" before this existed,
     * which reads as broken on camera.
     */
    display: formatRemaining(seconds),
    expired: remainingMs !== null && remainingMs <= 0,
  };
}
