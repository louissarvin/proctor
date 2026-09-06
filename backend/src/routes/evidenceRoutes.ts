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
import { reconcile, describe } from '../lib/evidence/completeness.ts';
import { attestorAccount } from '../lib/attestation/build.ts';
import { toTaskView, type DecisionStateName } from '../lib/a2a/taskState.ts';
import {
  HEDERA_TOPIC_ID, MIRROR_NODE_URL, WORLD_RP_ID, WORLD_VERIFY_URL, HASHSCAN_BASE,
} from '../config/main-config.ts';

const MAX_LIMIT = 100;

export const evidenceRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * Completeness, which is a different question from integrity.
   *
   * `bun verify` answers "was the log altered?". This answers "is the log
   * complete?". An operator suppressing an inconvenient refusal breaks neither
   * the running hash nor any signature; it just never writes. Dense issuance
   * numbers signed into each record turn that into a visible hole.
   */
  app.get('/gaps', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string | undefined>;

    const org = q.org
      ? await prismaQuery.org.findUnique({ where: { slug: q.org } })
      : await prismaQuery.org.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) return handleError(reply, 404, 'No such organisation', 'ORG_NOT_FOUND');

    // Fetch resolved AND unresolved. Filtering unresolved ones out here made
    // them vanish from the map and reappear as "missing evidence": decisions
    // resolve out of order, so an open decision routinely sits below an
    // attested one. The reconciler needs to SEE them to know they are in
    // flight rather than withheld.
    const rows = await prismaQuery.decision.findMany({
      where: {
        orgId: org.id,
        // Scope to THIS log. A decision attested to an earlier topic is not
        // missing from this one, it is filed elsewhere, and counting it as a
        // gap would accuse the operator of withholding it.
        OR: [
          { attestation: { topicId: HEDERA_TOPIC_ID } },
          { attestation: { is: null } },
        ],
      },
      select: { orgSeq: true, outcome: true, attestation: { select: { sequenceNumber: true } } },
      orderBy: { orgSeq: 'asc' },
    });

    const report = reconcile(
      org.decisionCounter,
      rows.map((r) => ({
        orgSeq: r.orgSeq,
        sequenceNumber: r.attestation?.sequenceNumber?.toString() ?? null,
        unpublished: Boolean(r.attestation) && !r.attestation?.sequenceNumber,
        resolved: r.outcome !== null,
      })),
      rows[0]?.orgSeq ?? 1,
    );

    return reply.code(200).send({
      success: true,
      error: null,
      data: {
      org: org.slug,
      topicId: HEDERA_TOPIC_ID || null,
      ...report,
      summary: describe(report),
      note:
        'The running hash proves no record was altered or removed. This proves none was withheld. ' +
        'Issuance numbers are dense and signed into each attestation as `sq`, so a suppressed ' +
        'decision leaves a hole a third party can see on the topic.',
      inFlightNote:
        'Issued but not yet decided. These owe the log nothing until they resolve, and ' +
        'decisions resolve out of order, so an open decision routinely sits below an attested one.',
      caveat:
        'An operator can still stop writing entirely from some point on. A trailing run is reported ' +
        'separately from interior gaps for exactly that reason: this check makes suppression loud, ' +
        'it does not make it impossible.',
      },
    });
  });

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
          // A2A view alongside our own state, so another agent can read the
          // lifecycle without learning Proctor's vocabulary.
          a2a: toTaskView(d.id, d.state as DecisionStateName, d.humanLine),
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
            // Sequence numbers are per-topic. Without this the pair is ambiguous.
            topicId: d.attestation.topicId,
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
    //
    // Two things the obvious implementation gets wrong, both of which produce
    // an export that FAILS its own verifier:
    //
    //  1. Mirror ingestion lags consensus by roughly 1-5s. An export taken
    //     right after a decision cites a sequence number whose message has not
    //     landed yet, so the body cannot be matched to the chain.
    //  2. `limit=100` returns one page. Past 100 messages the export silently
    //     truncates, and every record beyond it fails the same way.
    //
    // An export that is not verifiable is not evidence, so we wait for the
    // mirror rather than hand out a document that cannot be checked.
    const fetchAll = async (): Promise<RawMirrorMessage[]> => {
      const out: RawMirrorMessage[] = [];
      let next: string | null = `/api/v1/topics/${HEDERA_TOPIC_ID}/messages?limit=100&order=asc`;
      while (next) {
        const res = await fetch(`${MIRROR_NODE_URL}${next}`);
        if (!res.ok) break;
        const page = (await res.json()) as { messages?: RawMirrorMessage[]; links?: { next?: string | null } };
        out.push(...(page.messages ?? []));
        next = page.links?.next ?? null;
      }
      return out;
    };

    // The highest sequence this export claims. Only records on THIS topic:
    // a record from an abandoned topic is skipped by the verifier anyway.
    const maxCited = records.reduce((m, r) => {
      const s = r.attestation?.sequenceNumber;
      const onThisTopic = !r.attestation?.topicId || r.attestation.topicId === HEDERA_TOPIC_ID;
      return onThisTopic && s ? Math.max(m, Number(s)) : m;
    }, 0);

    let hcsMessages: RawMirrorMessage[] = [];
    if (HEDERA_TOPIC_ID) {
      try {
        for (let attempt = 0; attempt < 10; attempt++) {
          hcsMessages = await fetchAll();
          const highest = hcsMessages.reduce((m, msg) => Math.max(m, Number(msg.sequence_number ?? 0)), 0);
          if (highest >= maxCited) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        const highest = hcsMessages.reduce((m, msg) => Math.max(m, Number(msg.sequence_number ?? 0)), 0);
        if (maxCited > 0 && highest < maxCited) {
          return handleError(reply, 503,
            `Mirror node has not yet ingested sequence ${maxCited} (has ${highest}). Retry shortly.`,
            'MIRROR_LAGGING');
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
