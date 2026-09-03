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

    // Defence in depth: if the middleware were ever misconfigured, do not
    // silently serve a paid resource for free.
    if (!ctx) {
      return handleError(reply, 402, 'Payment required', 'PAYMENT_REQUIRED');
    }

    const payload = ctx.paymentPayload as { payer?: string } | undefined;

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        state: 'OPEN',
        payer: payload?.payer ?? null,
        ttlSeconds: DECISION_TTL_SECONDS,
        note: 'decision persistence lands with the Decision model',
      },
    });
  });

  done();
};
