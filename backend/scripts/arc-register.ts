/**
 * Register the Proctor agent in Arc's canonical ERC-8004 IdentityRegistry.
 *
 *   bun run arc:register
 *
 * Needs USDC on Arc for gas. Arc's native token IS USDC, 18 decimals.
 */
import { formatEther } from 'viem';
import { arcAccount, arcConfigured, publicClient, registerAgent, readAgent, agentCard } from '../src/lib/arc/identity.ts';
import { ERC8004, arcExplorerTx, arcExplorerToken } from '../src/lib/arc/chain.ts';

if (!arcConfigured()) {
  console.error('ARC_PRIVATE_KEY is not set.');
  process.exit(1);
}

const account = arcAccount();
const pub = publicClient();
const balance = await pub.getBalance({ address: account.address });

console.log('Arc testnet, chain 5042002');
console.log('  registry :', ERC8004.identity);
console.log('  wallet   :', account.address);
console.log('  balance  :', formatEther(balance), 'USDC (gas)\n');

if (balance === 0n) {
  console.error('Wallet has no USDC for gas.');
  console.error('Fund it at https://faucet.circle.com  ->  network: Arc Testnet');
  console.error(`  address: ${account.address}`);
  process.exit(1);
}

// The card the tokenURI points at. Hosted, so it stays in step with the service.
const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3700';
const metadataURI = `${baseUrl}/.well-known/agent-card.json`;
console.log('agent card:', metadataURI);
console.log(JSON.stringify(agentCard(baseUrl), null, 2), '\n');

console.log('registering...');
const result = await registerAgent(metadataURI);

console.log('\nREGISTERED');
console.log('  agentId  :', result.agentId);
console.log('  owner    :', result.owner);
console.log('  tx       :', arcExplorerTx(result.txHash));
console.log('  token    :', arcExplorerToken(result.agentId));

const onChain = await readAgent(result.agentId);
console.log('\nverified on chain:');
console.log('  ownerOf  :', onChain.owner);
console.log('  tokenURI :', onChain.tokenURI);
console.log('\nadd to .env:  ARC_AGENT_ID=' + result.agentId);
