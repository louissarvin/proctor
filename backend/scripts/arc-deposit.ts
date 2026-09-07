/**
 * Fund the Circle Gateway balance on Arc, so the Arc rail can actually settle.
 *
 * THE DISTINCTION THAT COSTS AN AFTERNOON. Holding USDC in the wallet is not
 * enough. Gateway nanopayments spend from a **Gateway balance**, which is a
 * separate deposit held by the GatewayWallet contract. A wallet with plenty of
 * USDC and no Gateway balance produces a settlement failure that reads like a
 * signing problem.
 *
 * Two on-chain steps, in order:
 *   1. USDC.approve(gatewayWallet, amount)
 *   2. gatewayWallet.deposit(usdc, amount)
 *
 * Then the balance takes a moment to become spendable, which is why this polls
 * rather than assuming.
 *
 *   bun run arc:deposit            # dry run
 *   bun run arc:deposit --confirm [amountUsdc]
 */
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from '../src/lib/arc/chain.ts';
import { ARC_PRIVATE_KEY, ARC_FACILITATOR_URL } from '../src/config/main-config.ts';

/** Arc's USDC is the gas token AND an ERC-20 at this fixed interface address. */
const USDC = '0x3600000000000000000000000000000000000000' as const;
/** Circle's GatewayWallet on Arc. Same address the facilitator advertises as
 *  `verifyingContract`, which is how a buyer builds the right EIP-712 domain. */
const GATEWAY_WALLET = '0x0077777d7eba4688bdef3e311b846f25870a19b9' as const;
/** Circle's CCTP domain for Arc. Confirmed against the live balances API. */
const ARC_DOMAIN = 26;

const abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function deposit(address token, uint256 amount)',
]);

if (!ARC_PRIVATE_KEY) {
  console.error('ARC_PRIVATE_KEY is not configured.');
  process.exit(1);
}

const account = privateKeyToAccount(ARC_PRIVATE_KEY as `0x${string}`);
const pub = createPublicClient({ chain: arcTestnet, transport: http() });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });

const usdc = (n: bigint) => `${Number(n) / 1e6} USDC`;

/**
 * `*.circle.com` is intermittently TLS-intercepted on some networks with an
 * EXPIRED certificate that macOS trusts and Bun correctly rejects, so the same
 * request succeeds under curl and throws here seconds later. Measured at
 * roughly one attempt in three. Retry rather than report a balance of zero,
 * because "you have no money" and "we could not ask" are very different
 * answers to be acting on.
 */
const gatewayBalance = async (attempts = 6): Promise<bigint | null> => {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(`${ARC_FACILITATOR_URL}/v1/balances`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'USDC', sources: [{ domain: ARC_DOMAIN, depositor: account.address }] }),
      });
      if (!r.ok) throw new Error(`balances ${r.status}`);
      const d = (await r.json()) as { balances: { balance: string }[] };
      // The API returns a DECIMAL USDC string ("2.000000"), not atomic units.
      // `BigInt("2.000000")` throws, and an empty balance happens to be "0",
      // which parses fine — so this only breaks once money actually arrives,
      // which is the worst possible time to discover it.
      return BigInt(Math.round(Number(d.balances[0]?.balance ?? '0') * 1e6));
    } catch (e) {
      last = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  // NULL, not zero, and not a throw. The deposit itself is pure on-chain work
  // against Arc's RPC and does not need this endpoint at all — only the
  // verification does. Reporting an unreachable balance as 0 would claim the
  // account is empty, and throwing would block a deposit that is perfectly able
  // to proceed.
  console.warn(`   [warn] gateway balance unreachable: ${last}`);
  return null;
};

const amountUsdc = Number(process.argv.find((a) => /^[\d.]+$/.test(a)) ?? 2);
const amount = BigInt(Math.round(amountUsdc * 1e6));

const walletBalance = await pub.readContract({ address: USDC, abi, functionName: 'balanceOf', args: [account.address] });
const before = await gatewayBalance();

console.log('Arc Gateway deposit');
console.log(`  account         ${account.address}`);
console.log(`  wallet USDC     ${usdc(walletBalance)}`);
console.log(`  gateway balance ${before === null ? 'UNREACHABLE (circle.com intercepted)' : usdc(before)}   <- what nanopayments spend from`);
console.log(`  depositing      ${usdc(amount)}`);

if (walletBalance < amount) {
  console.error('\nNot enough USDC in the wallet. Fund it at faucet.circle.com.');
  process.exit(1);
}

if (!process.argv.includes('--confirm')) {
  console.log('\nDRY RUN. Re-run with --confirm.');
  process.exit(0);
}

console.log('\n1. approve');
const approveHash = await wallet.writeContract({ address: USDC, abi, functionName: 'approve', args: [GATEWAY_WALLET, amount] });
await pub.waitForTransactionReceipt({ hash: approveHash });
console.log(`   ${approveHash}`);

console.log('2. deposit');
const depositHash = await wallet.writeContract({ address: GATEWAY_WALLET, abi, functionName: 'deposit', args: [USDC, amount] });
const receipt = await pub.waitForTransactionReceipt({ hash: depositHash });
console.log(`   ${depositHash}  (${receipt.status})`);

// A deposit is not spendable the instant it lands, so report the balance we can
// actually pay from rather than the transaction we just sent.
console.log('3. waiting for the balance to become spendable');
for (let i = 0; i < 30; i++) {
  const now = await gatewayBalance();
  if (now !== null && now > (before ?? 0n)) {
    console.log(`   gateway balance ${usdc(now)}`);
    console.log('\nThe Arc rail can now settle.');
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 2000));
}

console.log('   could not confirm from here. The deposit is on chain regardless; verify with:');
console.log(`   curl -s -X POST ${ARC_FACILITATOR_URL}/v1/balances -H 'content-type: application/json' \\`);
console.log(`     -d '{"token":"USDC","sources":[{"domain":${ARC_DOMAIN},"depositor":"${account.address}"}]}'`);
process.exit(0);
