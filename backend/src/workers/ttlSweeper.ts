/**
 * TTL sweeper. Makes the gate fail CLOSED.
 *
 * Runs every second because the TTL is 60. A minute-granularity cron would let
 * a decision sit answerable for up to 59 seconds past its deadline, which
 * would make "second 61 is a hard refuse" false.
 *
 * The sweeper cannot beat an in-flight approver and an approver cannot beat
 * the sweeper: both are conditional updates on the same row, and Postgres
 * arbitrates. See src/lib/decision/lifecycle.ts.
 */
import nodeCron from 'node-cron';
import { expireOverdueDecisions } from '../lib/decision/lifecycle.ts';

let isRunning = false;

const sweep = async (): Promise<void> => {
  if (isRunning) {
    // A slow sweep must never stack. Skipping is safe: the next tick is 1s away
    // and the query is idempotent.
    return;
  }

  isRunning = true;
  try {
    const expired = await expireOverdueDecisions();
    if (expired.length > 0) {
      console.log(`[TTLSweeper] expired ${expired.length} decision(s): ${expired.join(', ')}`);
    }
  } catch (error) {
    console.error('[TTLSweeper] Error:', error);
  } finally {
    isRunning = false;
  }
};

export const startTtlSweeper = (): void => {
  console.log('[TTLSweeper] Scheduled: every second (TTL fails closed)');
  nodeCron.schedule('* * * * * *', sweep);
  void sweep();
};

export { sweep as sweepOnce };
