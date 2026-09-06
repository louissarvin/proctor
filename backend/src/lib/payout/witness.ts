/**
 * Paying the witness.
 *
 * This leg is load-bearing, not decorative. Human oversight is theatre today
 * because clicking is free, so it gets delegated to whoever is cheapest and
 * eventually to a script. Attaching a price and a face is what makes the
 * oversight real, and it is the property that separates this from the
 * approve-button every agent framework already ships.
 *
 * HBAR, NOT USDC, AND DELIBERATELY. A recipient that has never held a given
 * HTS token cannot receive it: the transfer fails on association, not on
 * balance. A witness is a person on a rota, not a crypto user, so requiring
 * them to associate a token before they can be paid for thirty seconds of
 * attention would put a wallet onboarding flow in front of a brake pedal. HBAR
 * needs no association and auto-creates a hollow account on first receipt.
 *
 * OFF THE CRITICAL PATH. The agent is released on the decision outcome. A
 * payout that is slow, or that fails, must never delay the release or change
 * what the evidence says happened. It is an obligation the org owes, recorded
 * either way.
 */
import { TransferTransaction, Hbar, HbarUnit, AccountId } from '@hiero-ledger/sdk';
import { prismaQuery } from '../prisma.ts';
import { hederaClient, hederaConfigured } from '../hedera/client.ts';
import { meterTinybar, meterUsd } from '../x402/meter.ts';
import { recordEvent } from '../decision/lifecycle.ts';
import type { Outcome } from '../attestation/build.ts';
import {
  HEDERA_OPERATOR_ID, HASHSCAN_BASE, HEDERA_NETWORK, ATTEST_DISABLED,
} from '../../config/main-config.ts';

export type PayoutResult =
  | { ok: true; transactionId: string; tinybar: string; amountUsd: string; explorerUrl: string }
  | { ok: false; reason: string; recorded: boolean };

/** Same guard as the attestation writer: fixtures must never move real value. */
const isTestRun = (): boolean =>
  process.env.NODE_ENV === 'test' || Boolean(process.env.BUN_TEST) || ATTEST_DISABLED;

/**
 * Pay the witness for the seconds of attention they actually spent.
 *
 * Idempotent by construction: `Payment` carries `@@unique([decisionId, leg])`,
 * so a second call for the same decision loses the insert race rather than
 * paying twice. We claim the row BEFORE moving money, because the failure we
 * can tolerate is a recorded payment that did not send, and the one we cannot
 * is money sent with no record of it.
 */
export async function payWitness(decisionId: string): Promise<PayoutResult> {
  const decision = await prismaQuery.decision.findUnique({
    where: { id: decisionId },
    include: { witness: true, payments: true },
  });

  if (!decision) return { ok: false, reason: 'decision_not_found', recorded: false };
  if (!decision.outcome) return { ok: false, reason: 'decision_unresolved', recorded: false };
  if (!decision.witness) return { ok: false, reason: 'no_witness', recorded: false };

  if (decision.payments.some((p) => p.leg === 'WITNESS_FEE')) {
    return { ok: false, reason: 'already_paid', recorded: true };
  }

  const reviewMs = decision.reviewMs ?? 0;
  const tinybar = meterTinybar(reviewMs, decision.outcome as Outcome);
  const amountUsd = meterUsd(reviewMs, decision.outcome as Outcome);
  const payTo = decision.witness.hederaAccountId;

  // Claim the obligation first. A witness with no payout account has still
  // earned the fee; recording it as QUOTED makes that debt visible instead of
  // letting it vanish because the org never finished onboarding them.
  const payment = await prismaQuery.payment.create({
    data: {
      decisionId,
      witnessId: decision.witness.id,
      leg: 'WITNESS_FEE',
      rail: 'HEDERA_X402_EXACT',
      state: 'QUOTED',
      amountUsd,
      amountAtomic: tinybar.toString(),
      asset: 'HBAR',
      network: `hedera:${HEDERA_NETWORK}`,
      payTo: payTo ?? '',
    },
  }).catch(() => null);

  // Lost the race with a concurrent call. That is the constraint doing its job.
  if (!payment) return { ok: false, reason: 'already_paid', recorded: true };

  if (!payTo) {
    await prismaQuery.payment.update({
      where: { id: payment.id },
      data: { state: 'FAILED', failureReason: 'witness has no hederaAccountId' },
    });
    await recordEvent(decisionId, 'payout.owed_no_account', { amountUsd });
    return { ok: false, reason: 'witness_has_no_payout_account', recorded: true };
  }

  if (isTestRun() || !hederaConfigured()) {
    await prismaQuery.payment.update({
      where: { id: payment.id },
      data: { state: 'FAILED', failureReason: 'payout disabled in this environment' },
    });
    return { ok: false, reason: 'payout_disabled', recorded: true };
  }

  try {
    const client = hederaClient();
    // The SDK takes string | number | Long | BigNumber, not bigint. Stringify
    // rather than Number(): tinybar amounts can exceed 2^53 and would round.
    const amount = Hbar.from(tinybar.toString(), HbarUnit.Tinybar);

    // Debit and credit must sum to zero or the network rejects the transfer.
    const tx = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(HEDERA_OPERATOR_ID), amount.negated())
      .addHbarTransfer(AccountId.fromString(payTo), amount)
      .setTransactionMemo(`proctor witness fee ${decisionId}`)
      .execute(client);

    // Wait for the receipt: "submitted" is not "paid", and an evidence product
    // must not report a transfer that the network then rejected.
    const receipt = await tx.getReceipt(client);
    if (receipt.status.toString() !== 'SUCCESS') {
      throw new Error(`transfer status ${receipt.status.toString()}`);
    }

    const transactionId = tx.transactionId!.toString();
    const explorerUrl = `${HASHSCAN_BASE}/transaction/${transactionId.replace(/[@.]/g, '-')}`;

    await prismaQuery.payment.update({
      where: { id: payment.id },
      data: { state: 'SETTLED', externalId: transactionId, explorerUrl, settledAt: new Date() },
    });
    await recordEvent(decisionId, 'payout.settled', { transactionId, amountUsd });

    return { ok: true, transactionId, tinybar: tinybar.toString(), amountUsd, explorerUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await prismaQuery.payment.update({
      where: { id: payment.id },
      data: { state: 'FAILED', failureReason: reason },
    });
    await recordEvent(decisionId, 'payout.failed', { reason });
    return { ok: false, reason, recorded: true };
  }
}
