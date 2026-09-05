/**
 * x402 resource server wiring.
 *
 * Two things in here are load-bearing and both were learned the hard way.
 *
 * 1. Blocky402 is the DEFAULT facilitator, not a fallback. Hedera's prize
 *    qualification bullet reads, verbatim: "Host a live x402-gated service on
 *    Hedera testnet or mainnet, settled through the Blocky402 facilitator."
 *    There is no "or equivalent". Compliance costs nothing, so we comply.
 *
 * 2. THE BOOT PREFLIGHT. A dead facilitator does not degrade gracefully: it
 *    takes the WHOLE route down, including entries served by a healthy
 *    facilitator, returning a bare 500 on every request. The trap has four
 *    steps: initialize() swallows the dead facilitator and resolves cleanly,
 *    paymentMiddleware() also succeeds because it validates lazily, the real
 *    validation throws RouteConfigurationError asynchronously, and that
 *    rejection is NOT caught by app.setErrorHandler. Boot looks healthy and
 *    every request fails.
 *
 *    filterSupportedAccepts() converts "Circle is down so nothing works" into
 *    "Circle is down so we run on Hedera only", decided automatically at boot.
 */
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { createOfferReceiptExtension, createEIP712OfferReceiptIssuer } from '@x402/extensions/offer-receipt';
import { paymentIdentifierResourceServerExtension } from '@x402/extensions/payment-identifier';
import { privateKeyToAccount } from 'viem/accounts';
import { remember, recall } from './supportedCache.ts';
import { ExactHederaScheme } from '@x402/hedera/exact/server';
import { BatchFacilitatorClient, GatewayEvmScheme } from '@circle-fin/x402-batching/server';
import { HEDERA_TESTNET_CAIP2, HBAR_ASSET_ID } from '@x402/hedera';
import {
  FACILITATOR_URL, PAY_TO_HEDERA, GATE_PRICE_USD,
  GATE_ASSET, GATE_PRICE_HBAR_TINYBAR, GATE_TOKEN_ID, GATE_TOKEN_AMOUNT, ATTESTOR_PRIVATE_KEY,
  ARC_CHAIN_ID, ARC_FACILITATOR_URL, PAY_TO_ARC,
} from '../../config/main-config.ts';

/** `price` is either a USD string the scheme resolves, or an explicit asset+amount. */
export interface PaymentOptionLike {
  scheme: string;
  network: string;
  payTo: string;
  price: string | { asset: string; amount: string };
  maxTimeoutSeconds?: number;
}

/**
 * The Hedera gate leg. Note what is deliberately ABSENT:
 *  - `asset`: resolved by ExactHederaScheme from the price. Hardcoding the USDC
 *    token id lets it drift from the scheme's own table.
 *  - `extra.feePayer`: injected from the live /supported response by initialize().
 */
export const hederaGateOption = (): PaymentOptionLike => ({
  scheme: 'exact',
  network: HEDERA_TESTNET_CAIP2,
  payTo: PAY_TO_HEDERA,
  // A USD price lets the scheme resolve USDC from its default-asset table.
  // HBAR is not a default asset, so it needs an explicit asset and amount.
  // TOKEN: an explicit HTS token id we minted, so settlement genuinely moves
  // HTS without waiting on a faucet.
  // HBAR:  not in the scheme's default-asset table, so it needs asset+amount.
  // USDC:  a USD price string lets the scheme resolve it from that table.
  price: GATE_ASSET === 'TOKEN' && GATE_TOKEN_ID
    ? { asset: GATE_TOKEN_ID, amount: GATE_TOKEN_AMOUNT }
    : GATE_ASSET === 'HBAR'
      ? { asset: HBAR_ASSET_ID, amount: GATE_PRICE_HBAR_TINYBAR }
      : `$${GATE_PRICE_USD}`,
  maxTimeoutSeconds: 180,
});


/** CAIP-2 for Arc testnet. Chain id 5042002. */
export const ARC_CAIP2 = `eip155:${ARC_CHAIN_ID}` as const;

/**
 * The Arc leg, settled through Circle's Gateway facilitator.
 *
 * WHY THIS EXISTS AT ALL, having previously been dropped at boot: we were only
 * ever asking Blocky402, which does not serve Arc, and concluded Arc was
 * unsupported. Circle's own facilitator serves it. "No facilitator supports
 * this network" and "the one facilitator we asked does not" are different
 * claims, and only the second was ever true.
 *
 * GatewayEvmScheme, not ExactEvmScheme: the base class drops
 * `supportedKind.extra`, and Gateway payments need `verifyingContract`, `name`
 * and `version` to reach the client or the buyer signs against the wrong
 * domain and the signature silently fails to verify.
 *
 * Gas on Arc is USDC, and the ERC-20 interface lives at 0x3600…0000, which is
 * what the facilitator advertises as the asset.
 */
export const arcGateOption = (): PaymentOptionLike => ({
  scheme: 'exact',
  network: ARC_CAIP2,
  payTo: PAY_TO_ARC,
  price: `$${GATE_PRICE_USD}`,
  // Gateway rejects authorizations valid for under 3 days. The scheme sets the
  // window itself; do not hand-roll a short one here.
  maxTimeoutSeconds: 180,
});

/**
 * Signed offers and receipts, the x402-native half of the evidence story.
 *
 * The HCS attestation is OUR record of what a human decided. This is the
 * PROTOCOL's record of what was transacted, signed at the moment of payment
 * with the same EIP-712 machinery and verifiable by anyone holding the x402
 * library and no knowledge of Proctor at all.
 *
 * They cover different claims and that is the point. The offer commits us to
 * the terms BEFORE the witness has decided, so we cannot reprice a decision
 * once we know its outcome. The receipt commits to delivery AFTER. The
 * attestation records what the human did in between. An auditor who distrusts
 * our attestor key entirely can still hold us to the offer.
 *
 * Returns null when no attestor key is configured, because a gate that refuses
 * to boot without an optional signing key is worse than one that runs without
 * the extension and says so.
 */
const offerReceiptExtension = () => {
  if (!ATTESTOR_PRIVATE_KEY) {
    console.warn('[x402] ATTESTOR_PRIVATE_KEY absent: offers and receipts will NOT be signed');
    return null;
  }

  const account = privateKeyToAccount(ATTESTOR_PRIVATE_KEY as `0x${string}`);
  // did:pkh per the extension's own convention. Chain 1 addresses the KEY, not
  // the settlement network: this is an identity, not a payment instruction.
  const kid = `did:pkh:eip155:1:${account.address}#key-1`;

  return createOfferReceiptExtension(
    createEIP712OfferReceiptIssuer(kid, account.signTypedData.bind(account)),
  );
};


/**
 * Retry `getSupported()` on transient failures.
 *
 * `*.circle.com` is intermittently TLS-intercepted on some networks: the same
 * request succeeds under curl and throws `certificate has expired` under Bun
 * seconds later, then succeeds again. Measured here: roughly one boot in three lost the rail before this existed.
 *
 * This matters more than it looks. `initialize()` swallows a facilitator that
 * throws, so a single flake silently removes a whole payment rail, and the only
 * symptom is filterSupportedAccepts reporting "no facilitator support" for a
 * network that is in fact supported. We spent real time believing Arc was
 * unavailable for that reason. Retrying turns an intermittent network fault
 * back into what it is, rather than a permanent-looking capability gap.
 */
/**
 * Retry VERIFY, never SETTLE.
 *
 * The asymmetry is deliberate and load-bearing. `verify` asks whether a payload
 * would be accepted and changes nothing, so retrying a transport failure is
 * free. `settle` MOVES MONEY: a retry after a response we never saw can pay
 * twice, and a duplicate payment is a much worse outcome than a failed one.
 * When settlement genuinely fails it fails loudly and the buyer retries with a
 * fresh payload, which is the safe direction.
 */
const withVerifyRetry = <T extends { verify?: (...a: never[]) => Promise<unknown>; url?: string }>(
  client: T,
  attempts = 4,
): T => {
  if (typeof client.verify !== 'function') return client;
  const original = client.verify.bind(client);
  const url = client.url ?? 'facilitator';

  client.verify = (async (...args: never[]) => {
    let last: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await original(...args);
      } catch (error) {
        last = error;
        if (i < attempts) {
          console.warn(`[x402] ${url} verify attempt ${i}/${attempts} failed: ${error}`);
          await new Promise((r) => setTimeout(r, 300 * i));
        }
      }
    }
    throw last;
  }) as T['verify'];

  return client;
};

const withRetry = <T extends { getSupported: () => Promise<unknown>; url?: string }>(client: T, attempts = 4): T => {
  const original = client.getSupported.bind(client);
  const url = client.url ?? 'facilitator';

  client.getSupported = async () => {
    let last: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        const response = await original();
        void remember(url, response);
        return response;
      } catch (error) {
        last = error;
        if (i < attempts) {
          // Name the facilitator. Two are in play and the message is identical
          // from either, which turns a five-minute diagnosis into an hour.
          console.warn(`[x402] ${url} getSupported attempt ${i}/${attempts} failed: ${error}`);
          await new Promise((r) => setTimeout(r, 400 * i));
        }
      }
    }

    // Live call exhausted. Fall back to the last capability list we actually
    // saw from THIS facilitator. Capabilities only: nothing here can make a
    // payment appear to have settled.
    const cached = await recall(url);
    if (cached) {
      console.warn(
        `[x402] ${url} unreachable; USING CACHED capability list from ${cached.fetchedAt}. ` +
        'Rails stay advertised, but settlement will be attempted against the live facilitator ' +
        'and will fail loudly if it is still down.',
      );
      return cached.response;
    }

    console.error(`[x402] ${url} unreachable and no usable cache. Its rails will be dropped.`);
    throw last;
  };
  return client;
};

export const buildX402Server = async (): Promise<x402ResourceServer> => {
  // Two facilitators, because no single one serves both rails: Blocky402 has
  // Hedera and not Arc, Circle Gateway has Arc and not Hedera. The resource
  // server takes an array and matches each accepts entry to whichever
  // facilitator advertises it.
  //
  // The cast is narrow and deliberate: BatchFacilitatorClient declares
  // ResourceInfo.description as optional where @x402/core requires it, so the
  // two FacilitatorClient shapes are structurally incompatible even though both
  // implement the same interface. Circle's package pins its own @x402/core.
  const facilitators = [
    withRetry(new HTTPFacilitatorClient({ url: FACILITATOR_URL })),
    withVerifyRetry(withRetry(new BatchFacilitatorClient({ url: ARC_FACILITATOR_URL }))) as unknown as HTTPFacilitatorClient,
  ];
  const server = new x402ResourceServer(facilitators);
  server.register(HEDERA_TESTNET_CAIP2, new ExactHederaScheme());
  server.register(ARC_CAIP2, new GatewayEvmScheme());

  const ext = offerReceiptExtension();
  if (ext) {
    server.registerExtension(ext);
    console.log('[x402] offer/receipt extension registered (EIP-712 signed)');
  }

  // Idempotency at the PROTOCOL layer. Postgres already refuses a second gate
  // payment row per decision via @@unique([decisionId, leg]), but that fires
  // after settlement: the money has moved and the constraint only stops us
  // recording it twice. Matching on a client-supplied payment id lets a retried
  // request be recognised as the same payment before it settles again, which is
  // the difference between a safe retry and a double charge.
  server.registerExtension(paymentIdentifierResourceServerExtension);

  // A rejected payment surfaces to the buyer as a bare 402 with an empty body,
  // which is indistinguishable from "you did not pay". Log the facilitator's
  // actual reason: without this, diagnosing a rail that refuses everything means
  // guessing between a bad signature, an unfunded balance, and a self-payment.
  server.onVerifyFailure(async (ctx: unknown) => {
    const c = ctx as { paymentRequirements?: { network?: string }; verifyResponse?: unknown; error?: unknown };
    console.warn(
      `[x402] VERIFY FAILED on ${c.paymentRequirements?.network ?? 'unknown network'}: ` +
      JSON.stringify(c.verifyResponse ?? c.error ?? 'no reason given'),
    );
  });

  await server.initialize();
  return server;
};

/**
 * Keep only the accepts entries the live facilitator set actually advertises.
 * Throws if nothing survives, because booting with an unpayable gate is worse
 * than not booting at all.
 */
export const filterSupportedAccepts = (
  server: x402ResourceServer,
  desired: PaymentOptionLike[],
): PaymentOptionLike[] => {
  const accepts = desired.filter((o) => {
    const ok = !!server.getSupportedKind(2, o.network as never, o.scheme);
    if (!ok) {
      // "unsupported" and "we could not reach the facilitator that supports
      // it" look identical here, and only the first is a real capability gap.
      // Say so, or the next person debugs the wrong problem for an hour.
      console.warn(
        `[x402] DROPPED accepts entry: ${o.scheme} on ${o.network} ` +
        '(no facilitator advertised it — either genuinely unsupported, or its /supported call failed at boot)',
      );
    }
    return ok;
  });

  if (accepts.length === 0) throw new Error('no_payment_option_available');

  console.log(`[x402] ${accepts.length} payment option(s) live: ${accepts.map((a) => a.network).join(', ')}`);
  return accepts;
};
