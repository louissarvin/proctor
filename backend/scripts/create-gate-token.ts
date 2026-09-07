/**
 * Mint an HTS token so the gate can settle in one.
 *
 * WHY THIS EXISTS. USDC on Hedera is an HTS token, so "HTS is in the settlement
 * path" was technically true and practically hollow: Circle's faucet never
 * delivered testnet USDC, so every real settlement moved HBAR. The claim was
 * resting on an asset we had no balance of.
 *
 * Minting our own removes the external dependency entirely. The gate already
 * quotes an arbitrary token id correctly — verified against the live 402 — so
 * the only thing missing was supply.
 *
 * A CUSTOM FEE SCHEDULE, deliberately. A fractional fee routed to the treasury
 * exercises the second half of the same capability, and `feeScheduleKey` means
 * it can be changed later rather than being frozen at creation. Collectors are
 * exempt so the fee cannot recurse when the treasury itself transfers.
 *
 *   bun scripts/create-gate-token.ts --confirm
 */
import {
  TokenCreateTransaction, TokenType, TokenSupplyType, CustomFractionalFee,
  PrivateKey, AccountId,
} from '@hiero-ledger/sdk';
import { hederaClient, hederaConfigured } from '../src/lib/hedera/client.ts';
import {
  HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HASHSCAN_BASE,
} from '../src/config/main-config.ts';

if (!hederaConfigured()) {
  console.error('HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY are required.');
  process.exit(1);
}

// 6 decimals to match USDC, so the same $0.42 → 420000 arithmetic holds and
// swapping the asset really is one variable.
const DECIMALS = 6;
const SUPPLY = 1_000_000 * 10 ** DECIMALS;

console.log('About to create an HTS fungible token.');
console.log(`  name      Proctor Gate Credit`);
console.log(`  symbol    PGC`);
console.log(`  decimals  ${DECIMALS}`);
console.log(`  supply    ${SUPPLY} (1,000,000 PGC)`);
console.log(`  treasury  ${HEDERA_OPERATOR_ID}`);
console.log(`  custom fee 1/100 fractional, collected by the treasury, collectors exempt`);
console.log(`  cost      ~$1`);

if (!process.argv.includes('--confirm')) {
  console.log('\nDRY RUN. Re-run with --confirm.');
  process.exit(0);
}

const key = PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY);
const treasury = AccountId.fromString(HEDERA_OPERATOR_ID);
const client = hederaClient();

// 1% of each transfer, to the treasury. Small enough that it never starves a
// $0.42 settlement, real enough that the schedule is not decorative.
const fee = new CustomFractionalFee()
  .setNumerator(1)
  .setDenominator(100)
  .setFeeCollectorAccountId(treasury)
  // Without this the treasury pays a fee to itself on every distribution and
  // the transfer fails on a balance check that looks like nothing.
  .setAllCollectorsAreExempt(true);

const tx = await new TokenCreateTransaction()
  .setTokenName('Proctor Gate Credit')
  .setTokenSymbol('PGC')
  .setTokenType(TokenType.FungibleCommon)
  .setSupplyType(TokenSupplyType.Finite)
  .setDecimals(DECIMALS)
  .setInitialSupply(SUPPLY)
  .setMaxSupply(SUPPLY)
  .setTreasuryAccountId(treasury)
  .setAdminKey(key.publicKey)
  .setSupplyKey(key.publicKey)
  // Keeping this is the difference between a fee schedule and a fee decision.
  .setFeeScheduleKey(key.publicKey)
  .setCustomFees([fee])
  .setTokenMemo('Proctor x402 gate settlement asset')
  .freezeWith(client)
  .sign(key);

const receipt = await (await tx.execute(client)).getReceipt(client);
const tokenId = receipt.tokenId!.toString();

console.log(`\nCreated ${tokenId}`);
console.log(`  ${HASHSCAN_BASE}/token/${tokenId}`);
console.log('\nNext:');
console.log(`  1. GATE_TOKEN_ID="${tokenId}" in backend/.env, and GATE_ASSET="TOKEN"`);
console.log(`  2. bun scripts/fund-agent.ts --confirm     (send PGC to the agent)`);
console.log(`  3. cd ../agent && bun src/index.ts         (settle in HTS)`);

process.exit(0);
