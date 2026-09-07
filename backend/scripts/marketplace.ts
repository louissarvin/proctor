/**
 * Survey Circle's Agent Marketplace and locate Proctor within it.
 *
 * Answers a question the Circle track cares about: is this service actually
 * discoverable by other agents, and in what company?
 */
import { fetchCatalog, networksInCatalog, selfListing } from '../src/lib/circle/discovery.ts';

let items;
try {
  items = await fetchCatalog(50);
} catch (error) {
  const code = (error as { code?: string }).code;
  console.error(`Circle Discovery API unreachable: ${code ?? (error as Error).message}`);
  if (code === 'CERT_HAS_EXPIRED') {
    console.error('That is the *.circle.com DNS interception, not a code fault.');
    console.error('dig +short api.circle.com  ->  expect internetpositif / firstmedia when hijacked.');
  }
  process.exit(1);
}
const nets = networksInCatalog(items);
const sorted = Object.entries(nets).sort((a, b) => b[1] - a[1]);

console.log(`Circle Agent Marketplace: ${items.length} services sampled\n`);
console.log('networks by service count:');
for (const [network, count] of sorted.slice(0, 10)) {
  console.log(`  ${String(count).padStart(3)}  ${network}`);
}

const hedera = sorted.filter(([n]) => n.toLowerCase().includes('hedera'));
console.log(`\nHedera services listed: ${hedera.length === 0 ? 'NONE' : hedera.map(([n, c]) => `${n} (${c})`).join(', ')}`);

console.log('\nProctor, in the catalog\'s own shape:');
console.log(JSON.stringify(selfListing('https://<host>/v1/gate/decisions'), null, 2));

if (hedera.length === 0) {
  console.log('\nNo Hedera x402 service appears in the sampled catalog.');
  console.log('Listing prerequisites (all met): a 402-returning service, a published');
  console.log('OpenAPI spec at /openapi.json, and a payout account. The remaining');
  console.log('requirement is a publicly reachable URL, since listings are health-checked.');
}
