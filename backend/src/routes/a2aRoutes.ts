/**
 * A2A JSON-RPC 2.0 binding.
 *
 * Read-only by design. `a2a.GetTask` lets any A2A client retrieve a real Task
 * object for a decision, including the evidence record as an artifact once the
 * decision is terminal.
 *
 * `a2a.SendMessage` is deliberately NOT implemented here. Opening a decision
 * costs money and is x402-gated at POST /v1/gate/decisions; re-implementing
 * that path behind JSON-RPC would fork the money path for no benefit, and a
 * silently-free second entrance to a paid gate is a hole, not a feature. The
 * method returns -32601 with a pointer rather than pretending.
 */
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { buildA2ATask } from '../lib/a2a/task.ts';
import { toTaskView, type DecisionStateName } from '../lib/a2a/taskState.ts';
import { HEDERA_TOPIC_ID } from '../config/main-config.ts';

/** JSON-RPC 2.0 reserved codes. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type RpcId = string | number | null;

const rpcError = (reply: FastifyReply, id: RpcId, code: number, message: string, data?: unknown) =>
  // JSON-RPC transports errors in the body, so the HTTP status stays 200.
  reply.code(200).send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });

const IMPLEMENTED = ['a2a.GetTask'] as const;

export const a2aRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { jsonrpc?: string; method?: string; id?: RpcId; params?: Record<string, unknown> } | null;

    if (!body || typeof body !== 'object') return rpcError(reply, null, PARSE_ERROR, 'Parse error');
    const id = body.id ?? null;
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return rpcError(reply, id, INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0" and method a string');
    }

    if (body.method !== 'a2a.GetTask') {
      return rpcError(reply, id, METHOD_NOT_FOUND, `Method not implemented: ${body.method}`, {
        implemented: IMPLEMENTED,
        note: body.method === 'a2a.SendMessage'
          ? 'Opening a decision is x402-gated. POST /v1/gate/decisions and pay the 402 challenge.'
          : undefined,
      });
    }

    const taskId = body.params?.['id'] ?? body.params?.['taskId'];
    if (typeof taskId !== 'string' || taskId.length === 0) {
      return rpcError(reply, id, INVALID_PARAMS, 'params.id (task id) is required');
    }

    const d = await prismaQuery.decision.findUnique({
      where: { id: taskId },
      include: {
        org: true, attestation: true,
        events: { orderBy: { at: 'asc' }, select: { kind: true, at: true } },
      },
    });
    // Not found and not-yours are the same answer: a task id is a bearer-ish
    // reference, so distinguishing them would confirm existence to a stranger.
    if (!d) return rpcError(reply, id, INVALID_PARAMS, 'Task not found');

    const view = toTaskView(d.id, d.state as DecisionStateName, d.humanLine);
    return reply.code(200).send({
      jsonrpc: '2.0',
      id,
      result: buildA2ATask({
        id: d.id,
        state: d.state as DecisionStateName,
        humanLine: d.humanLine,
        orgSlug: d.org.slug,
        orgSeq: d.orgSeq,
        decisionHash: d.decisionHash,
        outcome: d.outcome,
        statusMessage: view.statusMessage,
        attestation: d.attestation
          ? { sequenceNumber: d.attestation.sequenceNumber?.toString() ?? null, topicId: HEDERA_TOPIC_ID || null }
          : null,
        events: d.events,
      }),
    });
  });

  done();
};
