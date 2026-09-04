/**
 * Witness token auth.
 *
 * The token is an opaque 32-byte value delivered in the push deep link. It is
 * scoped to ONE decision and dies with the TTL. It is stored hashed, so a
 * database leak does not let an attacker answer pending decisions.
 *
 * Deliberately NOT a JWT: there is nothing to encode, no expiry to trust from
 * the client, and a bearer string the server can revoke by resolving a decision
 * is strictly simpler.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { hashWitnessToken } from '../lib/decision/lifecycle.ts';
import { handleError } from '../utils/errorHandler.ts';

declare module 'fastify' {
  interface FastifyRequest {
    witnessDecisionId?: string;
  }
}

/** Resolve a token to its decision, or answer with the right error. */
export const requireWitnessToken = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<true | FastifyReply> => {
  const params = request.params as { token?: string };
  const body = (request.body ?? {}) as { witnessToken?: string };
  const token = params.token ?? body.witnessToken;

  if (!token) return handleError(reply, 401, 'Witness token required', 'WITNESS_TOKEN_REQUIRED');

  const decision = await prismaQuery.decision.findUnique({
    where: { witnessTokenHash: hashWitnessToken(token) },
    select: { id: true, state: true, expiresAt: true },
  });

  // Same response for an unknown token and a malformed one: do not let a caller
  // probe which tokens exist.
  if (!decision) return handleError(reply, 404, 'Unknown token', 'UNKNOWN_TOKEN');

  if (decision.state === 'APPROVED' || decision.state === 'REFUSED' || decision.state === 'EXPIRED') {
    return handleError(reply, 409, 'Decision already resolved', 'ALREADY_RESOLVED');
  }
  if (decision.expiresAt.getTime() <= Date.now()) {
    // The sweeper may not have run yet, but the deadline has passed. Fail closed.
    return handleError(reply, 410, 'Decision expired', 'DECISION_EXPIRED');
  }

  request.witnessDecisionId = decision.id;
  return true;
};
