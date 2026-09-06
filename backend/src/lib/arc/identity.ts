import { createPublicClient, createWalletClient, http, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet, ERC8004 } from './chain.ts';
import { proctorGateUaid } from '../attestation/uaid.ts';
import { HEDERA_NETWORK, PAY_TO_HEDERA, ARC_PRIVATE_KEY } from '../../config/main-config.ts';

/**
 * ERC-8004 agent identity on Arc.
 *
 * We use HCS-14 on Hedera and ERC-8004 here rather than choosing one: each is the
 * canonical identifier on its own chain, and the agent card publishes both.
 * ERC-8004 was previously rejected because a self-deployed registry is a weaker
 * claim than a canonical one and Hedera has none. Arc ships canonical registries,
 * so that objection does not apply.
 */
const IDENTITY_ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [{ name: 'metadataURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'event', name: 'Transfer', inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'tokenId', type: 'uint256', indexed: true },
  ] },
] as const;

export const arcConfigured = (): boolean => Boolean(ARC_PRIVATE_KEY);

export const arcAccount = () => {
  if (!ARC_PRIVATE_KEY) throw new Error('ARC_PRIVATE_KEY is not configured');
  return privateKeyToAccount(ARC_PRIVATE_KEY as `0x${string}`);
};

export const publicClient = () => createPublicClient({ chain: arcTestnet, transport: http() });

/** ERC-8004 agent card. Hosted rather than IPFS-pinned; the URI is what is on chain. */
export const agentCard = (baseUrl: string) => ({
  name: 'Proctor oversight gate',
  description:
    'A human oversight gate for AI agents. An agent is stopped by an HTTP 402, pays to open a decision, ' +
    'and a verified human who is not the operator approves or refuses within a fixed deadline. ' +
    'The output is a tamper-evident evidence record on Hedera Consensus Service.',
  version: '1.0.0',
  capabilities: ['human_oversight', 'x402_payment', 'evidence_attestation'],
  endpoints: { gate: `${baseUrl}/v1/gate/decisions`, openapi: `${baseUrl}/openapi.json` },
  identifiers: {
    // The Hedera-native identifier for the same agent.
    hcs14: PAY_TO_HEDERA ? proctorGateUaid(PAY_TO_HEDERA, HEDERA_NETWORK) : null,
  },
  payment: { protocol: 'x402', version: 2, network: `hedera:${HEDERA_NETWORK}` },
});

export interface RegistrationResult {
  agentId: string;
  txHash: string;
  owner: string;
  metadataURI: string;
}

/** Mints the identity NFT and returns the agentId from the Transfer log. */
export async function registerAgent(metadataURI: string): Promise<RegistrationResult> {
  const account = arcAccount();
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
  const pub = publicClient();

  const hash = await wallet.writeContract({
    address: ERC8004.identity,
    abi: IDENTITY_ABI,
    functionName: 'register',
    args: [metadataURI],
  });

  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`registration reverted: ${hash}`);

  // The agentId is the minted tokenId, carried on the Transfer event.
  const logs = parseEventLogs({ abi: IDENTITY_ABI, eventName: 'Transfer', logs: receipt.logs });
  const tokenId = logs.at(-1)?.args.tokenId;
  if (tokenId === undefined) throw new Error('no Transfer event in receipt');

  return {
    agentId: tokenId.toString(),
    txHash: hash,
    owner: account.address,
    metadataURI,
  };
}

export async function readAgent(agentId: string): Promise<{ owner: string; tokenURI: string }> {
  const pub = publicClient();
  const [owner, tokenURI] = await Promise.all([
    pub.readContract({ address: ERC8004.identity, abi: IDENTITY_ABI, functionName: 'ownerOf', args: [BigInt(agentId)] }),
    pub.readContract({ address: ERC8004.identity, abi: IDENTITY_ABI, functionName: 'tokenURI', args: [BigInt(agentId)] }),
  ]);
  return { owner: owner as string, tokenURI: tokenURI as string };
}
