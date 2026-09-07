/**
 * Send gate-settlement tokens to the paying agent.
 *
 * The agent already carries `maxAutomaticTokenAssociations = -1`, so no
 * explicit association is needed: a recipient that has never held the token
 * receives it anyway. That is the whole reason for setting it — otherwise this
 * transfer fails on association rather than on balance, and the error names
 * neither.
 *
 *   bun scripts/fund-agent.ts --confirm [amount]
 */
import { TransferTransaction, TokenId, AccountId, PrivateKey } from '@hiero-ledger/sdk';
import { hederaClient, hederaConfigured } from '../src/lib/hedera/client.ts';
import {
  HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_AGENT_ID,
  GATE_TOKEN_ID, HASHSCAN_BASE,
} from '../src/config/main-config.ts';

if (!hederaConfigured() || !GATE_TOKEN_ID || !HEDERA_AGENT_ID) {
  console.error('Need HEDERA_OPERATOR_ID/KEY, GATE_TOKEN_ID and HEDERA_AGENT_ID.');
  process.exit(1);
}

// 6 decimals. 1000 tokens is ~2400 gate payments at $0.42.
const amount = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 1000) * 1_000_000;

console.log(`Send ${amount} atomic units of ${GATE_TOKEN_ID}`);
console.log(`  from ${HEDERA_OPERATOR_ID} (treasury)`);
console.log(`  to   ${HEDERA_AGENT_ID} (agent)`);

if (!process.argv.includes('--confirm')) {
  console.log('\nDRY RUN. Re-run with --confirm.');
  process.exit(0);
}

const client = hederaClient();
const token = TokenId.fromString(GATE_TOKEN_ID);

const tx = await new TransferTransaction()
  .addTokenTransfer(token, AccountId.fromString(HEDERA_OPERATOR_ID), -amount)
  .addTokenTransfer(token, AccountId.fromString(HEDERA_AGENT_ID), amount)
  .setTransactionMemo('proctor: fund agent for gate settlement')
  .freezeWith(client)
  .sign(PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY));

const receipt = await (await tx.execute(client)).getReceipt(client);
console.log(`\n${receipt.status.toString()}`);
console.log(`  ${HASHSCAN_BASE}/account/${HEDERA_AGENT_ID}`);

process.exit(0);
