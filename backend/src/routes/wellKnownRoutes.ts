/**
 * Public discovery documents. No auth.
 *
 * RFC 8615 reserves /.well-known/ for exactly this: machine-discoverable
 * metadata at a stable, predictable path.
 */
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { attestorAccount, eip712Domain } from '../lib/attestation/build.ts';
import { proctorGateUaid, PROCTOR_SKILLS } from '../lib/attestation/uaid.ts';
import { ERC8004 } from '../lib/arc/chain.ts';
import {
  HEDERA_TOPIC_ID, MIRROR_NODE_URL, HEDERA_NETWORK,
  WORLD_RP_ID, WORLD_ACTION, WORLD_VERIFY_URL, WORLD_MODE,
  GATE_PRICE_USD, METER_RATE_USD_PER_SEC, DECISION_TTL_SECONDS,
  PAY_TO_HEDERA, ARC_AGENT_ID, ARC_CHAIN_ID, PUBLIC_BASE_URL,
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
      // HCS-14 is a DRAFT standard. We generate the identifier per the draft
      // spec deterministically; we do not claim "compliance", which is not ours
      // to assert while the standard is in draft.
      // Two canonical identifiers, one per chain, rather than picking a winner.
      agentIdentity: {
        hcs14: {
          standard: 'HCS-14 (draft)',
          uaid: PAY_TO_HEDERA ? proctorGateUaid(PAY_TO_HEDERA, HEDERA_NETWORK) : null,
        },
        erc8004: ARC_AGENT_ID
          ? { chainId: ARC_CHAIN_ID, registry: ERC8004.identity, agentId: ARC_AGENT_ID,
              explorer: `https://testnet.arcscan.app/token/${ERC8004.identity}/instance/${ARC_AGENT_ID}` }
          : null,
      },
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
      /**
       * A2A v1.0 replaced the top-level `url` and `preferredTransport` with an
       * ordered array of interface OBJECTS, first entry preferred. Publishing
       * bare strings here is a spec violation, and worse, it leaves the card
       * with no URL at all: another agent could read what we do and still have
       * nowhere to send a request.
       */
      supportedInterfaces: [
        {
          url: `${PUBLIC_BASE_URL}/v1/gate/decisions`,
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        },
        {
          url: `${PUBLIC_BASE_URL}/a2a`,
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
          // Named explicitly. Advertising the binding while leaving a client to
          // discover by trial which methods exist is the same failure as
          // publishing no URL at all.
          methods: ['a2a.GetTask'],
        },
      ],
      /**
       * Per the A2A spec these describe METHODS we serve, not features we have.
       *
       * pushNotifications=false: it means the Create/Get/List/Delete
       * TaskPushNotificationConfig methods, which we do not serve. We DO send
       * web push to the witness's phone and SSE to the caller, but neither is
       * the thing this flag claims.
       *
       * streaming=false: means SendStreamingMessage / SubscribeToTask over
       * JSON-RPC. Our SSE stream is at GET /v1/gate/decisions/:id/stream.
       *
       * stateTransitionHistory=true: a2a.GetTask returns Task.history from the
       * append-only decision event trail.
       */
      capabilities: { pushNotifications: false, streaming: false, stateTransitionHistory: true },
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
      skills: [
        {
          id: 'human-oversight-gate',
          skillId: PROCTOR_SKILLS.HUMAN_OVERSIGHT_GATE,
          name: 'Human oversight gate',
          description:
            'Escalate a high-risk agent action to a live, verified human witness who is cryptographically distinct from the operator, and return an attested decision.',
          tags: ['oversight', 'compliance', 'x402', 'human-in-the-loop'],
        },
      ],
      // Discovery by construction: the 402 already advertises price, asset,
      // network and facilitator in machine-readable form.
      payment: { protocol: 'x402', version: 2, discovery: 'POST /v1/gate/decisions returns a payment-required header' },
      // The gate is an A2A task that spends its life in an interrupted state.
      taskModel: {
        protocol: 'A2A',
        interruptedState: 'TASK_STATE_AUTH_REQUIRED',
        note: 'A submitted task enters TASK_STATE_AUTH_REQUIRED while a human witness is required, then resolves to TASK_STATE_COMPLETED on approval or TASK_STATE_REJECTED on refusal or deadline.',
      },
      agentIdentity: {
        hcs14: PAY_TO_HEDERA ? proctorGateUaid(PAY_TO_HEDERA, HEDERA_NETWORK) : null,
        erc8004: ARC_AGENT_ID ? `eip155:${ARC_CHAIN_ID}:${ERC8004.identity}/${ARC_AGENT_ID}` : null,
      },
    });
  });

  done();
};
