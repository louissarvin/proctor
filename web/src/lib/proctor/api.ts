/**
 * Proctor API client.
 *
 * Every response is `{ success, error, data }`. Errors carry a stable `code`,
 * which is what the witness screen renders: a witness who is refused must be
 * told WHY in a sentence, never shown a spinner that never resolves.
 */
import { env } from '@/env';

const BASE = env.VITE_API_URL;

export interface ApiError {
  code: string;
  message: string;
}

export class ProctorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ProctorError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      // ngrok's free tier serves a browser interstitial instead of the API
      // response. curl sees JSON, a browser sees HTML, and JSON.parse fails
      // with an error that looks like the API is down.
      'ngrok-skip-browser-warning': '1',
      ...(init?.headers ?? {}),
    },
  });

  const body = (await response.json().catch(() => null)) as
    | { success: boolean; error: ApiError | null; data: T }
    | null;

  if (!response.ok || !body?.success) {
    const error = body?.error;
    throw new ProctorError(
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? `Request failed (${response.status})`,
      response.status,
    );
  }
  return body.data;
}

export interface WitnessDecision {
  decisionId: string;
  humanLine: string;
  /** The World `signal`. Binds the liveness proof to THIS decision. */
  signal: string;
  preimage: Record<string, unknown>;
  expiresAt: string;
  /** Countdowns render against THIS, never the device clock. */
  serverNow: string;
  requiredRole: string;
  world: {
    action: string;
    rpId: string;
    environment: 'production' | 'staging' | 'sandbox';
    mode: 'DEVICE' | 'SELFIE' | 'ORB';
    requirePresence?: boolean;
  };
}

export interface RpSignature {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  rp_id: string;
}

export interface RespondResult {
  outcome: 'APPROVE' | 'REFUSE';
  reviewMs: number;
  witnessAuth: 'proof' | 'token';
  independence?: 'crypto' | 'policy';
}

export const getWitnessDecision = (token: string) =>
  request<WitnessDecision>(`/v1/witness/decisions/${token}`);

/**
 * Minted per decision on arrival, never on page load: the signature TTL is
 * 300s and a stale one yields `rp_signature_expired` on a phone that took a
 * while to reach.
 */
export const mintRpSignature = (token: string) =>
  request<RpSignature>('/v1/witness/rp-signature', {
    method: 'POST',
    body: JSON.stringify({ witnessToken: token }),
  });

export const respond = (token: string, choice: 'APPROVE' | 'REFUSE', idkitResult?: unknown) =>
  request<RespondResult>(`/v1/witness/decisions/${token}/respond`, {
    method: 'POST',
    body: JSON.stringify({ witnessToken: token, choice, idkitResult }),
  });

/** Human-readable copy for every error the witness screen can hit. */
export const errorCopy = (code: string): { title: string; detail: string } => {
  switch (code) {
    case 'UNKNOWN_TOKEN':
      return { title: 'Link not recognised', detail: 'This approval link is not valid. It may have been mistyped.' };
    case 'DECISION_EXPIRED':
      return { title: 'Deadline passed', detail: 'This decision expired before it was answered, so it was automatically refused. The agent was not released.' };
    case 'ALREADY_RESOLVED':
      return { title: 'Already answered', detail: 'Someone has already responded to this decision.' };
    case 'WITNESS_IS_OPERATOR':
      return { title: 'You cannot approve this', detail: 'This decision was raised by an agent you operate. Approval requires a second person.' };
    case 'SIGNAL_MISMATCH':
      return { title: 'Proof did not match', detail: 'The proof was not bound to this decision. Please try again.' };
    case 'PROOF_REQUIRED':
      return { title: 'Verification needed', detail: 'Approving requires proving you are a live human.' };
    case 'VERIFICATION_FAILED':
      return { title: 'Verification failed', detail: 'World could not verify the proof. Please try again.' };
    case 'VERIFIER_UNREACHABLE':
      return { title: 'Verifier unreachable', detail: 'Could not reach World to verify. Check your connection and try again.' };
    default:
      return { title: 'Something went wrong', detail: 'Please try again, or refuse if you are unsure.' };
  }
};

/**
 * Tell the operator why the World widget failed.
 *
 * IDKit surfaces one generic "Something went wrong" to the witness while
 * carrying a specific code (`credential_unavailable`, `unknown_rp`,
 * `invalid_rp_signature`, ...). Without this the operator cannot distinguish a
 * misconfigured app from a witness who declined.
 *
 * Never throws: a diagnostic must not become a second failure on top of the
 * one it is reporting.
 */
export const reportClientError = (token: string, code: string, detail?: string): void => {
  void fetch(`${BASE}/v1/witness/decisions/${token}/client-error`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1' },
    body: JSON.stringify({ code, detail }),
  }).catch(() => {});
};
