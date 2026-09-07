import { test, expect, afterAll } from 'bun:test';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { remember, recall } from '../src/lib/x402/supportedCache.ts';

const DIR = join(process.cwd(), '.cache');
const URL_A = 'https://cache-test.example/one';
const URL_B = 'https://cache-test.example/two';
const fileFor = (u: string) => join(DIR, `x402-supported-${u.replace(/[^a-z0-9]/gi, '-')}.json`);

afterAll(async () => {
  await rm(fileFor(URL_A), { force: true });
  await rm(fileFor(URL_B), { force: true });
});

const kinds = { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:5042002' }] };

test('a remembered capability list is recalled', async () => {
  await remember(URL_A, kinds);
  const got = await recall(URL_A);
  expect(got?.response).toEqual(kinds);
});

test('caches are per facilitator, never shared', async () => {
  // Sharing would let a reachable facilitator vouch for an unreachable one,
  // and we would advertise rails nobody serves.
  await remember(URL_A, kinds);
  expect(await recall(URL_B)).toBeNull();
});

test('an unknown facilitator recalls nothing rather than guessing', async () => {
  expect(await recall('https://never-seen.example')).toBeNull();
});

test('STALENESS: a cache older than the window is refused, not served', async () => {
  // Capabilities drift. Past the window we would rather drop the rail than
  // advertise something the facilitator may have stopped supporting.
  await mkdir(DIR, { recursive: true });
  await writeFile(
    fileFor(URL_A),
    JSON.stringify({
      url: URL_A,
      fetchedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      response: kinds,
    }),
    'utf8',
  );

  expect(await recall(URL_A)).toBeNull();
});

test('a corrupt cache file is treated as absent, not thrown', async () => {
  await mkdir(DIR, { recursive: true });
  await writeFile(fileFor(URL_A), 'not json at all', 'utf8');
  expect(await recall(URL_A)).toBeNull();
});

test('THE SAFETY BOUNDARY: only capabilities are stored, never settlement', async () => {
  // The cache exists so a hostile network cannot silently delete a payment
  // rail. It must never be able to make a payment look settled. If someone
  // later caches a settle response through this module, this test is what
  // stops it: the persisted shape is the facilitator's capability list and
  // nothing else.
  await remember(URL_A, kinds);
  const raw = JSON.parse(await readFile(fileFor(URL_A), 'utf8'));

  expect(Object.keys(raw).sort()).toEqual(['fetchedAt', 'response', 'url']);
  const serialised = JSON.stringify(raw);
  for (const forbidden of ['transaction', 'txHash', 'settled', 'payer', 'signature']) {
    expect(serialised).not.toContain(forbidden);
  }
});
