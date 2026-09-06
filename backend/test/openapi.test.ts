/**
 * OpenAPI and reviewer-surface tests.
 *
 * The regression that matters here: Fastify serialises responses AGAINST the
 * schema, so a response declared `{ type: 'object' }` with no properties
 * silently strips the entire body to `{}`. That shipped once and is exactly the
 * kind of failure that looks like a backend outage on camera.
 */
import { test, expect } from 'bun:test';
import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import { openapiConfig } from '../src/lib/openapi/spec.ts';
import { featuresRoutes } from '../src/routes/featuresRoutes.ts';

const build = async () => {
  const app = Fastify();
  await app.register(fastifySwagger, openapiConfig as never);
  app.register(featuresRoutes);
  await app.ready();
  return app;
};

test('REGRESSION: a free-form response schema must not strip the body', async () => {
  const app = await build();
  const res = await app.inject({ method: 'GET', url: '/features' });
  const body = res.json() as Record<string, unknown>;

  expect(res.statusCode).toBe(200);
  // The bug produced exactly `{}`. Assert real content, not just a 200.
  expect(Object.keys(body).length).toBeGreaterThan(5);
  expect(body.hedera).toBeDefined();
  expect(body.world).toBeDefined();
  await app.close();
});

test('/features states what is BLOCKED rather than omitting it', async () => {
  const app = await build();
  const body = (await app.inject({ method: 'GET', url: '/features' })).json() as {
    blocked: Array<{ item: string; reason: string; evidence: string }>;
  };

  expect(body.blocked.length).toBeGreaterThanOrEqual(2);
  for (const b of body.blocked) {
    expect(b.reason.length).toBeGreaterThan(10);
    // A gap without evidence is a marketing claim, not a disclosure.
    expect(b.evidence.length).toBeGreaterThan(10);
  }
  await app.close();
});

test('/features does not overclaim the World credential', async () => {
  const app = await build();
  const body = (await app.inject({ method: 'GET', url: '/features' })).json() as {
    world: { doNotClaim: string; claim: string; selfieCheckGranted: boolean; mode: string };
  };

  expect(body.world.doNotClaim).toContain('does not prove one-person-one-account');
  expect(body.world.claim).toContain('NOT an identity signal');
  // The flag state must be derived, never hardcoded true.
  expect(body.world.selfieCheckGranted).toBe(body.world.mode === 'SELFIE');
  await app.close();
});

test('the OpenAPI document declares both auth schemes', async () => {
  const app = await build();
  const spec = app.swagger() as {
    openapi: string;
    info: { title: string };
    components: { securitySchemes: Record<string, unknown> };
  };

  expect(spec.openapi).toMatch(/^3\./);
  expect(spec.info.title).toBe('Proctor');
  expect(Object.keys(spec.components.securitySchemes).sort()).toEqual(['witnessToken', 'x402']);
  await app.close();
});

test('the spec documents that the 402 challenge is a HEADER, not the body', async () => {
  // The single most expensive misunderstanding available on this API.
  const app = await build();
  const spec = app.swagger() as { info: { description: string } };
  expect(spec.info.description).toContain('payment-required');
  expect(spec.info.description).toContain('not in the body');
  await app.close();
});
