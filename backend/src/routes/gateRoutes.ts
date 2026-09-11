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
import { issueDecision } from '../lib/decision/issue.ts';
import { selectWitness, dispatchToWitness } from '../lib/witness/dispatch.ts';
import { toTaskView } from '../lib/a2a/taskState.ts';
import { extractPayer } from '../lib/x402/payer.ts';
import { formatSse, sseKeepalive, SSE_HEADERS, accruedUsd, type DecisionFrame } from '../lib/sse/stream.ts';
import { meterUsd, meterTinybar } from '../lib/x402/meter.ts';
import { handleError } from '../utils/errorHandler.ts';
import { validateRequiredFields } from '../utils/validationUtils.ts';
import { GATE_PRICE_USD, DECISION_TTL_SECONDS, METER_RATE_USD_PER_SEC, PAY_TO_HEDERA } from '../config/main-config.ts';

export const gateRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * FREE. The policy decision.
   * Most agent actions land here, get `escalate: false`, and proceed without
   * ever touching a paywall.
   */
  app.post('/evaluate', {
    schema: {
      tags: ['gate'],
      summary: 'Evaluate an action against policy. Free.',
      description:
        'The common path. Most agent actions return `escalate: false` and proceed without touching a paywall. ' +
        'Charging an agent to be told "no" would be a worse product.\n\n' +
        'This route exists because the x402 hook runs at `onRequest`, before Fastify parses the body, so a ' +
        'policy decision cannot be made inside the paid route\'s pricing callback.',
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'object',
            required: ['kind', 'amount', 'counterparty'],
            properties: {
              kind: { type: 'string', enum: ['transfer', 'contract_call', 'data_export', 'custom'] },
              asset: { type: 'string', examples: ['EUR'] },
              amount: { type: 'string', description: 'Decimal string. Never a float.', examples: ['41200.00'] },
              counterparty: { type: 'string', examples: ['Hedera Testnet Treasury'] },
            },
          },
        },
      },
      response: {
        200: {
          description: 'Policy decision.',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'null' },
            data: {
              type: 'object',
              properties: {
                escalate: { type: 'boolean' },
                reason: { type: 'string', enum: ['below_threshold','amount_threshold','action_kind','denylisted','allowlisted'] },
                humanLine: { type: 'string', description: 'The single line rendered on the witness phone.' },
                quote: {
                  type: ['object', 'null'],
                  description: 'Present only when escalation is required, so the agent knows the cost before committing.',
                  properties: {
                    priceUsd: { type: 'string' },
                    ttlSeconds: { type: 'number' },
                    endpoint: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.post('/decisions', {
    schema: {
      tags: ['gate'],
      summary: 'Open an oversight decision. PAID via x402.',
      description:
        'Creates a decision, selects a witness from the rota, dispatches a push, and starts the ' +
        'server-authoritative deadline.\n\n' +
        '**An unpaid request returns 402 with the requirements in the base64 `payment-required` response ' +
        'header. The body is `{}`.** Reading the body gets you an empty object.\n\n' +
        'Settled through the Blocky402 facilitator; `extra.feePayer` in the challenge identifies it.',
      security: [{ x402: [] }],
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'object', description: 'Same shape as /evaluate.' },
          orgSlug: { type: 'string', description: 'Defaults to the first configured org.' },
        },
      },
      response: {
        200: {
          description: 'Decision opened and dispatched.',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                decisionId: { type: 'string' },
                state: { type: 'string', examples: ['DISPATCHED'] },
                humanLine: { type: 'string' },
                decisionHash: { type: 'string', description: 'The World `signal`. A third party re-derives this from the preimage.' },
                expiresAt: { type: 'string', format: 'date-time' },
                serverNow: { type: 'string', format: 'date-time', description: 'Render countdowns against OUR clock, never the device clock.' },
                ttlSeconds: { type: 'number' },
                payer: { type: ['string', 'null'] },
              },
            },
          },
        },
        402: { description: 'Payment required. Requirements are in the `payment-required` header, not this body.', type: 'object', additionalProperties: true },
        409: { description: 'Operator not enrolled for this organisation.', type: 'object', additionalProperties: true },
        503: { description: 'No witness available in the rota.', type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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

    // Issued, not merely created: the transaction also hands out the dense
    // per-org number that makes a withheld record visible later.
    const decision = await issueDecision(org.id, {
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
    });

    const payer = extractPayer(ctx.paymentPayload);
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


  /**
   * Hold the agent's terminal open while a human decides.
   *
   * This is the on-camera wait. The meter frame is what makes it legible: a
   * counter charging per second of real human attention, next to a countdown.
   *
   * The meter is DERIVED from elapsed time, not a payment. Settlement happens
   * once, on release.
   */
  app.get('/decisions/:id/stream', {
    schema: {
      tags: ['gate'],
      summary: 'Hold the agent open while a human decides. Server-Sent Events.',
      description:
        'Emits at 4Hz: a `meter` frame carrying `remainingMs` and `accruedUsd`, then a `resolved` frame.\n\n' +
        'This is the on-camera wait. Nine of the fifteen seconds are a face match on a phone, and that only ' +
        'reads as dead air if the terminal is idle.\n\n' +
        'Wire format is WHATWG SSE: `text/event-stream`, events dispatched by a blank line.',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: {
        200: { description: 'text/event-stream. Frames: state, meter, resolved.', type: 'string' },
        404: { description: 'Decision not found.', type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const decision = await prismaQuery.decision.findUnique({
      where: { id },
      select: { id: true, state: true, outcome: true, dispatchedAt: true, expiresAt: true, reviewMs: true },
    });
    if (!decision) return handleError(reply, 404, 'Decision not found', 'DECISION_NOT_FOUND');

    // writeHead() bypasses Fastify's reply lifecycle, so @fastify/cors's
    // onSend hook never runs on this route. Reflect Origin manually, same
    // as the cors plugin's `origin: true` policy does for every other route.
    const origin = request.headers.origin;
    const corsHeaders = origin
      ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-credentials': 'true' }
      : {};
    reply.raw.writeHead(200, { ...SSE_HEADERS, ...corsHeaders });

    const send = (frame: DecisionFrame, event?: string) => {
      reply.raw.write(formatSse({ event, data: frame, id: String(Date.now()) }));
    };

    // Tell the client how long to wait before reconnecting, per the spec.
    reply.raw.write(formatSse({ retry: 2000, event: 'open', data: { decisionId: id } }));
    send({ type: 'state', state: decision.state, at: new Date().toISOString() });

    let closed = false;
    const stop = () => { closed = true; clearInterval(timer); };
    request.raw.on('close', stop);

    const timer = setInterval(async () => {
      if (closed) return;
      try {
        const now = Date.now();
        const d = await prismaQuery.decision.findUnique({
          where: { id },
          select: { state: true, outcome: true, dispatchedAt: true, expiresAt: true, reviewMs: true },
        });
        if (!d) return stop();

        if (d.state === 'DISPATCHED') {
          const elapsed = d.dispatchedAt ? now - d.dispatchedAt.getTime() : 0;
          send({
            type: 'meter',
            elapsedMs: elapsed,
            remainingMs: Math.max(0, d.expiresAt.getTime() - now),
            accruedUsd: accruedUsd(elapsed, METER_RATE_USD_PER_SEC),
          });
          return;
        }

        if (d.outcome) {
          send({ type: 'resolved', outcome: d.outcome, reviewMs: d.reviewMs ?? 0 }, 'resolved');
          reply.raw.end();
          return stop();
        }

        send({ type: 'state', state: d.state, at: new Date().toISOString() });
      } catch {
        reply.raw.write(sseKeepalive('error'));
      }
    }, 250);   // 4Hz: the counter must look alive on camera

    // Never return the reply object: Fastify would try to send a second response.
    return reply;
  });


  /**
   * Call 2 of the gate protocol. PAID, priced from real review seconds.
   *
   * Call 1 charges a fixed fee to interrupt a machine. This charges for the
   * human attention actually consumed, which is why the price is dynamic.
   *
   * The decision id is in the PATH because the x402 hook runs before Fastify
   * parses a body, so a body-carried id would silently price every release at
   * zero.
   */
  app.post('/decisions/:id/release', {
    schema: {
      tags: ['gate'],
      summary: 'Collect the outcome. PAID, priced per second of review.',
      description:
        'Returns the outcome and the evidence record. The price is computed from the ' +
        'seconds a human actually spent, not a flat charge.\n\n' +
        'An EXPIRE meters to **zero** and is served free: the agent paid to interrupt a ' +
        'machine and consumed no attention. x402 cannot quote a zero amount, so that ' +
        'case bypasses the paywall rather than quoting a floor.',
      security: [{ x402: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: {
        200: { description: 'Outcome and evidence.', type: 'object', additionalProperties: true },
        402: { description: 'Payment required. Requirements ride in the `payment-required` header.', type: 'object', additionalProperties: true },
        409: { description: 'Decision is not resolved yet.', type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const decision = await prismaQuery.decision.findUnique({
      where: { id },
      include: { attestation: true, proof: true },
    });
    if (!decision) return handleError(reply, 404, 'Decision not found', 'DECISION_NOT_FOUND');
    if (!decision.outcome) return handleError(reply, 409, 'Decision not resolved', 'DECISION_UNRESOLVED');

    const ctx = (request as FastifyRequest & { x402Context?: Record<string, unknown> }).x402Context;
    const reviewMs = decision.reviewMs ?? 0;
    const expired = decision.outcome === 'EXPIRE';

    // Bind the meter payer to the gate payer. Nothing in x402 links the two
    // calls, so without this one agent could open a decision and another collect.
    if (ctx) {
      const payer = extractPayer(ctx.paymentPayload) ?? undefined;
      const gate = await prismaQuery.payment.findFirst({
        where: { decisionId: id, leg: 'GATE' }, select: { payer: true },
      });
      if (gate?.payer && payer && gate.payer !== payer) {
        return handleError(reply, 403, 'Meter payer differs from gate payer', 'PAYER_MISMATCH');
      }
      await prismaQuery.payment.upsert({
        where: { decisionId_leg: { decisionId: id, leg: 'METER' } },
        update: { state: 'SETTLED', settledAt: new Date(), payer: payer ?? null },
        create: {
          decisionId: id, leg: 'METER', rail: 'HEDERA_X402_EXACT', state: 'SETTLED',
          amountUsd: meterUsd(reviewMs, decision.outcome as never),
          amountAtomic: meterTinybar(reviewMs, decision.outcome as never).toString(),
          asset: '0.0.0', network: 'hedera:testnet', payTo: PAY_TO_HEDERA,
          payer: payer ?? null, settledAt: new Date(),
        },
      }).catch(() => { /* replay of an already-settled meter */ });
      await recordEvent(id, 'meter.settled', { payer, reviewMs });
    }

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        outcome: decision.outcome,
        reviewMs,
        // An expiry consumed no human attention, so it owes nothing for attention.
        meter: expired
          ? { billedUsd: '0.000000', reason: 'expired: no human attention consumed' }
          : { billedUsd: meterUsd(reviewMs, decision.outcome as never),
              billedTinybar: meterTinybar(reviewMs, decision.outcome as never).toString() },
        attestation: decision.attestation
          ? {
              sequenceNumber: decision.attestation.sequenceNumber?.toString() ?? null,
              consensusTimestamp: decision.attestation.consensusTimestamp,
              runningHash: decision.attestation.runningHash,
              explorerUrl: decision.attestation.explorerUrl,
              body: decision.attestation.body,
              attestorSig: decision.attestation.attestorSig,
            }
          : null,
        released: decision.outcome === 'APPROVE',
      },
    });
  });

  done();
};
