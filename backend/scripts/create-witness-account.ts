/**
 * Create a Hedera account for the demo witness to be paid into.
 *
 * The witness must be a DIFFERENT account from the operator and the agent, or
 * the payout demonstrates nothing: an org paying itself is not evidence that a
 * human was compensated for their attention.
 *
 * ECDSA, not ED25519, for consistency with every other account here.
 *
 *   bun scripts/create-witness-account.ts --confirm
 *
 * Prints the account id and its private key ONCE. The key is only needed if the
 * witness ever wants to spend; Proctor never uses it, because receiving HBAR
 * requires no signature from the recipient.
 */
import { AccountCreateTransaction, PrivateKey, Hbar, AccountId } from '@hiero-ledger/sdk';
import { hederaClient, hederaConfigured } from '../src/lib/hedera/client.ts';
import { HEDERA_OPERATOR_ID, HASHSCAN_BASE } from '../src/config/main-config.ts';

if (!hederaConfigured()) {
  console.error('HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY are required.');
  process.exit(1);
}

if (!process.argv.includes('--confirm')) {
  console.log('Would create an ECDSA account funded with 1 HBAR, payer', HEDERA_OPERATOR_ID);
  console.log('DRY RUN. Re-run with --confirm.');
  process.exit(0);
}

const key = PrivateKey.generateECDSA();
const client = hederaClient();

// PRINT THE KEY BEFORE THE NETWORK CALL.
// Learned the hard way: the first run of this script hung after the account was
// created but before it printed, and killing it stranded account 0.0.10389138
// with an unrecoverable key. The account is created whether or not we survive
// long enough to report it, so emit the secret while it still costs nothing.
console.log('private key (store it now, this is the only copy):');
console.log(`  ${key.toStringDer()}`);
console.log('');

const tx = await new AccountCreateTransaction()
  .setECDSAKeyWithAlias(key)
  // A small float so the account exists and is visible on HashScan. The witness
  // fee then lands on top of it.
  .setInitialBalance(new Hbar(1))
  // -1 = unlimited automatic token associations, so a future USDC payout does
  // not fail on association. Costs nothing while unused.
  .setMaxAutomaticTokenAssociations(-1)
  .setAccountMemo('proctor demo witness payout')
  .execute(client);

const receipt = await tx.getReceipt(client);
const accountId = receipt.accountId!.toString();

console.log('created', accountId);
console.log(`  ${HASHSCAN_BASE}/account/${accountId}`);
console.log('');
console.log('Add to backend/.env:');
console.log(`  WITNESS_HEDERA_ACCOUNT="${accountId}"`);
console.log('');
console.log(`operator ${AccountId.fromString(HEDERA_OPERATOR_ID).toString()} paid for this account.`);

// The SDK client keeps the event loop alive, so the script hangs after doing
// its work. Both earlier runs of these scripts had to be killed, and killing
// create-witness-account.ts is how account 0.0.10389138 lost its key.
process.exit(0);
