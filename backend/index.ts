import './dotenv.ts';

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import FastifyCors from '@fastify/cors';
import { APP_PORT } from './src/config/main-config.ts';

// Routes
import { gateRoutes } from './src/routes/gateRoutes.ts';

// x402
import { paymentMiddleware } from '@x402/fastify';
import { buildX402Server, filterSupportedAccepts, hederaGateOption } from './src/lib/x402/server.ts';
import { FACILITATOR_URL } from './src/config/main-config.ts';

// Workers
import { startErrorLogCleanupWorker } from './src/workers/errorLogCleanup.ts';
import { startTtlSweeper } from './src/workers/ttlSweeper.ts';

console.log(
  '======================\n======================\nMY BACKEND SYSTEM STARTED!\n======================\n======================\n'
);

const fastify = Fastify({
  logger: false,
});

fastify.register(FastifyCors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'token'],
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

// Register routes with prefixes
fastify.register(gateRoutes, { prefix: '/v1/gate' });

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
    const accepts = filterSupportedAccepts(x402Server, [hederaGateOption()]);

    paymentMiddleware(
      fastify,
      {
        'POST /v1/gate/decisions': {
          accepts: accepts as never,
          description: 'Proctor human oversight decision',
          mimeType: 'application/json',
        },
      } as never,
      x402Server,
    );

    // Start workers
    startErrorLogCleanupWorker();
    startTtlSweeper();

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
