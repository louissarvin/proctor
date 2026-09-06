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
import { worldProofDigest } from '../lib/attestation/hash.ts';
import { canonical } from '../lib/attestation/canonical.ts';
import { attestDecision } from '../lib/attestation/persist.ts';
import { payWitness } from '../lib/payout/witness.ts';
import {
  WORLD_ACTION, WORLD_RP_ID, WORLD_ENVIRONMENT, WORLD_MODE, WORLD_VERIFY_URL,
  WORLD_REQUIRE_PRESENCE,
} from '../config/main-config.ts';

import type { WitnessMode } from '../lib/world/verify.ts';

const modeToWitnessMode = (m: string): WitnessMode =>
  m === 'SELFIE' ? 'SELFIE' : m === 'ORB' ? 'ORB_PRESENCE' : 'DEVICE_DEV_ONLY';

export const witnessRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * What the witness is being asked.
   *
   * `serverNow` is returned so the phone renders its countdown as an offset
   * from OUR clock. A witness with a skewed device must not be able to approve
   * at second 71.
   */
  /**
   * Why an oversight attempt failed on the phone.
   *
   * IDKit defines 26 error codes (`credential_unavailable`, `unknown_rp`,
   * `invalid_rp_signature`, `rp_signature_expired`, ...) and the widget shows
   * the witness a single "Something went wrong". None of them reach the RP,
   * so the operator cannot tell a misconfigured app from a witness who simply
   * declined. Recording it makes the failure diagnosable, and it belongs in
   * the trail: an oversight step that could not run is itself a finding.
   *
   * Records only. It cannot resolve a decision, so a hostile caller with a
   * valid token gains nothing beyond writing an event they could already cause.
   */
  app.post('/decisions/:token/client-error', {
    preHandler: [requireWitnessToken],
    schema: { tags: ['witness'], summary: 'Record why the World widget failed.' },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const decisionId = request.witnessDecisionId as string;
    const body = request.body as { code?: unknown; detail?: unknown };
    const code = typeof body.code === 'string' ? body.code.slice(0, 120) : 'unknown';
    const detail = typeof body.detail === 'string' ? body.detail.slice(0, 500) : undefined;
    await recordEvent(decisionId, 'world.client_error', { code, detail });
    console.warn(`[witness] World widget failed on the phone: ${code}${detail ? ` - ${detail}` : ''}`);
    return reply.code(200).send({ success: true, error: null, data: { recorded: code } });
  });

  app.get('/decisions/:token', {
    preHandler: [requireWitnessToken],
    schema: {
      tags: ['witness'],
      summary: 'What the witness is being asked.',
      description:
        'Returns `serverNow` so the phone renders its countdown as an offset from OUR clock. ' +
        'A witness with a skewed device must not be able to approve at second 71.\n\n' +
        'Carries the full preimage so a suspicious witness can expand the one line into the whole record.',
      security: [{ witnessToken: [] }],
      params: { type: 'object', properties: { token: { type: 'string' } } },
      response: {
        200: {
          description: 'The decision.',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                decisionId: { type: 'string' },
                humanLine: { type: 'string' },
                signal: { type: 'string', description: 'The decision hash. Passed to the World ID preset.' },
                preimage: { type: 'object', additionalProperties: true },
                expiresAt: { type: 'string', format: 'date-time' },
                serverNow: { type: 'string', format: 'date-time' },
                requiredRole: { type: 'string' },
                // The PWA cannot configure IDKit without this block. Omitting it
                // from the schema silently strips it from the response.
                world: {
                  type: 'object',
                  properties: {
                    action: { type: 'string' },
                    rpId: { type: 'string' },
                    environment: { type: 'string', enum: ['production', 'staging', 'sandbox'] },
                    mode: { type: 'string', enum: ['DEVICE', 'SELFIE', 'ORB'] },
                    requirePresence: { type: 'boolean' },
                  },
                },
                a2a: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
        404: { description: 'Unknown token. Same response as malformed, so tokens cannot be probed.', type: 'object', additionalProperties: true },
        409: { description: 'Already resolved.', type: 'object', additionalProperties: true },
        410: { description: 'Deadline passed. Fails closed.', type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
          requirePresence: WORLD_REQUIRE_PRESENCE,
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
  app.post('/rp-signature', {
    preHandler: [requireWitnessToken],
    schema: {
      tags: ['witness'],
      summary: 'Mint a World ID RP signature.',
      description:
        'World ID 4.0 made a backend RP signature mandatory before the widget can open; it did not exist ' +
        'in v3.\n\nMinted **per decision on arrival, not on page load**: the TTL is 300s and a stale ' +
        'signature yields `rp_signature_expired` on a phone that took a while to reach. The nonce is ' +
        'persisted single-use.',
      security: [{ witnessToken: [] }],
      body: { type: 'object', required: ['witnessToken'], properties: { witnessToken: { type: 'string' } } },
      response: {
        200: {
          description: 'Signature, valid 300s.',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                sig: { type: 'string' }, nonce: { type: 'string' },
                created_at: { type: 'number', description: 'Unix SECONDS, not milliseconds.' },
                expires_at: { type: 'number' }, rp_id: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.post('/decisions/:token/respond', {
    preHandler: [requireWitnessToken],
    schema: {
      tags: ['witness'],
      summary: 'Approve or refuse. The one route that decides everything.',
      description:
        '**A refusal requires no proof.** Refuse is the default outcome, so making a human prove liveness ' +
        'to press a stop button would put a failure mode between a person and a brake pedal.\n\n' +
        'An approval runs seven assertions before the state is touched, cheapest first. The one that ' +
        'matters is #4: `hashSignal(decisionHash)` is re-derived and compared to the proof\'s `signal_hash`. ' +
        'Without it a valid proof for a **different** decision would be accepted.',
      security: [{ witnessToken: [] }],
      params: { type: 'object', properties: { token: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['choice'],
        properties: {
          choice: { type: 'string', enum: ['APPROVE', 'REFUSE'] },
          idkitResult: { type: 'object', description: 'Required for APPROVE only. Forwarded to World untouched.' },
        },
      },
      response: {
        200: {
          description: 'Resolved.',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                outcome: { type: 'string', enum: ['APPROVE', 'REFUSE'] },
                reviewMs: { type: 'number' },
                witnessAuth: { type: 'string', enum: ['proof', 'token'], description: 'What authenticated the witness. Recorded in the attestation.' },
                independence: { type: 'string', enum: ['crypto', 'policy'] },
              },
            },
          },
        },
        400: { description: 'signal_mismatch, protocol_mismatch, identifier_mismatch, no_liveness, duplicate_nonce.', type: 'object', additionalProperties: true },
        403: { description: 'witness_is_operator. Segregation of duties.', type: 'object', additionalProperties: true },
        410: { description: 'decision_expired. Second 61 is a hard refuse.', type: 'object', additionalProperties: true },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const decisionId = request.witnessDecisionId!;
    const body = request.body as { choice?: 'APPROVE' | 'REFUSE'; idkitResult?: unknown };

    if (body.choice !== 'APPROVE' && body.choice !== 'REFUSE') {
      return handleError(reply, 400, 'choice must be APPROVE or REFUSE', 'INVALID_CHOICE');
    }

    // ---- refusal: no proof required -------------------------------------
    if (body.choice === 'REFUSE') {
      const r = await refuseDecision(decisionId);
      if (!r.ok) return handleError(reply, 409, 'Decision already resolved', 'ALREADY_RESOLVED');

      // A refusal is evidence too, and the outcome an auditor cares about most.
      void attestDecision(decisionId);
      // A refusal is still work. Paying only for approvals would price the
      // witness to say yes, which is the exact incentive this product exists
      // to remove.
      void payWitness(decisionId);

      return reply.code(200).send({
        success: true, error: null,
        // Always 'policy': a refusal carries no proof, so there is no witness
        // nullifier to compare against the operator's. Matches what the
        // attestation records, which callers can re-derive from the topic.
        data: {
          outcome: 'REFUSE', reviewMs: r.reviewMs,
          witnessAuth: 'token', independence: 'policy',
        },
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
    const nonceFailure = !nonceRow ? 'unknown' as const
      : nonceRow.usedAt ? 'used' as const
      : nonceRow.expiresAt <= new Date() ? 'expired' as const
      : undefined;

    const result = verifyWitnessProof({
      raw: body.idkitResult as never,
      decision: { decisionHash: decision.decisionHash, expiresAt: decision.expiresAt },
      operatorNullifier: org.operatorNullifier ? BigInt(org.operatorNullifier.toFixed(0)) : null,
      mode: modeToWitnessMode(WORLD_MODE),
      nonceValid,
      nonceFailure,
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
          // `wid` in the attestation. It was previously '' here, and since
          // persist.ts reads `rawDigest || null`, an empty string silently made
          // wid NULL on every record ever written — including real approvals.
          // The digest is over RFC 8785 canonical JSON rather than raw wire
          // bytes, because the export republishes the parsed object and an
          // auditor must be able to recompute this from what they were given.
          rawDigest: worldProofDigest(canonical(body.idkitResult)),
          signalHash: (body.idkitResult as { responses: { signal_hash: string }[] }).responses[0]!.signal_hash,
          identifier: result.identifier,
          protocolVersion: (body.idkitResult as { protocol_version: string }).protocol_version,
          nullifier: result.nullifier.toString(),
          // We now REQUIRE presence on the device path, so record whether it
          // was actually carried rather than leaving the default.
          userPresenceCompleted:
            (body.idkitResult as { user_presence_completed?: boolean }).user_presence_completed === true,
          mode: modeToWitnessMode(WORLD_MODE),
        },
      }).catch((e) => console.error('[witness] proof persist failed', e));

      await prismaQuery.witness.update({
        where: { id: decision.witnessId },
        data: { lastVerifiedAt: new Date() },
      }).catch(() => {});
    }

    void attestDecision(decisionId);
    void payWitness(decisionId);

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
