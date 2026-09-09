/**
 * The paying path for the MCP tool.
 *
 * Loaded ONLY when a wallet is configured. The oversight path — polling a
 * decision, reporting the outcome — has no dependencies at all, and an
 * integrator who just wants human approval against a hosted Proctor should not
 * be made to install a Hedera SDK to get it.
 *
 * The 402 challenge rides in a base64 `payment-required` response HEADER, not
 * the body. `wrapFetchWithPayment` reads the header, selects an option, signs
 * the payload and retries. Hand-rolling it costs an hour and gets the header
 * wrong.
 */
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import {
  createClientHederaSigner, PrivateKey,
  HEDERA_TESTNET_CAIP2, HEDERA_TESTNET_USDC, HBAR_ASSET_ID,
} from '@x402/hedera';

export interface PaidDecision {
  decisionId: string;
  decisionHash: string;
  humanLine: string;
  ttlSeconds: number;
}

export const makePayingFetch = (agentId: string, agentKey: string): typeof fetch => {
  const signer = createClientHederaSigner(agentId, PrivateKey.fromStringECDSA(agentKey), {
    // Must be the CAIP-2 id. The bare name throws "Unsupported Hedera network".
    network: HEDERA_TESTNET_CAIP2,
  });

  const client = new x402Client()
    .register(HEDERA_TESTNET_CAIP2, new ExactHederaScheme(signer))
    // The agent's own guard, not the gate's: refuse to pay in an asset its
    // operator never approved, and refuse to overpay in one it did. Software
    // that spends money unattended should default to this.
    .setSpendControls({
      allowedAssets: [
        { network: HEDERA_TESTNET_CAIP2, asset: HBAR_ASSET_ID, maxAmountPerPayment: '200000000' },
        { network: HEDERA_TESTNET_CAIP2, asset: HEDERA_TESTNET_USDC, maxAmountPerPayment: '2000000' },
        ...(process.env['AGENT_ALLOWED_TOKENS'] ?? '')
          .split(',').map((t) => t.trim()).filter(Boolean)
          .map((asset) => ({
            network: HEDERA_TESTNET_CAIP2 as `${string}:${string}`,
            asset, maxAmountPerPayment: '2000000',
          })),
      ],
    });

  return wrapFetchWithPayment(fetch, client) as typeof fetch;
};
