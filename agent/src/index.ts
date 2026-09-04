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
  HEDERA_TESTNET_CAIP2, HEDERA_TESTNET_USDC,
} from '@x402/hedera';

const API = process.env.PROCTOR_API ?? 'http://localhost:3700';
const AGENT_ID = process.env.HEDERA_AGENT_ID ?? '';
const AGENT_KEY = process.env.HEDERA_AGENT_KEY ?? '';

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
const client = new x402Client().register(HEDERA_TESTNET_CAIP2, new ExactHederaScheme(signer));
const fetchWithPay = wrapFetchWithPayment(fetch, client);

line(`paying to open the decision  (USDC ${HEDERA_TESTNET_USDC} on ${HEDERA_TESTNET_CAIP2})`);
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
line(`\x1b[32mpaid and settled in ${elapsed} ms\x1b[0m`);
line();
console.log(JSON.stringify(body.data, null, 2));
