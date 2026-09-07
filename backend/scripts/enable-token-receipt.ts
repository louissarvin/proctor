/**
 * Let the treasury and the agent receive HTS tokens.
 *
 * THE FAILURE THIS PREVENTS. An account that has never held a given HTS token
 * cannot receive it: the transfer fails on ASSOCIATION, not on balance. So the
 * moment a faucet finally delivers testnet USDC, a gate payment denominated in
 * USDC would bounce for a reason that looks nothing like "you have no USDC".
 *
 * `maxAutomaticTokenAssociations = -1` means unlimited automatic association
 * (HIP-904). It costs nothing while unused and removes the failure entirely.
 *
 *   bun scripts/enable-token-receipt.ts --confirm
 *
 * Idempotent: setting the same value again is a no-op update, not an error.
 */
import { AccountUpdateTransaction, AccountId, PrivateKey } from '@hiero-ledger/sdk';
import { hederaClient, hederaConfigured } from '../src/lib/hedera/client.ts';
import {
  HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_TREASURY_ID, HEDERA_TREASURY_KEY,
  HEDERA_AGENT_ID, HEDERA_AGENT_KEY, HASHSCAN_BASE,
} from '../src/config/main-config.ts';

if (!hederaConfigured()) {
  console.error('HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY are required.');
  process.exit(1);
}

// An AccountUpdate must be signed BY the account being updated, not merely by
// the fee payer. Submitting without the account's own key returns
// INVALID_SIGNATURE, which reads like a malformed transaction rather than a
// missing signer. So each target carries its own key.
const targets = [
  { label: 'operator', id: HEDERA_OPERATOR_ID, key: HEDERA_OPERATOR_KEY },
  { label: 'treasury (payTo)', id: HEDERA_TREASURY_ID, key: HEDERA_TREASURY_KEY },
  { label: 'agent', id: HEDERA_AGENT_ID, key: HEDERA_AGENT_KEY },
].filter((t) => t.id && t.key);

console.log('Will set maxAutomaticTokenAssociations = -1 (unlimited) on:');
for (const t of targets) console.log(`  ${t.label.padEnd(18)} ${t.id}`);

if (!process.argv.includes('--confirm')) {
  console.log('\nDRY RUN. Re-run with --confirm.');
  process.exit(0);
}

const client = hederaClient();

for (const t of targets) {
  try {
    const tx = await (await new AccountUpdateTransaction()
      .setAccountId(AccountId.fromString(t.id))
      .setMaxAutomaticTokenAssociations(-1)
      .freezeWith(client)
      .sign(PrivateKey.fromStringECDSA(t.key)))
      .execute(client);

    const receipt = await tx.getReceipt(client);
    console.log(`${t.label}: ${receipt.status.toString()}  ${HASHSCAN_BASE}/account/${t.id}`);
  } catch (error) {
    // One account failing must not strand the others. The treasury is the one
    // that actually matters for receiving a USDC gate payment.
    console.error(`${t.label}: FAILED ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(0);
