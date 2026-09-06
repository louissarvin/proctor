/**
 * Operator-initiated decisions, for a hosted demo.
 *
 * WHY THIS EXISTS
 * The gate is x402-paywalled, and the witness token is a bearer credential the
 * gate deliberately never returns to the payer — otherwise an agent could
 * approve its own decision, which is the one property this product sells. So
 * there is no way to start a run from a browser, and every demo so far has
 * needed a terminal.
 *
 * WHAT THIS IS NOT
 * Not a free side door into the paid gate. It does not settle a payment and it
 * says so in its own response: `paid: false`. Decisions opened here are real in
 * every other respect -- real policy evaluation, real witness dispatch, real
 * TTL, real evidence -- but an agent is never released by them because no agent
 * is waiting on one.
 *
 * OFF BY DEFAULT. `DEMO_MODE=true` is required. A deployment that forgets to
 * set it gets 404, not an open door.
 */
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';
import { decisionHash, policyHash } from '../lib/attestation/hash.ts';
import { mintWitnessToken, mintNonce, dispatchDecision } from '../lib/decision/lifecycle.ts';
import { selectWitness } from '../lib/witness/dispatch.ts';
import { evaluatePolicy, DEMO_POLICY, type AgentAction } from '../lib/policy/evaluate.ts';
import { issueDecision } from '../lib/decision/issue.ts';
import { DEMO_MODE, WITNESS_APP_URL, DECISION_TTL_SECONDS } from '../config/main-config.ts';

/** One run at a time per caller, and a hard ceiling on open demo decisions. */
const MIN_INTERVAL_MS = 15_000;
const MAX_OPEN = 5;
const lastRun = new Map<string, number>();

export const demoRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.post('/run', {
    schema: {
      tags: ['demo'],
      summary: 'Open a decision from the browser. Requires DEMO_MODE.',
      body: {
        type: 'object',
        properties: {
          amount: { type: 'string' },
          counterparty: { type: 'string' },
          ttlSeconds: { type: 'number' },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!DEMO_MODE) return handleError(reply, 404, 'Not found', 'NOT_FOUND');

    const ip = request.ip;
    const now = Date.now();
    const since = now - (lastRun.get(ip) ?? 0);
    if (since < MIN_INTERVAL_MS) {
      return handleError(reply, 429, `Wait ${Math.ceil((MIN_INTERVAL_MS - since) / 1000)}s`, 'TOO_FAST');
    }

    const open = await prismaQuery.decision.count({ where: { state: 'DISPATCHED' } });
    if (open >= MAX_OPEN) {
      return handleError(reply, 429, 'Too many decisions already awaiting a human', 'TOO_MANY_OPEN');
    }

    const body = (request.body ?? {}) as { amount?: string; counterparty?: string; ttlSeconds?: number };
    // Bounded so a caller cannot park a decision open for a day.
    const ttl = Math.min(Math.max(Number(body.ttlSeconds) || DECISION_TTL_SECONDS, 30), 900);

    const org = await prismaQuery.org.findFirst({ where: { slug: 'demo-org' } });
    const agent = org ? await prismaQuery.agent.findFirst({ where: { orgId: org.id, revokedAt: null } }) : null;
    if (!org || !agent) return handleError(reply, 503, 'Demo org not seeded', 'NOT_SEEDED');

    const action: AgentAction = {
      kind: 'transfer',
      asset: 'EUR',
      amount: (body.amount ?? '41200.00').slice(0, 20),
      counterparty: (body.counterparty ?? 'Meridian Logistics').slice(0, 60),
    };

    // The free call first. Most actions stop here and never reach a human.
    const policy = evaluatePolicy(action, DEMO_POLICY);
    if (!policy.escalate) {
      lastRun.set(ip, now);
      return reply.code(200).send({
        success: true, error: null,
        data: { escalated: false, reason: policy.reason, humanLine: null },
      });
    }

    const nonce = mintNonce();
    const { token, hash } = mintWitnessToken();
    const preimage = {
      action, nonce, orgSlug: org.slug, agentUaid: agent.uaid,
      issuedAt: new Date().toISOString(),
    };
    const decision = await issueDecision(org.id, {
      agentId: agent.id, state: 'OPEN',
      preimage: preimage as never,
      decisionHash: decisionHash(preimage),
      humanLine: policy.humanLine,
      nonce, witnessTokenHash: hash, policyHash: policyHash(DEMO_POLICY),
      expiresAt: new Date(Date.now() + ttl * 1000),
    });

    const witness = await selectWitness(org.id, 'standard');
    if (!witness) return handleError(reply, 503, 'No witness enrolled', 'NO_WITNESS');
    await dispatchDecision(decision.id, witness.id, ttl);
    lastRun.set(ip, now);

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        escalated: true,
        decisionId: decision.id,
        humanLine: policy.humanLine,
        policyReason: policy.reason,
        decisionHash: decision.decisionHash,
        ttlSeconds: ttl,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        serverNow: new Date().toISOString(),
        // The operator screen. Shown so a witness can scan it, which is the
        // same path `bun run open` prints.
        handoffUrl: `${WITNESS_APP_URL}/handoff/${token}`,
        witnessUrl: `${WITNESS_APP_URL}/w/${token}`,
        // Stated in the payload, not just the docs: nothing was settled.
        paid: false,
        note: 'Operator-initiated demo decision. No x402 payment was settled. A paying agent uses POST /v1/gate/decisions.',
      },
    });
  });

  done();
};
