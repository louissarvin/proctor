/**
 * Cache a facilitator's capability advertisement.
 *
 * WHAT THIS IS FOR. `/supported` says which (network, scheme) pairs a
 * facilitator can settle. That answer is stable for days. But
 * `x402ResourceServer.initialize()` SWALLOWS a facilitator that throws, so a
 * single failed call silently deletes an entire payment rail, and the only
 * symptom is a route that quietly stops offering it. On a network that
 * intermittently TLS-intercepts `*.circle.com` — ours does, with an expired
 * certificate that macOS trusts and Bun correctly does not — that turns a
 * transient fault into a missing product feature.
 *
 * THE SAFETY BOUNDARY, WHICH IS THE WHOLE DESIGN. This caches CAPABILITIES
 * ONLY. It never caches `verify` or `settle`, and it never implies a payment
 * happened. The worst case is that we advertise a rail whose facilitator is
 * currently unreachable, and the payment then fails loudly at settlement time
 * against the live facilitator. Advertising a rail we cannot reach is a
 * recoverable inconvenience; reporting a settlement we did not make would be a
 * lie, and no cache is allowed near that path.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = join(process.cwd(), '.cache');

/** Stale beyond this and we would rather fail honestly than guess. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Entry {
  url: string;
  fetchedAt: string;
  response: unknown;
}

const fileFor = (url: string): string =>
  join(DIR, `x402-supported-${url.replace(/[^a-z0-9]/gi, '-')}.json`);

export const remember = async (url: string, response: unknown): Promise<void> => {
  try {
    await mkdir(DIR, { recursive: true });
    const entry: Entry = { url, fetchedAt: new Date().toISOString(), response };
    await writeFile(fileFor(url), JSON.stringify(entry, null, 2), 'utf8');
  } catch {
    // A cache that cannot be written must never break a boot that otherwise
    // succeeded. We already have the live answer at this point.
  }
};

export const recall = async (url: string): Promise<{ response: unknown; fetchedAt: string } | null> => {
  try {
    const entry = JSON.parse(await readFile(fileFor(url), 'utf8')) as Entry;
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (!Number.isFinite(age) || age > MAX_AGE_MS) return null;
    return { response: entry.response, fetchedAt: entry.fetchedAt };
  } catch {
    return null;
  }
};
