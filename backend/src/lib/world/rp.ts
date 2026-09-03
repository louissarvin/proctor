/**
 * RP signature minting.
 *
 * World ID 4.0 made a backend RP signature MANDATORY before the widget can
 * open. It did not exist in v3, which is why every older sample omits it.
 *
 * signRequest is re-exported by @worldcoin/idkit-core/signing from
 * @worldcoin/idkit-server, so we do not need idkit-server as a direct
 * dependency. We never import @worldcoin/idkit (React) on the server: Bun's
 * isolated linker has no hoisting and it fails hard.
 */
import { signRequest, type RpSignature } from '@worldcoin/idkit-core/signing';
import { WORLD_RP_SIGNING_KEY, WORLD_ACTION, WORLD_RP_ID } from '../../config/main-config.ts';

/** Default TTL in seconds. Mint per decision, never on page load. */
export const RP_SIGNATURE_TTL_SECONDS = 300;

export interface MintedRpSignature {
  sig: string;
  nonce: string;
  /** Unix SECONDS, not milliseconds. */
  created_at: number;
  expires_at: number;
  rp_id: string;
}

export const mintRpSignature = (ttl = RP_SIGNATURE_TTL_SECONDS): MintedRpSignature => {
  if (!WORLD_RP_SIGNING_KEY) throw new Error('WORLD_RP_SIGNING_KEY is not configured');

  const s: RpSignature = signRequest({
    signingKeyHex: WORLD_RP_SIGNING_KEY,
    action: WORLD_ACTION,   // required for non-session proofs; session proofs omit it
    ttl,
  });

  return {
    sig: s.sig,
    nonce: s.nonce,
    created_at: s.createdAt,
    expires_at: s.expiresAt,
    rp_id: WORLD_RP_ID,
  };
};
