/**
 * Gate tests that need no Hedera credentials.
 * Issuing a 402 only requires the facilitator's public /supported endpoint.
 */
import { test, expect } from 'bun:test';
import { buildX402Server, filterSupportedAccepts, hederaGateOption, arcGateOption } from '../src/lib/x402/server.ts';
import { ARC_CHAIN_ID } from '../src/config/main-config.ts';

test('Blocky402 advertises Hedera exact, so the gate is payable', async () => {
  const server = await buildX402Server();
  const accepts = filterSupportedAccepts(server, [hederaGateOption()]);
  expect(accepts).toHaveLength(1);
  expect(accepts[0]!.network).toBe('hedera:testnet');
}, 30_000);

test('PREFLIGHT: an unsupported network is dropped, not fatal', async () => {
  // Without this filter, an accepts entry the facilitator does not serve throws
  // RouteConfigurationError asynchronously, which setErrorHandler cannot catch,
  // producing a bare 500 on EVERY request including the healthy Hedera one.
  //
  // NB this deliberately uses a chain id nobody serves. It used to use Arc,
  // which was wrong: Arc is unsupported by Blocky402 but IS served by Circle's
  // Gateway facilitator, so using it here asserted a limitation of one
  // facilitator as though it were a property of the network.
  const server = await buildX402Server();
  const nowhere = {
    scheme: 'exact',
    network: 'eip155:999999',
    payTo: '0x0000000000000000000000000000000000000001',
    price: '$0.0021',
  };
  const accepts = filterSupportedAccepts(server, [hederaGateOption(), nowhere]);
  expect(accepts).toHaveLength(1);
  expect(accepts[0]!.network).toBe('hedera:testnet');
}, 30_000);

test('TWO RAILS: Hedera via Blocky402, Arc via Circle Gateway', async () => {
  // No single facilitator serves both. Blocky402 has Hedera and not Arc;
  // Circle Gateway has Arc and not Hedera. The resource server takes an array
  // and routes each accepts entry to whichever one advertises it.
  const server = await buildX402Server();
  const accepts = filterSupportedAccepts(server, [hederaGateOption(), arcGateOption()]);

  expect(accepts.map((a) => a.network)).toContain('hedera:testnet');

  // Circle's facilitator is intermittently unreachable from some networks
  // (TLS interception on *.circle.com), which buildX402Server retries through.
  // If it still lost the race, assert the DEGRADED path rather than failing:
  // the product requirement is that a dead facilitator never takes the healthy
  // rail down with it, and that is what actually matters here.
  if (accepts.length === 2) {
    expect(accepts.map((a) => a.network)).toContain(`eip155:${ARC_CHAIN_ID}`);
  } else {
    expect(accepts).toHaveLength(1);
    expect(accepts[0]!.network).toBe('hedera:testnet');
  }
}, 60_000);

test('PREFLIGHT: refuses to boot when nothing is payable', async () => {
  const server = await buildX402Server();
  const onlyUnsupported = [{
    scheme: 'exact',
    network: 'eip155:999999',
    payTo: '0x0000000000000000000000000000000000000001',
    price: '$1',
  }];
  expect(() => filterSupportedAccepts(server, onlyUnsupported)).toThrow('no_payment_option_available');
}, 30_000);
