/**
 * Agent-facing gate routes.
 *
 * WHY THERE ARE TWO ROUTES INSTEAD OF ONE
 * ---------------------------------------
 * The x402 hook runs at onRequest, BEFORE Fastify parses the body, so
 * ctx.adapter.getBody() returns undefined when the 402 is built. Verified.
 * A policy decision needs the action, so the policy cannot run inside the
 * paid route's pricing callback.
 *
 * Therefore:
 *   POST /v1/gate/evaluate    FREE. Runs the policy. Answers "proceed" or
 *                             "escalation required". This is the common path
 *                             and it costs the agent nothing.
 *   POST /v1/gate/decisions   PAID. Static price. Opens a decision.
 *
 * This is also a better product story than charging an agent to be told no.
 */
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { evaluatePolicy, DEMO_POLICY, type AgentAction } from '../lib/policy/evaluate.ts';
import { prismaQuery } from '../lib/prisma.ts';
import type { Prisma } from '../../prisma/generated/client.js';
import { decisionHash, policyHash } from '../lib/attestation/hash.ts';
import { mintWitnessToken, mintNonce, dispatchDecision, recordEvent } from '../lib/decision/lifecycle.ts';
import { selectWitness, dispatchToWitness } from '../lib/witness/dispatch.ts';
import { toTaskView } from '../lib/a2a/taskState.ts';
import { handleError } from '../utils/errorHandler.ts';
import { validateRequiredFields } from '../utils/validationUtils.ts';
import { GATE_PRICE_USD, DECISION_TTL_SECONDS } from '../config/main-config.ts';

export const gateRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * FREE. The policy decision.
   * Most agent actions land here, get `escalate: false`, and proceed without
   * ever touching a paywall.
   */
  app.post('/evaluate', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    const valid = await validateRequiredFields(body, ['action'], reply);
    if (valid !== true) return;

    const action = body.action as AgentAction;
    if (!action?.kind || !action?.amount || !action?.counterparty) {
      return handleError(reply, 400, 'action requires kind, amount, counterparty', 'INVALID_ACTION');
    }

    const decision = evaluatePolicy(action, DEMO_POLICY);

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        escalate: decision.escalate,
        reason: decision.reason,
        humanLine: decision.humanLine,
        // Only present when escalation is required, so the agent knows the cost
        // before it commits to paying.
        quote: decision.escalate
          ? {
              priceUsd: GATE_PRICE_USD,
              ttlSeconds: DECISION_TTL_SECONDS,
              endpoint: 'POST /v1/gate/decisions',
            }
          : null,
      },
    });
  });

  /**
   * PAID via x402. paymentMiddleware is registered in index.ts against the
   * full route pattern, so by the time this handler runs the payment has been
   * verified and request.x402Context is populated.
   */
  app.post('/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = (request as FastifyRequest & { x402Context?: Record<string, unknown> }).x402Context;

    // Defence in depth. If the middleware were ever misconfigured, never serve
    // a paid resource for free.
    if (!ctx) return handleError(reply, 402, 'Payment required', 'PAYMENT_REQUIRED');

    const body = request.body as { action?: AgentAction; orgSlug?: string };
    const action = body.action;
    if (!action?.kind || !action?.amount || !action?.counterparty) {
      return handleError(reply, 400, 'action requires kind, amount, counterparty', 'INVALID_ACTION');
    }

    const org = await prismaQuery.org.findFirst({
      where: body.orgSlug ? { slug: body.orgSlug } : {},
      orderBy: { createdAt: 'asc' },
    });
    if (!org) return handleError(reply, 404, 'No organisation configured', 'ORG_NOT_FOUND');

    // The attestation commits to the operator nullifier, so a decision cannot
    // be opened for an org that never enrolled one. Refusing here beats
    // producing evidence that cannot state who the operator was.
    if (!org.operatorEnrolledAt || org.operatorNullifier === null) {
      return handleError(reply, 409, 'Operator not enrolled for this organisation', 'OPERATOR_NOT_ENROLLED');
    }

    const agent = await prismaQuery.agent.findFirst({ where: { orgId: org.id, revokedAt: null } });
    if (!agent) return handleError(reply, 404, 'No agent registered', 'AGENT_NOT_FOUND');

    const decisionPolicy = evaluatePolicy(action, DEMO_POLICY);
    const nonce = mintNonce();
    const { token, hash } = mintWitnessToken();

    // The preimage is what the witness attests to, and what a third party
    // re-hashes from the export. The nonce makes two identical actions distinct.
    const preimage = {
      action,
      nonce,
      orgSlug: org.slug,
      agentUaid: agent.uaid,
      issuedAt: new Date().toISOString(),
    };

    const decision = await prismaQuery.decision.create({
      data: {
        orgId: org.id,
        agentId: agent.id,
        state: 'OPEN',
        // Prisma's InputJsonValue needs an index signature; our typed shapes
        // do not have one. The value is plain JSON either way.
        preimage: preimage as unknown as Prisma.InputJsonObject,
        decisionHash: decisionHash(preimage),
        humanLine: decisionPolicy.humanLine,
        nonce,
        requiredRole: 'standard',
        policyReason: decisionPolicy.reason,
        policyHash: policyHash(DEMO_POLICY),
        witnessTokenHash: hash,
        // Overwritten by dispatchDecision, which sets the authoritative clock.
        expiresAt: new Date(Date.now() + DECISION_TTL_SECONDS * 1000),
      },
    });

    const payer = (ctx.paymentPayload as { payer?: string } | undefined)?.payer ?? null;
    await recordEvent(decision.id, 'gate.paid', { payer });

    // Select from the rota and dispatch.
    const witness = await selectWitness(org.id, decision.requiredRole);
    if (!witness) {
      await recordEvent(decision.id, 'dispatch.no_witness_available');
      return handleError(reply, 503, 'No witness available', 'NO_WITNESS_AVAILABLE');
    }

    const dispatched = await dispatchDecision(decision.id, witness.id, DECISION_TTL_SECONDS);
    if (!dispatched.ok) return handleError(reply, 409, 'Could not dispatch', 'DISPATCH_FAILED');

    const fresh = await prismaQuery.decision.findUniqueOrThrow({ where: { id: decision.id } });
    const push = await dispatchToWitness(witness, token, decision.humanLine, fresh.expiresAt);
    await recordEvent(decision.id, push.delivered ? 'dispatch.push_accepted' : 'dispatch.push_failed', {
      acceptedMs: push.acceptedMs, reason: push.reason,
    });

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        decisionId: decision.id,
        state: 'DISPATCHED',
        humanLine: decision.humanLine,
        /** The World signal. Also what a third party re-derives from the preimage. */
        decisionHash: decision.decisionHash,
        expiresAt: fresh.expiresAt.toISOString(),
        serverNow: new Date().toISOString(),
        ttlSeconds: DECISION_TTL_SECONDS,
        payer,
        push: { delivered: push.delivered, acceptedMs: push.acceptedMs, reason: push.reason ?? null },
        a2a: toTaskView(decision.id, 'DISPATCHED', decision.humanLine),
      },
    });
  });

  done();
};
