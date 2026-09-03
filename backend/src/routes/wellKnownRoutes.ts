/**
 * Public discovery documents. No auth.
 *
 * RFC 8615 reserves /.well-known/ for exactly this: machine-discoverable
 * metadata at a stable, predictable path.
 */
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { attestorAccount, eip712Domain } from '../lib/attestation/build.ts';
import {
  HEDERA_TOPIC_ID, MIRROR_NODE_URL, HEDERA_NETWORK,
  WORLD_RP_ID, WORLD_ACTION, WORLD_VERIFY_URL, WORLD_MODE,
  GATE_PRICE_USD, METER_RATE_USD_PER_SEC, DECISION_TTL_SECONDS,
} from '../config/main-config.ts';

export const wellKnownRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * The trust roots an offline verifier needs.
   *
   * HONEST WEAKNESS, stated rather than hidden: we can edit a JSON file on our
   * own host. The same roots are published as an HCS message, and THAT copy is
   * authoritative, because a past consensus record cannot be rewritten. A
   * verifier that trusts this endpoint alone is trusting us; one that checks
   * the topic is not.
   */
  app.get('/proctor.json', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      v: 1,
      attestor: { address: attestorAccount().address, eip712Domain: eip712Domain() },
      hcs: {
        topicId: HEDERA_TOPIC_ID || null,
        mirrorNodeBaseUrl: MIRROR_NODE_URL,
        network: `hedera:${HEDERA_NETWORK}`,
        note: 'This topic has no admin key. It cannot be edited or deleted by anyone, including Proctor.',
      },
      world: { rpId: WORLD_RP_ID, action: WORLD_ACTION, verifyUrl: WORLD_VERIFY_URL, mode: WORLD_MODE },
      policy: { gatePriceUsd: GATE_PRICE_USD, meterRateUsdPerSecond: METER_RATE_USD_PER_SEC, ttlSeconds: DECISION_TTL_SECONDS },
      canonicalization: 'RFC 8785 (JSON Canonicalization Scheme)',
      caveat: 'The authoritative copy of these roots is published on the HCS topic above. This file is a convenience.',
    });
  });

  /**
   * A2A agent card. Proctor's control flow IS an A2A task: an agent submits,
   * the task enters an interrupted state while a human is required, then
   * resolves. That is precisely what TASK_STATE_AUTH_REQUIRED exists for.
   */
  app.get('/agent-card.json', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      name: 'Proctor',
      description:
        'A human oversight gate for AI agents. An agent is stopped by an HTTP 402, pays to open a decision, and a verified human who is not the operator approves or refuses within a fixed deadline. The output is a tamper-evident evidence record.',
      version: '1.0.0',
      supportedInterfaces: ['http+json'],
      capabilities: { pushNotifications: true, streaming: false, stateTransitionHistory: true },
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
      skills: [
        {
          id: 'human-oversight-gate',
          name: 'Human oversight gate',
          description:
            'Escalate a high-risk agent action to a live, verified human witness who is cryptographically distinct from the operator, and return an attested decision.',
          tags: ['oversight', 'compliance', 'x402', 'human-in-the-loop'],
        },
      ],
      // Discovery by construction: the 402 already advertises price, asset,
      // network and facilitator in machine-readable form.
      payment: { protocol: 'x402', version: 2, discovery: 'POST /v1/gate/decisions returns a payment-required header' },
    });
  });

  done();
};
