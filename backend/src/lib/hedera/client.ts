/**
 * Hedera client.
 *
 * ONE SDK, PINNED. @x402/hedera declares @hiero-ledger/sdk 2.85.0 as a hard
 * dependency, so the root pin matches it exactly. Two copies means two
 * PrivateKey classes and every instanceof across the x402 boundary fails with
 * errors that make no sense. Never add @hashgraph/sdk.
 *
 * ECDSA, NOT ED25519. ED25519 has no EVM alias, and the Hedera Harness tier
 * requires an ECDSA operator.
 */
import { Client, PrivateKey, AccountId } from '@hiero-ledger/sdk';
import { HEDERA_NETWORK, HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY } from '../../config/main-config.ts';

let cached: Client | null = null;

export const hederaConfigured = (): boolean =>
  Boolean(HEDERA_OPERATOR_ID && HEDERA_OPERATOR_KEY);

export const hederaClient = (): Client => {
  if (cached) return cached;
  if (!hederaConfigured()) {
    throw new Error('HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY are required for HCS writes');
  }
  const client = HEDERA_NETWORK === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(
    AccountId.fromString(HEDERA_OPERATOR_ID),
    PrivateKey.fromStringECDSA(HEDERA_OPERATOR_KEY),
  );
  cached = client;
  return client;
};

export const closeHederaClient = (): void => {
  cached?.close();
  cached = null;
};
