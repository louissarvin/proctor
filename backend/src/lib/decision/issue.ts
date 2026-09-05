import { prismaQuery } from '../prisma.ts';
import type { Prisma } from '../../../prisma/generated/client.js';

/**
 * Hand out the next dense issuance number and create the decision atomically.
 *
 * BOTH HALVES MUST SHARE ONE TRANSACTION. Incrementing the counter first and
 * creating second would burn a number whenever the create failed, and a burned
 * number is indistinguishable from a suppressed decision: the completeness
 * check would report a hole that nobody caused. A false accusation of
 * withholding evidence is worse than no check at all, so the increment rolls
 * back with the create.
 *
 * The counter lives on the Org row rather than being derived from
 * `max(orgSeq) + 1`, because the derived form races: two concurrent creates
 * read the same maximum and produce a duplicate. `increment` is a single
 * in-database read-modify-write under a row lock, so concurrent issuers
 * serialise per org and the sequence stays dense.
 */
export const issueDecision = async (
  orgId: string,
  data: Omit<Prisma.DecisionUncheckedCreateInput, 'orgId' | 'orgSeq'>,
) =>
  prismaQuery.$transaction(async (tx) => {
    const org = await tx.org.update({
      where: { id: orgId },
      data: { decisionCounter: { increment: 1 } },
      select: { decisionCounter: true },
    });

    return tx.decision.create({
      data: { ...data, orgId, orgSeq: org.decisionCounter },
    });
  });

/** Highest number ever handed out. Anything at or below it must reach the log. */
export const issuedCount = async (orgId: string): Promise<number> => {
  const org = await prismaQuery.org.findUnique({
    where: { id: orgId },
    select: { decisionCounter: true },
  });
  return org?.decisionCounter ?? 0;
};
