import './dotenv.ts';

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import FastifyCors from '@fastify/cors';
import { APP_PORT } from './src/config/main-config.ts';

// Routes
import { gateRoutes } from './src/routes/gateRoutes.ts';
import { evidenceRoutes } from './src/routes/evidenceRoutes.ts';
import { witnessRoutes } from './src/routes/witnessRoutes.ts';
import { wellKnownRoutes } from './src/routes/wellKnownRoutes.ts';
import { featuresRoutes } from './src/routes/featuresRoutes.ts';
import { demoRoutes } from './src/routes/demoRoutes.ts';

// OpenAPI, generated from the routes' own schemas so it cannot drift
import fastifySwagger from '@fastify/swagger';
import { openapiConfig } from './src/lib/openapi/spec.ts';

// x402
import { paymentMiddleware } from '@x402/fastify';
import { buildX402Server, filterSupportedAccepts, hederaGateOption, arcGateOption } from './src/lib/x402/server.ts';
import { declareOfferReceiptExtension } from '@x402/extensions/offer-receipt';
import { declarePaymentIdentifierExtension, PAYMENT_IDENTIFIER } from '@x402/extensions/payment-identifier';
import { releaseOption } from './src/lib/x402/meter.ts';
import { FACILITATOR_URL } from './src/config/main-config.ts';

// Workers
import { startErrorLogCleanupWorker } from './src/workers/errorLogCleanup.ts';
import { a2aRoutes } from './src/routes/a2aRoutes.ts';
import { startTtlSweeper } from './src/workers/ttlSweeper.ts';
import { startAttestationBackfill } from './src/workers/attestationBackfill.ts';

console.log(
  '======================\n======================\nMY BACKEND SYSTEM STARTED!\n======================\n======================\n'
);

const fastify = Fastify({
  logger: false,
});

fastify.register(FastifyCors, {
  // The witness PWA and console are served from a different origin in dev
  // (Vite on :3200) and may be a different host in production.
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'token',
    // x402 v2 wire headers. Without these a browser-side agent client is
    // blocked at preflight and the 402 never reaches it.
    'payment-signature', 'x-payment', 'idempotency-key',
    // Sent by the PWA so ngrok serves the API response instead of its browser
    // interstitial. Omitting it here fails PREFLIGHT, which blocks every call
    // including on localhost, where the header is harmless but still declared.
    'ngrok-skip-browser-warning',
  ],
  exposedHeaders: ['payment-required'],
});

// Health check endpoint
fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
  return reply.status(200).send({
    success: true,
    message: 'Hello there!',
    error: null,
    data: null,
  });
});

await fastify.register(fastifySwagger, openapiConfig as never);

// Register routes with prefixes
fastify.register(gateRoutes, { prefix: '/v1/gate' });
fastify.register(witnessRoutes, { prefix: '/v1/witness' });
fastify.register(evidenceRoutes, { prefix: '/v1/evidence' });
fastify.register(wellKnownRoutes, { prefix: '/.well-known' });
fastify.register(a2aRoutes, { prefix: '/a2a' });
fastify.register(demoRoutes, { prefix: '/v1/demo' });
fastify.register(featuresRoutes);

/** The generated OpenAPI document, at a stable path. */
fastify.get('/openapi.json', async (_req, reply) => reply.code(200).send(fastify.swagger()));

const start = async (): Promise<void> => {
  try {
    // ---------------------------------------------------------------------
    // x402 paywall.
    //
    // The preflight below is not optional. A facilitator that is unreachable
    // does NOT degrade: it takes the whole route down, including entries a
    // healthy facilitator serves, with a bare 500 on every request. boot looks
    // clean because initialize() swallows the failure and paymentMiddleware()
    // validates lazily, then throws asynchronously where setErrorHandler
    // cannot catch it.
    // ---------------------------------------------------------------------
    console.log(`[x402] facilitator: ${FACILITATOR_URL}`);
    const x402Server = await buildX402Server();
    // Both rails offered; the preflight keeps whichever the facilitators actually
    // advertise, so a dead one degrades to the other instead of taking the route down.
    const accepts = filterSupportedAccepts(x402Server, [hederaGateOption(), arcGateOption()]);

    paymentMiddleware(
      fastify,
      {
        'POST /v1/gate/decisions': {
          accepts: accepts as never,
          description: 'Proctor human oversight decision',
          mimeType: 'application/json',
          // The extension's hooks only run for routes that DECLARE it.
          // Registering the issuer alone signs nothing.
          extensions: {
            ...declareOfferReceiptExtension(),
            // Optional, not required: rejecting agents that omit an id would
            // break every client that has not adopted the extension.
            [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false),
          } as never,
        },
        // Call 2: priced from real review seconds, not a flat charge.
        'POST /v1/gate/decisions/:id/release': {
          accepts: [releaseOption()] as never,
          description: 'Proctor oversight outcome, metered per second of human attention',
          mimeType: 'application/json',
          extensions: {
            ...declareOfferReceiptExtension(),
            // Optional, not required: rejecting agents that omit an id would
            // break every client that has not adopted the extension.
            [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false),
          } as never,
        },
      } as never,
      x402Server,
    );

    // Start workers
    startErrorLogCleanupWorker();
    startTtlSweeper();
    startAttestationBackfill();

    await fastify.listen({
      port: APP_PORT,
      host: '0.0.0.0',
    });

    const address = fastify.server.address();
    const port = typeof address === 'object' && address ? address.port : APP_PORT;

    console.log(`Server started successfully on port ${port}`);
    console.log(`http://localhost:${port}`);
  } catch (error) {
    console.log('Error starting server: ', error);
    process.exit(1);
  }
};

start();
