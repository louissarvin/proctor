/**
 * Gate tests that need no Hedera credentials.
 * Issuing a 402 only requires the facilitator's public /supported endpoint.
 */
import { test, expect } from 'bun:test';
import { buildX402Server, filterSupportedAccepts, hederaGateOption } from '../src/lib/x402/server.ts';

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
  const server = await buildX402Server();
  const arc = {
    scheme: 'exact',
    network: 'eip155:5042002',
    payTo: '0x0000000000000000000000000000000000000001',
    price: '$0.0021',
  };
  const accepts = filterSupportedAccepts(server, [hederaGateOption(), arc]);
  expect(accepts).toHaveLength(1);
  expect(accepts[0]!.network).toBe('hedera:testnet');
}, 30_000);

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
