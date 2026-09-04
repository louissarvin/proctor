/**
 * Witness dispatch: get a decision onto a phone.
 *
 * Web Push per RFC 8030, authenticated with VAPID per RFC 8292:
 *   "The signature MUST use ECDSA on the NIST P-256 curve, identified as ES256"
 *   "An 'aud' claim MUST include the ... origin of the push resource URL"
 *   "An 'exp' claim MUST NOT be more than 24 hours from the time of the request"
 * The web-push library builds that JWT for us; we supply the key pair and
 * subject.
 *
 * TIMING. Push delivery is the largest single variance in the demo budget.
 * Published benchmarks (APNs p50 66ms, FCM p50 99ms) measure the push
 * service's ACCEPTANCE of the message, not delivery to the handset. On an
 * awake, unlocked, screen-on device the last hop is typically sub-second; on a
 * sleeping or backgrounded device it is unbounded. That is why "unlocked,
 * screen on, DND off" is a demo requirement rather than a nicety.
 */
import webpush from 'web-push';
import { prismaQuery } from '../prisma.ts';
import {
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WITNESS_APP_URL,
} from '../../config/main-config.ts';

let configured = false;

export const pushConfigured = (): boolean => Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

const ensureConfigured = (): void => {
  if (configured) return;
  if (!pushConfigured()) throw new Error('VAPID keys are not configured');
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
};

export interface WitnessCandidate {
  id: string;
  pushEndpoint: string | null;
  pushP256dh: string | null;
  pushAuth: string | null;
}

/**
 * Pick a witness from the rota.
 *
 * "Rota", never "marketplace". Witnesses hold an org-issued role; nobody lets
 * an anonymous stranger approve EUR 41,200.
 *
 * Ordered by least-recently-used so load spreads across the on-call roster
 * rather than always hitting the same person.
 */
export const selectWitness = async (orgId: string, requiredRole: string): Promise<WitnessCandidate | null> => {
  const w = await prismaQuery.witness.findFirst({
    where: { orgId, state: 'ENROLLED', role: requiredRole, revokedAt: null },
    orderBy: [{ lastVerifiedAt: 'asc' }, { enrolledAt: 'asc' }],
    select: { id: true, pushEndpoint: true, pushP256dh: true, pushAuth: true },
  });
  return w;
};

export interface DispatchResult {
  delivered: boolean;
  /** Milliseconds to push-service ACCEPTANCE, not handset delivery. */
  acceptedMs: number;
  reason?: string;
}

/**
 * Send the decision to a witness's device.
 *
 * The payload carries only the one line and the deep link. The full preimage
 * stays behind the token-authenticated fetch, so a push notification sitting on
 * a lock screen never discloses the whole record.
 */
export const dispatchToWitness = async (
  witness: WitnessCandidate,
  witnessToken: string,
  humanLine: string,
  expiresAt: Date,
): Promise<DispatchResult> => {
  if (!witness.pushEndpoint || !witness.pushP256dh || !witness.pushAuth) {
    return { delivered: false, acceptedMs: 0, reason: 'witness_has_no_push_subscription' };
  }

  ensureConfigured();
  const started = Date.now();

  try {
    await webpush.sendNotification(
      {
        endpoint: witness.pushEndpoint,
        keys: { p256dh: witness.pushP256dh, auth: witness.pushAuth },
      },
      JSON.stringify({
        title: 'Approval required',
        body: humanLine,
        url: `${WITNESS_APP_URL}/w/${witnessToken}`,
        expiresAt: expiresAt.toISOString(),
      }),
      {
        // The push service should not hold this past the decision deadline: a
        // notification that arrives after expiry is worse than none, because
        // the witness taps it and finds a dead decision.
        TTL: Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)),
        urgency: 'high',
      },
    );
    return { delivered: true, acceptedMs: Date.now() - started };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    // 404 and 410 mean the subscription is dead; the browser dropped it.
    if (status === 404 || status === 410) {
      await prismaQuery.witness.update({
        where: { id: witness.id },
        data: { pushEndpoint: null, pushP256dh: null, pushAuth: null },
      }).catch(() => {});
      return { delivered: false, acceptedMs: Date.now() - started, reason: 'subscription_expired' };
    }
    return { delivered: false, acceptedMs: Date.now() - started, reason: `push_failed_${status ?? 'unknown'}` };
  }
};
