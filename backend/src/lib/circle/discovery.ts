import { HEDERA_TESTNET_CAIP2 } from '@x402/hedera';
import { PAY_TO_HEDERA, GATE_PRICE_USD } from '../../config/main-config.ts';

/** Circle's public x402 catalog. No API key. */
const DISCOVERY_URL = 'https://api.circle.com/v2/x402/discovery/resources';

export interface DiscoveryAccept {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  maxTimeoutSeconds?: number;
}

export interface DiscoveryItem {
  resource: string;
  type: string;
  x402Version: number;
  lastUpdated?: string;
  accepts: DiscoveryAccept[];
}

/**
 * Retries because `*.circle.com` is intermittently DNS-hijacked on some
 * networks: the interception returns an expired certificate, so a request can
 * fail with CERT_HAS_EXPIRED and the next one succeed. Discovery is optional
 * metadata, so it must never take a caller down.
 */
export const fetchCatalog = async (limit = 50, attempts = 3): Promise<DiscoveryItem[]> => {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${DISCOVERY_URL}?limit=${limit}`);
      if (!res.ok) throw new Error(`discovery api ${res.status}`);
      const body = (await res.json()) as { items?: DiscoveryItem[] };
      return body.items ?? [];
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('discovery unreachable');
};

/** Networks present in the catalog, by service count. */
export const networksInCatalog = (items: DiscoveryItem[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const accept of item.accepts ?? []) {
      counts[accept.network] = (counts[accept.network] ?? 0) + 1;
    }
  }
  return counts;
};

/**
 * Proctor's own listing, in the marketplace's own shape.
 *
 * Publishing this lets an agent evaluate the gate with the same parser it uses
 * for the catalog, rather than a Proctor-specific one.
 */
export const selfListing = (resourceUrl: string): DiscoveryItem => ({
  resource: resourceUrl,
  type: 'http',
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: HEDERA_TESTNET_CAIP2,
      asset: '0.0.429274',
      payTo: PAY_TO_HEDERA,
      amount: String(Math.round(Number(GATE_PRICE_USD) * 1_000_000)),
      maxTimeoutSeconds: 180,
    },
  ],
});
