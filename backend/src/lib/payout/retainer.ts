/**
 * On-call standby pay, scheduled on Hedera.
 *
 * WHY IT EXISTS. Paying only per decision prices availability at zero. A witness
 * who keeps a phone on all day and receives nothing earns nothing, so the rota
 * decays towards nobody being reachable — and an oversight gate whose witnesses
 * have drifted away fails closed on every decision, which is safe and useless.
 * Real on-call pays standby.
 *
 * WHY A SCHEDULED TRANSACTION rather than a cron job. It is the same argument
 * the evidence log makes. A cron job pays when our server chooses to; a
 * scheduled transaction fires from Hedera's clock whether or not we are alive,
 * honest, or still solvent. The witness can verify their next payment exists
 * before they agree to be on call, which is exactly the property that makes the
 * commitment worth anything.
 *
 * RECURRENCE, STATED HONESTLY. Hedera schedules are one-shot: a scheduled
 * transaction fires once. Recurrence here means the next retainer is scheduled
 * when the previous one executes, so at any moment exactly one future payment is
 * committed on chain. That is weaker than a native recurring primitive and it is
 * described that way rather than dressed up.
 */
import {
  ScheduleCreateTransaction, ScheduleDeleteTransaction, TransferTransaction,
  Hbar, HbarUnit, AccountId, PrivateKey, Timestamp,
} from '@hiero-ledger/sdk';
import { prismaQuery } from '../prisma.ts';
import { hederaClient, hederaConfigured } from '../hedera/client.ts';
import {
  HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_NETWORK, HASHSCAN_BASE,
  RETAINER_TINYBAR, ATTEST_DISABLED, MIRROR_NODE_URL,
} from '../../config/main-config.ts';

export type RetainerResult =
  | { ok: true; retainerId: string; scheduleId: string; executeAt: Date; explorerUrl: string }
  | { ok: false; reason: string };

const isTestRun = (): boolean =>
  process.env.NODE_ENV === 'test' || Boolean(process.env.BUN_TEST) || ATTEST_DISABLED;

/**
 * How long a schedule may sit before it fires.
 *
 * Hedera caps long-term schedules at roughly two months. Anything beyond that
 * is rejected at creation with an error that reads like a malformed timestamp,
 * so the bound is enforced here where the reason is visible.
 */
export const MAX_SCHEDULE_SECONDS = 60 * 24 * 60 * 60;

export const scheduleWindowIsValid = (executeAt: Date, now = new Date()): boolean => {
  const seconds = (executeAt.getTime() - now.getTime()) / 1000;
  return seconds > 0 && seconds <= MAX_SCHEDULE_SECONDS;
};

/**
 * Commit the next standby payment on chain.
 *
 * The row is written BEFORE the network call for the same reason the witness fee
 * is: an unrecorded payment that fired is worse than a recorded one that did
 * not. A schedule we failed to persist would execute anyway and nothing on our
 * side would know why the balance moved.
 */
export async function scheduleRetainer(
  witnessId: string,
  executeAt: Date,
  tinybar: string = RETAINER_TINYBAR,
): Promise<RetainerResult> {
  const witness = await prismaQuery.witness.findUnique({ where: { id: witnessId } });
  if (!witness) return { ok: false, reason: 'witness_not_found' };
  if (!witness.hederaAccountId) return { ok: false, reason: 'witness_has_no_payout_account' };
  if (!scheduleWindowIsValid(executeAt)) return { ok: false, reason: 'execute_at_out_of_range' };

  const row = await prismaQuery.retainer.create({
    data: {
      witnessId,
      amountAtomic: tinybar,
      asset: 'HBAR',
      network: `hedera:${HEDERA_NETWORK}`,
      executeAt,
      state: 'QUOTED',
    },
  });

  if (isTestRun() || !hederaConfigured()) {
    await prismaQuery.retainer.update({
      where: { id: row.id },
      data: { state: 'FAILED', failureReason: 'scheduling disabled in this environment' },
    });
    return { ok: false, reason: 'scheduling_disabled' };
  }

  try {
    const client = hederaClient();
    const amount = Hbar.from(tinybar, HbarUnit.Tinybar);

    const transfer = new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(HEDERA_OPERATOR_ID), amount.negated())
      .addHbarTransfer(AccountId.fromString(witness.hederaAccountId), amount)
      .setTransactionMemo(`proctor on-call retainer ${row.id}`);

    const tx = await new ScheduleCreateTransaction()
      .setScheduledTransaction(transfer)
      .setScheduleMemo(`proctor retainer ${row.id}`)
      // waitForExpiry makes this a DEADLINE rather than a signature collector:
      // it fires at expirationTime instead of the moment signing completes.
      .setExpirationTime(Timestamp.fromDate(executeAt))
      .setWaitForExpiry(true)
      // Without an admin key the schedule cannot be cancelled, so a witness who
      // leaves the rota would keep being paid with no way to stop it.
      .setAdminKey(PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY).publicKey)
      .execute(client);

    const receipt = await tx.getReceipt(client);
    const scheduleId = receipt.scheduleId!.toString();
    const explorerUrl = `${HASHSCAN_BASE}/schedule/${scheduleId}`;

    await prismaQuery.retainer.update({
      where: { id: row.id },
      data: { state: 'VERIFIED', scheduleId, explorerUrl, transactionId: tx.transactionId!.toString() },
    });

    return { ok: true, retainerId: row.id, scheduleId, executeAt, explorerUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await prismaQuery.retainer.update({
      where: { id: row.id },
      data: { state: 'FAILED', failureReason: reason },
    });
    return { ok: false, reason };
  }
}

/** Cancel a committed retainer, e.g. when a witness leaves the rota. */
export async function cancelRetainer(retainerId: string): Promise<{ ok: boolean; reason?: string }> {
  const row = await prismaQuery.retainer.findUnique({ where: { id: retainerId } });
  if (!row?.scheduleId) return { ok: false, reason: 'no_schedule' };
  if (row.state === 'SETTLED') return { ok: false, reason: 'already_executed' };
  if (isTestRun() || !hederaConfigured()) return { ok: false, reason: 'scheduling_disabled' };

  try {
    const client = hederaClient();
    const tx = await (await new ScheduleDeleteTransaction()
      .setScheduleId(row.scheduleId)
      .freezeWith(client)
      .sign(PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY)))
      .execute(client);
    await tx.getReceipt(client);

    await prismaQuery.retainer.update({
      where: { id: retainerId },
      data: { state: 'FAILED', failureReason: 'cancelled by operator' },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Reconcile committed retainers against what Hedera actually did.
 *
 * A scheduled payment fires without telling us. Nothing in our process observes
 * it, so without this the database says VERIFIED forever while the money has
 * already moved — the same two-sources-of-truth drift that made the demo print
 * one thing and the evidence log record another.
 *
 * The mirror node is the authority here, not our intent: we record what
 * executed, including the network's own execution timestamp.
 */
export async function reconcileRetainers(): Promise<{ settled: number; checked: number }> {
  const pending = await prismaQuery.retainer.findMany({
    where: { state: 'VERIFIED', scheduleId: { not: null } },
    select: { id: true, scheduleId: true },
  });

  let settled = 0;
  for (const r of pending) {
    try {
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/schedules/${r.scheduleId}`);
      if (!res.ok) continue;
      const s = (await res.json()) as { executed_timestamp?: string | null; deleted?: boolean };

      if (s.deleted) {
        await prismaQuery.retainer.update({
          where: { id: r.id },
          data: { state: 'FAILED', failureReason: 'schedule deleted before execution' },
        });
        continue;
      }
      if (!s.executed_timestamp) continue;

      await prismaQuery.retainer.update({
        where: { id: r.id },
        data: {
          state: 'SETTLED',
          // Hedera's clock, not ours. "seconds.nanos" -> ms.
          executedAt: new Date(Number(s.executed_timestamp.split('.')[0]) * 1000),
        },
      });
      settled++;
    } catch {
      // A mirror node blip must not mark a payment as anything. Leave it
      // pending and try again next sweep.
    }
  }
  return { settled, checked: pending.length };
}
