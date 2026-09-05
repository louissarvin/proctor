/**
 * Who paid.
 *
 * x402's PaymentPayload has NO `payer` field. It carries `payload`, whose shape
 * is scheme-specific, and `payer` appears only on the facilitator's verify and
 * settle RESPONSES, which are not available to the route handler. Reading
 * `paymentPayload.payer` returns undefined every time, which is how every
 * `gate.paid` event came to record a null payer.
 *
 * So we read it out of the signed instrument itself:
 *   - Hedera exact: the payload IS a signed transaction. Its transaction id
 *     contains the paying account.
 *   - EVM / Gateway: an EIP-3009-style authorization names `from`.
 *
 * Never throws. A payment that settled must not be undone because we could not
 * label it; an unattributed payment is a worse record than a null one only if
 * it is also a failed one.
 */
import { Transaction } from '@hiero-ledger/sdk';

type Payload = { payload?: Record<string, unknown> } | undefined;

/**
 * NOT transactionId.accountId. On Hedera the facilitator is the fee payer, so
 * the transaction id names Blocky402 (0.0.7162784), not the agent that spent
 * the money. Recording that would put the wrong party in the audit trail,
 * which is worse than recording nothing.
 *
 * The account that actually paid is the one with the NEGATIVE amount in the
 * transfer list. A fee payer nets out; a spender goes down.
 */
const fromHederaTransaction = (p: Record<string, unknown>): string | null => {
  const b64 = p['transaction'];
  if (typeof b64 !== 'string' || b64.length === 0) return null;
  const tx = Transaction.fromBytes(Buffer.from(b64, 'base64')) as Transaction & {
    tokenTransfers?: Map<unknown, Map<unknown, { isNegative?: () => boolean }>>;
    hbarTransfers?: Map<unknown, { isNegative?: () => boolean }>;
  };

  for (const byToken of tx.tokenTransfers?.values() ?? []) {
    for (const [account, amount] of byToken) {
      if (amount?.isNegative?.()) return String(account);
    }
  }
  for (const [account, amount] of tx.hbarTransfers ?? []) {
    if (amount?.isNegative?.()) return String(account);
  }
  return null;
};

const fromEvmAuthorization = (p: Record<string, unknown>): string | null => {
  const auth = p['authorization'];
  if (auth && typeof auth === 'object') {
    const from = (auth as Record<string, unknown>)['from'];
    if (typeof from === 'string') return from;
  }
  const from = p['from'];
  return typeof from === 'string' ? from : null;
};

export const extractPayer = (paymentPayload: unknown): string | null => {
  try {
    const p = (paymentPayload as Payload)?.payload;
    if (!p || typeof p !== 'object') return null;
    return fromHederaTransaction(p) ?? fromEvmAuthorization(p);
  } catch {
    // A malformed or future payload shape must not break a settled payment.
    return null;
  }
};
