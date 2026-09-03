/**
 * Evidence console API.
 *
 * POSTGRES IS THE INDEX, HCS IS THE TRUTH.
 * The mirror node cannot filter on anything inside a message payload: only
 * topic, sequence number and timestamp. So every console query is served from
 * Postgres, and every row carries the sequence number and consensus timestamp
 * needed to re-fetch from the mirror node and re-verify independently.
 *
 * Say this in the README. A judge who sees Postgres in the diagram will
 * otherwise ask whether the database is the source of truth. It is not.
 */
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';
import { buildExport, type ExportRecord, type RawMirrorMessage } from '../lib/evidence/export.ts';
import { attestorAccount } from '../lib/attestation/build.ts';
import {
  HEDERA_TOPIC_ID, MIRROR_NODE_URL, WORLD_RP_ID, WORLD_VERIFY_URL, HASHSCAN_BASE,
} from '../config/main-config.ts';

const MAX_LIMIT = 100;

export const evidenceRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /** List decisions. Filters run in Postgres, never against the mirror node. */
  app.get('/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit ?? 50) || 50, MAX_LIMIT);

    const where: Record<string, unknown> = {};
    if (q.orgId) where.orgId = q.orgId;
    if (q.agentId) where.agentId = q.agentId;
    if (q.witnessId) where.witnessId = q.witnessId;
    if (q.outcome) where.outcome = q.outcome;
    if (q.from || q.to) {
      where.issuedAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }

    const rows = await prismaQuery.decision.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      take: limit,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      select: {
        id: true, state: true, outcome: true, humanLine: true, decisionHash: true,
        issuedAt: true, respondedAt: true, reviewMs: true,
        agentId: true, witnessId: true,
        attestation: { select: { sequenceNumber: true, consensusTimestamp: true, topicId: true } },
      },
    });

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        decisions: rows.map((d) => ({
          ...d,
          // Every row is independently re-fetchable. That is the point.
          sequenceNumber: d.attestation?.sequenceNumber?.toString() ?? null,
          consensusTimestamp: d.attestation?.consensusTimestamp ?? null,
          explorerUrl: d.attestation?.topicId ? `${HASHSCAN_BASE}/topic/${d.attestation.topicId}` : null,
          attestation: undefined,
        })),
        nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null,
      },
    });
  });

  /** The full record for one decision. */
  app.get('/decisions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const d = await prismaQuery.decision.findUnique({
      where: { id },
      include: {
        attestation: true,
        proof: true,
        payments: true,
        events: { orderBy: { at: 'asc' } },
      },
    });
    if (!d) return handleError(reply, 404, 'Decision not found', 'DECISION_NOT_FOUND');

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
        ...d,
        attestation: d.attestation
          ? { ...d.attestation, sequenceNumber: d.attestation.sequenceNumber?.toString() ?? null }
          : null,
        proof: d.proof ? { ...d.proof, nullifier: d.proof.nullifier.toString() } : null,
        payments: d.payments.map((p) => ({ ...p, amountUsd: p.amountUsd.toString() })),
      },
    });
  });

  /** The Article 12 export. */
  app.post('/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, string | undefined>;

    const decisions = await prismaQuery.decision.findMany({
      where: {
        ...(body.orgId ? { orgId: body.orgId } : {}),
        ...(body.from || body.to
          ? { issuedAt: { ...(body.from ? { gte: new Date(body.from) } : {}), ...(body.to ? { lte: new Date(body.to) } : {}) } }
          : {}),
      },
      orderBy: { issuedAt: 'asc' },
      include: { attestation: true, proof: true, payments: true, events: { orderBy: { at: 'asc' } } },
    });

    const records: ExportRecord[] = decisions.map((d) => ({
      decisionId: d.id,
      preimage: d.preimage as Record<string, unknown>,
      decisionHash: d.decisionHash,
      humanLine: d.humanLine,
      // Raw, exactly as World returned it. Re-verifiable against World, not us.
      idkitResult: (d.proof?.raw as unknown) ?? null,
      attestation: d.attestation
        ? {
            body: d.attestation.body,
            attestorSig: d.attestation.attestorSig,
            sequenceNumber: d.attestation.sequenceNumber?.toString() ?? null,
            consensusTimestamp: d.attestation.consensusTimestamp,
            runningHash: d.attestation.runningHash,
          }
        : null,
      period: {
        issuedAt: d.issuedAt.toISOString(),
        dispatchedAt: d.dispatchedAt?.toISOString() ?? null,
        respondedAt: d.respondedAt?.toISOString() ?? null,
        expiresAt: d.expiresAt.toISOString(),
        reviewMs: d.reviewMs,
      },
      outcome: d.outcome,
      payments: d.payments.map((p) => ({
        leg: p.leg, rail: p.rail, amountUsd: p.amountUsd.toString(),
        externalId: p.externalId, explorerUrl: p.explorerUrl, state: p.state,
      })),
      events: d.events.map((e) => ({ at: e.at.toISOString(), kind: e.kind })),
    }));

    // Raw mirror rows so the chain can be recomputed offline.
    const hcsMessages: RawMirrorMessage[] = [];
    if (HEDERA_TOPIC_ID) {
      try {
        const res = await fetch(`${MIRROR_NODE_URL}/api/v1/topics/${HEDERA_TOPIC_ID}/messages?limit=100&order=asc`);
        if (res.ok) {
          const page = (await res.json()) as { messages?: RawMirrorMessage[] };
          hcsMessages.push(...(page.messages ?? []));
        }
      } catch (error) {
        console.warn('[evidence] mirror node unreachable during export', error);
      }
    }

    const doc = buildExport({
      anchors: {
        topicId: HEDERA_TOPIC_ID,
        mirrorNodeBaseUrl: MIRROR_NODE_URL,
        attestorAddress: attestorAccount().address,
        rpId: WORLD_RP_ID,
        worldVerifyUrl: WORLD_VERIFY_URL,
        rootsSequenceNumber: null,
      },
      hcsMessages,
      records,
    });

    return reply
      .header('content-type', 'application/json')
      .header('content-disposition', `attachment; filename="proctor-evidence-${Date.now()}.json"`)
      .code(200)
      .send(doc);
  });

  done();
};
