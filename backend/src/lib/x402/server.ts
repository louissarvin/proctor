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
import { ExactHederaScheme } from '@x402/hedera/exact/server';
import { HEDERA_TESTNET_CAIP2 } from '@x402/hedera';
import { FACILITATOR_URL, PAY_TO_HEDERA, GATE_PRICE_USD } from '../../config/main-config.ts';

export interface PaymentOptionLike {
  scheme: string;
  network: string;
  payTo: string;
  price: string;
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
  price: `$${GATE_PRICE_USD}`,
  maxTimeoutSeconds: 180,
});

export const buildX402Server = async (): Promise<x402ResourceServer> => {
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const server = new x402ResourceServer(facilitator);
  server.register(HEDERA_TESTNET_CAIP2, new ExactHederaScheme());
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
      console.warn(`[x402] DROPPED accepts entry: ${o.scheme} on ${o.network} (no facilitator support)`);
    }
    return ok;
  });

  if (accepts.length === 0) throw new Error('no_payment_option_available');

  console.log(`[x402] ${accepts.length} payment option(s) live: ${accepts.map((a) => a.network).join(', ')}`);
  return accepts;
};
