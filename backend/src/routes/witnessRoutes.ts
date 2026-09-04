/**
 * Witness-facing routes. This is the phone.
 *
 * Three routes, and the shape of each is deliberate:
 *   GET  /decisions/:token   what the witness is being asked, plus OUR clock
 *   POST /rp-signature       World ID 4.0 requires a backend RP signature
 *   POST /decisions/:token/respond   the one route that decides everything
 */
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';
import { requireWitnessToken } from '../middlewares/witnessTokenMiddleware.ts';
import { mintRpSignature } from '../lib/world/rp.ts';
import { verifyWitnessProof, parseNullifier, hasStableNullifier } from '../lib/world/verify.ts';
import { approveDecision, refuseDecision, recordEvent } from '../lib/decision/lifecycle.ts';
import { toTaskView } from '../lib/a2a/taskState.ts';
import {
  WORLD_ACTION, WORLD_RP_ID, WORLD_ENVIRONMENT, WORLD_MODE, WORLD_VERIFY_URL,
} from '../config/main-config.ts';

import type { WitnessMode } from '../lib/world/verify.ts';

const modeToWitnessMode = (m: string): WitnessMode => (m === 'SELFIE' ? 'SELFIE' : 'DEVICE_DEV_ONLY');

export const witnessRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * What the witness is being asked.
   *
   * `serverNow` is returned so the phone renders its countdown as an offset
   * from OUR clock. A witness with a skewed device must not be able to approve
   * at second 71.
   */
  app.get('/decisions/:token', { preHandler: [requireWitnessToken] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const decision = await prismaQuery.decision.findUniqueOrThrow({
      where: { id: request.witnessDecisionId! },
      select: {
        id: true, humanLine: true, decisionHash: true, preimage: true,
        expiresAt: true, requiredRole: true, state: true,
      },
    });

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        decisionId: decision.id,
        humanLine: decision.humanLine,
        /** The World `signal`. Binds the liveness proof to THIS decision. */
        signal: decision.decisionHash,
        /** Full record, so a suspicious witness can expand the one line. */
        preimage: decision.preimage,
        expiresAt: decision.expiresAt.toISOString(),
        serverNow: new Date().toISOString(),
        requiredRole: decision.requiredRole,
        world: {
          action: WORLD_ACTION,
          rpId: WORLD_RP_ID,
          environment: WORLD_ENVIRONMENT,
          mode: WORLD_MODE,
        },
        a2a: toTaskView(decision.id, decision.state as never, decision.humanLine),
      },
    });
  });

  /**
   * Mint an RP signature. World ID 4.0 made this mandatory before the widget
   * can open; it did not exist in v3.
   *
   * Minted per decision on arrival, NOT on page load: the default TTL is 300s
   * and a stale signature yields `rp_signature_expired` on a phone that took a
   * while to reach.
   */
  app.post('/rp-signature', { preHandler: [requireWitnessToken] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const decisionId = request.witnessDecisionId!;
    try {
      const sig = mintRpSignature();
      await prismaQuery.rpNonce.create({
        data: {
          nonce: sig.nonce,
          action: WORLD_ACTION,
          decisionId,
          expiresAt: new Date(sig.expires_at * 1000),
        },
      });
      await recordEvent(decisionId, 'world.rp_signature.minted');
      return reply.code(200).send({ success: true, error: null, data: sig });
    } catch (error) {
      return handleError(reply, 500, 'Could not mint RP signature', 'RP_SIGNATURE_FAILED', error as Error);
    }
  });

  /**
   * The one route that decides everything.
   *
   * A REFUSAL REQUIRES NO PROOF. Refuse is the default outcome, so making a
   * human prove liveness to press a stop button would put a failure mode
   * between a person and a brake pedal.
   */
  app.post('/decisions/:token/respond', { preHandler: [requireWitnessToken] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const decisionId = request.witnessDecisionId!;
    const body = request.body as { choice?: 'APPROVE' | 'REFUSE'; idkitResult?: unknown };

    if (body.choice !== 'APPROVE' && body.choice !== 'REFUSE') {
      return handleError(reply, 400, 'choice must be APPROVE or REFUSE', 'INVALID_CHOICE');
    }

    // ---- refusal: no proof required -------------------------------------
    if (body.choice === 'REFUSE') {
      const r = await refuseDecision(decisionId);
      if (!r.ok) return handleError(reply, 409, 'Decision already resolved', 'ALREADY_RESOLVED');
      return reply.code(200).send({
        success: true, error: null,
        data: { outcome: 'REFUSE', reviewMs: r.reviewMs, witnessAuth: 'token' },
      });
    }

    // ---- approval: everything must check out ----------------------------
    if (!body.idkitResult) {
      return handleError(reply, 400, 'An approval requires a World ID proof', 'PROOF_REQUIRED');
    }

    const decision = await prismaQuery.decision.findUniqueOrThrow({
      where: { id: decisionId },
      select: { decisionHash: true, expiresAt: true, orgId: true, witnessId: true },
    });
    const org = await prismaQuery.org.findUniqueOrThrow({
      where: { id: decision.orgId },
      select: { operatorNullifier: true },
    });

    // The RP nonce must exist, be unused, and be unexpired.
    const raw = body.idkitResult as { nonce?: string };
    const nonceRow = raw.nonce
      ? await prismaQuery.rpNonce.findUnique({ where: { nonce: raw.nonce } })
      : null;
    const nonceValid = Boolean(nonceRow && !nonceRow.usedAt && nonceRow.expiresAt > new Date());

    const result = verifyWitnessProof({
      raw: body.idkitResult as never,
      decision: { decisionHash: decision.decisionHash, expiresAt: decision.expiresAt },
      operatorNullifier: org.operatorNullifier ? BigInt(org.operatorNullifier.toFixed(0)) : null,
      mode: modeToWitnessMode(WORLD_MODE),
      nonceValid,
    });

    if (!result.ok) {
      await recordEvent(decisionId, `world.verify.${result.reason}`);
      const status = result.reason === 'witness_is_operator' ? 403
        : result.reason === 'decision_expired' ? 410 : 400;
      return handleError(reply, status, `Proof rejected: ${result.reason}`, result.reason.toUpperCase());
    }

    // Verify against World itself. The payload is forwarded UNTOUCHED: the
    // export republishes these exact bytes so a third party can re-verify
    // against World rather than against us.
    try {
      const worldRes = await fetch(`${WORLD_VERIFY_URL}/api/v4/verify/${WORLD_RP_ID}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body.idkitResult),
      });
      if (!worldRes.ok) {
        await recordEvent(decisionId, 'world.verify.rejected', { status: worldRes.status });
        return handleError(reply, 400, 'World rejected the proof', 'VERIFICATION_FAILED');
      }
    } catch (error) {
      await recordEvent(decisionId, 'world.verify.unreachable');
      return handleError(reply, 502, 'World verifier unreachable', 'VERIFIER_UNREACHABLE', error as Error);
    }

    if (nonceRow) {
      await prismaQuery.rpNonce.update({ where: { nonce: nonceRow.nonce }, data: { usedAt: new Date() } });
    }

    const approved = await approveDecision(decisionId);
    if (!approved.ok) return handleError(reply, 409, 'Decision already resolved', 'ALREADY_RESOLVED');

    // Persist the proof AFTER the transition wins, so a losing race never
    // writes a proof for a decision it did not resolve.
    if (decision.witnessId) {
      await prismaQuery.worldProof.create({
        data: {
          decisionId,
          witnessId: decision.witnessId,
          raw: body.idkitResult as never,
          rawDigest: '',
          signalHash: (body.idkitResult as { responses: { signal_hash: string }[] }).responses[0]!.signal_hash,
          identifier: result.identifier,
          protocolVersion: (body.idkitResult as { protocol_version: string }).protocol_version,
          nullifier: result.nullifier.toString(),
          mode: modeToWitnessMode(WORLD_MODE),
        },
      }).catch((e) => console.error('[witness] proof persist failed', e));

      await prismaQuery.witness.update({
        where: { id: decision.witnessId },
        data: { lastVerifiedAt: new Date() },
      }).catch(() => {});
    }

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        outcome: 'APPROVE',
        reviewMs: approved.reviewMs,
        witnessAuth: 'proof',
        independence: hasStableNullifier(modeToWitnessMode(WORLD_MODE)) ? 'crypto' : 'policy',
      },
    });
  });

  done();
};
