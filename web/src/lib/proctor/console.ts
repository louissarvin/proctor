import { env } from '@/env';

export interface DecisionRow {
  id: string;
  state: string;
  outcome: string | null;
  humanLine: string;
  decisionHash: string;
  issuedAt: string;
  respondedAt: string | null;
  reviewMs: number | null;
  sequenceNumber: string | null;
  consensusTimestamp: string | null;
  explorerUrl: string | null;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${env.VITE_API_URL}${path}`);
  const body = await r.json();
  if (!r.ok || !body?.success) throw new Error(body?.error?.message ?? 'Request failed');
  return body.data;
}

export const listDecisions = (limit = 25) =>
  get<{ decisions: DecisionRow[] }>(`/v1/evidence/decisions?limit=${limit}`);

export interface TrustRoots {
  hcs: { topicId: string | null; network: string; note: string };
  attestor: { address: string };
  world: { rpId: string; mode: string; environment: string };
  canonicalization: string;
}

export const getTrustRoots = () => {
  return fetch(`${env.VITE_API_URL}/.well-known/proctor.json`).then((r) => r.json() as Promise<TrustRoots>);
};

/** Consensus timestamps are "seconds.nanos", not milliseconds. */
export const consensusToDate = (ts: string): Date => new Date(Number(ts.split('.')[0]) * 1000);

export interface Gap { orgSeq: number; kind: 'missing' | 'unpublished' }

export interface Completeness {
  org: string;
  issued: number;
  attested: number;
  gaps: Gap[];
  complete: boolean;
  trailing: number[];
  /** Issued but not yet decided. Owes the log nothing yet. */
  inFlight: number[];
  from: number;
  summary: string;
}

/**
 * Completeness is a different question from integrity. `bun verify` proves no
 * record was altered; this proves none was withheld.
 */
export const getCompleteness = () => get<Completeness>('/v1/evidence/gaps');
