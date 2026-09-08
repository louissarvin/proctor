/**
 * The paying agent.
 *
 * This is the terminal in the first fifteen seconds of the demo: an agent runs
 * a payment, hits a policy threshold, stops dead on an HTTP 402, pays to open
 * an oversight decision, and proceeds only when a human says so.
 *
 * WHY wrapFetchWithPayment RATHER THAN HAND-ROLLING
 * The x402 v2 challenge rides in a base64 `payment-required` response HEADER,
 * not the body. The body is `{}`. A hand-rolled client reads the body, finds
 * nothing, and loses an hour. This wrapper reads the header, selects a payment
 * option, builds and signs the payload, and retries the request.
 */
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import {
  createClientHederaSigner, PrivateKey,
  HEDERA_TESTNET_CAIP2, HEDERA_TESTNET_USDC, HBAR_ASSET_ID,
} from '@x402/hedera';
import {
  extractOffersFromPaymentRequired, verifyOfferSignatureEIP712, isEIP712SignedOffer,
} from '@x402/extensions/offer-receipt';
import { registerBatchScheme } from '@circle-fin/x402-batching/client';
import { privateKeyToAccount } from 'viem/accounts';

const API = process.env.PROCTOR_API ?? 'http://localhost:3700';
const AGENT_ID = process.env.HEDERA_AGENT_ID ?? '';
const AGENT_KEY = process.env.HEDERA_AGENT_KEY ?? '';
/** SECRET. The EOA that holds the Arc Gateway balance. */
const ARC_KEY = process.env.ARC_PRIVATE_KEY ?? '';
const ARC_NETWORK = process.env.ARC_NETWORK ?? 'eip155:5042002';
/** Arc's USDC: the gas token, exposed as an ERC-20 at a fixed address. */
const ARC_USDC = '0x3600000000000000000000000000000000000000';

if (!AGENT_ID || !AGENT_KEY) {
  console.error('HEDERA_AGENT_ID and HEDERA_AGENT_KEY are required');
  process.exit(1);
}

const action = {
  kind: 'transfer' as const,
  asset: 'EUR',
  amount: '41200.00',
  counterparty: 'Meridian Logistics',
};

const line = (s = '') => console.log(s);
const money = `${action.asset} ${Number(action.amount).toLocaleString('en-US')}`;

line('supplier payment run');
line(`  ${money} -> ${action.counterparty}`);
line();

// ---------------------------------------------------------------------------
// 1. Ask the policy. FREE. Most actions stop here and proceed for nothing.
// ---------------------------------------------------------------------------
const evalRes = await fetch(`${API}/v1/gate/evaluate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action }),
});
const evaluation = (await evalRes.json()) as {
  data: { escalate: boolean; reason: string; humanLine: string; quote: { priceUsd: string } | null };
};

if (!evaluation.data.escalate) {
  line(`policy: ${evaluation.data.reason}. proceeding, no charge.`);
  process.exit(0);
}

line(`\x1b[31mHOLD: action requires an attested human witness.\x1b[0m`);
line(`  ${evaluation.data.humanLine}`);
line(`  policy fired: ${evaluation.data.reason}`);
line();

// ---------------------------------------------------------------------------
// 2. Pay the gate. The 402 is answered automatically.
// ---------------------------------------------------------------------------
// NOTE: `network` must be the CAIP-2 identifier ("hedera:testnet"), not the
// bare name. The config docstring says "defaults to testnet", which reads as
// if the short form is accepted; passing it throws
// "Unsupported Hedera network: testnet".
const signer = createClientHederaSigner(AGENT_ID, PrivateKey.fromStringECDSA(AGENT_KEY), {
  network: HEDERA_TESTNET_CAIP2,
});
/**
 * Which rail to pay on.
 *
 * The default selector takes the first option the server advertises, which
 * means a service that lists two rails silently decides for the buyer. An agent
 * with a funded balance on one chain and not the other needs to say so, and
 * being able to demonstrate BOTH rails settling is the difference between
 * advertising interoperability and having it.
 */
const PREFER = process.env.PREFER_NETWORK ?? '';

const client = new x402Client(
  PREFER
    // Signature is (x402Version, requirements), not (requirements).
    ? (_v: number, reqs: { network: string }[]) => {
        const match = reqs.find((r) => r.network === PREFER);
        if (!match) {
          throw new Error(
            `PREFER_NETWORK=${PREFER} but the gate advertised only: ${reqs.map((r) => r.network).join(', ')}`,
          );
        }
        return match;
      }
    : undefined,
)
  .register(HEDERA_TESTNET_CAIP2, new ExactHederaScheme(signer))
  // HBAR is not in the scheme's default-asset table, so an explicit allowance
  // is required. The cap is the agent's own guard, not the gate's.
  // The agent's OWN guard, not the gate's. It refuses to pay in an asset its
  // operator never approved, and refuses to overpay in one it did — which is
  // the correct default for software that spends money unattended. When the
  // gate switched to a freshly minted HTS token this correctly rejected the
  // payment until the token was added here, which is the behaviour you want.
  .setSpendControls({
    allowedAssets: [
      { network: HEDERA_TESTNET_CAIP2, asset: HBAR_ASSET_ID, maxAmountPerPayment: '200000000' },
      { network: HEDERA_TESTNET_CAIP2, asset: HEDERA_TESTNET_USDC, maxAmountPerPayment: '2000000' },
      // Any additional HTS token the operator has approved, e.g. the gate's own
      // settlement asset. Comma-separated ids, atomic cap shared.
      ...(process.env.AGENT_ALLOWED_TOKENS ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .map((asset) => ({
          network: HEDERA_TESTNET_CAIP2,
          asset,
          maxAmountPerPayment: process.env.AGENT_MAX_PER_PAYMENT ?? '2000000',
        })),
      // The Arc rail. Spend controls filter requirements BEFORE the selector
      // runs, so without this the Arc option is dropped and the agent reports
      // that the gate "advertised only hedera:testnet" — which is not what the
      // gate said at all, and sends you looking in the wrong place.
      ...(ARC_KEY
        ? [{
            network: ARC_NETWORK,
            asset: ARC_USDC,
            maxAmountPerPayment: process.env.ARC_MAX_PER_PAYMENT ?? '2000000',
          }]
        : []),
    ],
  });
// ---------------------------------------------------------------------------
// The Arc rail, buyer side.
//
// Registering it is what turns the second entry in the 402 from an
// advertisement into something this agent can actually pay. Without it the
// client sees a rail it has no scheme for and silently settles on Hedera.
//
// EOA ONLY. Gateway nanopayments verify with ecrecover, not ERC-1271, so a
// smart-contract wallet signs something that looks valid and is rejected at
// settlement with no useful error.
//
// Payments draw from a Gateway BALANCE, not the wallet balance. Fund it with
// `bun run arc:deposit` in backend/, or this fails in a way that reads like a
// signing problem.
// ---------------------------------------------------------------------------
if (ARC_KEY) {
  const arcAccount = privateKeyToAccount(ARC_KEY as `0x${string}`);
  // Register the LITERAL network, not the default `eip155:*` wildcard. The
  // client resolves a scheme by exact (scheme, network) key when it filters the
  // 402's options, so a wildcard registration leaves the Arc entry looking
  // unpayable and it is silently dropped before payload construction.
  registerBatchScheme(client, {
    signer: arcAccount,
    networks: [ARC_NETWORK],
  });
  line(`arc rail enabled for ${arcAccount.address}`);
} else {
  line('\x1b[33mARC_PRIVATE_KEY not set: the Arc rail will be advertised but not payable\x1b[0m');
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);

// ---------------------------------------------------------------------------
// 2a. CHECK THE PRICE IS SIGNED BEFORE PAYING IT.
//
// wrapFetchWithPayment answers the 402 automatically, which is convenient and
// also means an agent will pay whatever it is told to pay. A seller could quote
// one price to a human reading the docs and another to a machine, and nothing
// in the base protocol leaves the buyer an artefact to complain with.
//
// So: fetch the 402 unpaid, verify the seller SIGNED these exact terms, and
// check the signer is the attestor address they publish at
// /.well-known/proctor.json. Only then hand over money.
// ---------------------------------------------------------------------------
const challenge = await fetch(`${API}/v1/gate/decisions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action }),
});

if (challenge.status !== 402) {
  line(`\x1b[31mexpected a 402 challenge, got ${challenge.status}\x1b[0m`);
  process.exit(1);
}

const header = challenge.headers.get('payment-required');
if (!header) {
  line('\x1b[31mno payment-required header: cannot check what we are being asked to pay\x1b[0m');
  process.exit(1);
}

const paymentRequired = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
const offers = extractOffersFromPaymentRequired(paymentRequired);

if (offers.length === 0) {
  // Not fatal. The extension is optional, and refusing to trade with sellers
  // who have not adopted it would make this agent useless. Say so out loud
  // rather than pretend the check happened.
  line('\x1b[33mno signed offer on the 402: paying on an unsigned quote\x1b[0m');
} else {
  const roots = await fetch(`${API}/.well-known/proctor.json`).then((r) => r.json()) as {
    attestor: { address: string };
  };

  for (const offer of offers) {
    if (!isEIP712SignedOffer(offer)) continue;
    const { signer, payload } = await verifyOfferSignatureEIP712(offer);

    // Recovering an address always succeeds. Recovering the RIGHT one is the
    // check. Treating "did not throw" as "valid" is how this gets built wrong.
    if (signer.toLowerCase() !== roots.attestor.address.toLowerCase()) {
      line(`\x1b[31moffer signed by ${signer}, not the published attestor ${roots.attestor.address}\x1b[0m`);
      line('refusing to pay: the quote is not attributable to this service.');
      process.exit(1);
    }

    line(`offer verified: ${payload.amount} ${payload.asset} on ${payload.network}`);
    line(`  signed by ${signer}, valid until ${new Date(payload.validUntil * 1000).toISOString()}`);
  }
}

line();
line(`paying to open the decision on ${HEDERA_TESTNET_CAIP2}`);
const t0 = Date.now();

const res = await fetchWithPay(`${API}/v1/gate/decisions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action }),
});

const elapsed = Date.now() - t0;

if (!res.ok) {
  line(`\x1b[31mgate refused: ${res.status}\x1b[0m`);
  line(await res.text());
  process.exit(1);
}

const body = (await res.json()) as { data: Record<string, unknown> };
line(`\x1b[32mpaid in ${elapsed} ms\x1b[0m`);

// The facilitator returns the settlement receipt in a response header.
for (const [key, value] of res.headers.entries()) {
  if (!/payment-response/i.test(key)) continue;
  try {
    const settled = JSON.parse(Buffer.from(value, 'base64').toString()) as {
      success: boolean; payer: string; transaction: string; network: string;
    };
    line(`  payer       : ${settled.payer}`);
    line(`  network     : ${settled.network}`);
    line(`  transaction : ${settled.transaction}`);

    // The two rails settle differently, and saying so matters.
    //
    // Hedera returns a consensus transaction id that is final and on chain the
    // moment it resolves. Circle Gateway returns a batch id (a UUID): the
    // payment is COMMITTED and the balance has moved, but it reaches the chain
    // later, batched with others. Printing a Hedera explorer link for a Gateway
    // batch id — which this did — produces a URL that will never resolve, and
    // calling it "settled on-chain" would be a claim we cannot support yet.
    if (settled.network?.startsWith('hedera')) {
      const id = settled.transaction
        .replace('@', '-')
        .replace(/\./g, '-')
        .replace(/^(\d+)-(\d+)-(\d+)-/, '$1.$2.$3-');
      line(`  hashscan    : https://hashscan.io/testnet/transaction/${id}`);
      line('  status      : on chain, final');
    } else {
      line('  status      : committed to a Circle Gateway batch; on chain when the batch settles');
    }
  } catch { /* header not a settlement receipt */ }
}
line();
console.log(JSON.stringify(body.data, null, 2));
