import { defineChain } from 'viem';

/** Arc uses USDC as the native gas token, 18 decimals, not 6. */
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
  testnet: true,
});

/** Canonical ERC-8004 registries deployed by Circle on Arc testnet. */
export const ERC8004 = {
  identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  validation: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
} as const;

export const arcExplorerTx = (hash: string) => `https://testnet.arcscan.app/tx/${hash}`;
export const arcExplorerToken = (id: string) =>
  `https://testnet.arcscan.app/token/${ERC8004.identity}/instance/${id}`;
