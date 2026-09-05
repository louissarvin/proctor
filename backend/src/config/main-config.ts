/**
 * Centralized configuration for the application
 * All commonly used environment variables should be defined here
 */

// Validate required environment variables on startup
const requiredEnvVars: string[] = ['DATABASE_URL', 'JWT_SECRET'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// App Configuration
export const APP_PORT: number = Number(process.env.APP_PORT) || 3700;
export const NODE_ENV: string = process.env.NODE_ENV || 'development';
export const IS_DEV: boolean = NODE_ENV === 'development';
export const IS_PROD: boolean = NODE_ENV === 'production';

// Database
export const DATABASE_URL: string = process.env.DATABASE_URL as string;

// Authentication
export const JWT_SECRET: string = process.env.JWT_SECRET as string;
export const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '7d';

// Error Log Configuration
export const ERROR_LOG_MAX_RECORDS: number = 10000;
export const ERROR_LOG_CLEANUP_INTERVAL: string = '0 * * * *'; // Every hour

// ---------------------------------------------------------------------------
// PROCTOR / sponsor configuration
//
// This file is the ONLY module in the repo permitted to read process.env.
// That is not a style rule: it is what makes the mainnet-readiness claim
// structural. Zero chain literals in source means porting is an env file,
// not a refactor. Enforced by:
//   grep -rn "process.env" src/ | grep -v config/main-config
// ---------------------------------------------------------------------------

const opt = (key: string, fallback = ''): string => process.env[key] || fallback;

/** Env vars that are not fatal at boot but disable a leg if missing. */
const softRequired: string[] = [
  'HEDERA_OPERATOR_ID',
  'HEDERA_OPERATOR_KEY',
  'WORLD_RP_SIGNING_KEY',
];
for (const key of softRequired) {
  if (!process.env[key]) {
    console.warn(`[config] ${key} is not set. The dependent leg will be unavailable.`);
  }
}

// --- Hedera ----------------------------------------------------------------
export const HEDERA_NETWORK: string = opt('HEDERA_NETWORK', 'testnet');
export const HEDERA_OPERATOR_ID: string = opt('HEDERA_OPERATOR_ID');
export const HEDERA_OPERATOR_KEY: string = opt('HEDERA_OPERATOR_KEY');
export const HEDERA_TOPIC_ID: string = opt('HEDERA_TOPIC_ID');
/** The gate's payTo account. SECRET key, needed only to update the account itself. */
export const HEDERA_TREASURY_ID: string = opt('HEDERA_TREASURY_ID');
export const HEDERA_TREASURY_KEY: string = opt('HEDERA_TREASURY_KEY');
export const MIRROR_NODE_URL: string = opt('MIRROR_NODE_URL', 'https://testnet.mirrornode.hedera.com');
export const HASHSCAN_BASE: string = opt('HASHSCAN_BASE', 'https://hashscan.io/testnet');
// NOTE: the USDC token id is deliberately NOT here. Import HEDERA_TESTNET_USDC
// from '@x402/hedera' so it can never drift from the scheme's own table.

// --- Hedera agent (the paying customer) --------------------------------------
export const HEDERA_AGENT_ID: string = opt('HEDERA_AGENT_ID');
/** SECRET. */
export const HEDERA_AGENT_KEY: string = opt('HEDERA_AGENT_KEY');

/**
 * Where the witness fee is paid. HBAR, so no token association is required and
 * a person who has never held a token can still receive it. Unset means the fee
 * is recorded as owed rather than silently skipped.
 */
export const WITNESS_HEDERA_ACCOUNT: string = opt('WITNESS_HEDERA_ACCOUNT');

/**
 * On-call standby pay, in tinybar, per retainer period.
 *
 * Paying only per decision prices availability at zero, so a witness who is
 * reachable all day and receives nothing earns nothing. Default is deliberately
 * small: this is standby, not salary.
 */
export const RETAINER_TINYBAR: string = opt('RETAINER_TINYBAR', '500000');

// --- x402 ------------------------------------------------------------------
// Blocky402 is the DEFAULT, not a fallback. Hedera's qualification bullet names
// it explicitly: "settled through the Blocky402 facilitator".
export const FACILITATOR_URL: string = opt('FACILITATOR_URL', 'https://api.testnet.blocky402.com');
export const FACILITATOR_FALLBACK_URL: string = opt('FACILITATOR_FALLBACK_URL', 'https://x402.org/facilitator');
export const PAY_TO_HEDERA: string = opt('PAY_TO_HEDERA');
export const GATE_PRICE_USD: string = opt('GATE_PRICE_USD', '0.42');
/**
 * USDC or HBAR. Circle's Hedera faucet did not deliver testnet USDC, so HBAR is
 * the settlement asset that actually works today. The wire is identical: same
 * scheme, same facilitator, only the asset id differs.
 */
export const GATE_ASSET: 'USDC' | 'HBAR' | 'TOKEN' = (opt('GATE_ASSET', 'HBAR') as 'USDC' | 'HBAR' | 'TOKEN');
/**
 * An explicit HTS token id for the gate, used when GATE_ASSET=TOKEN.
 *
 * USDC is an HTS token, so "HTS in the settlement path" was true on paper while
 * every real settlement moved HBAR, because the faucet never delivered any
 * USDC. Minting our own removes that dependency: the gate already quotes an
 * arbitrary token id correctly, so supply was the only thing missing.
 */
export const GATE_TOKEN_ID: string = opt('GATE_TOKEN_ID');
/** Atomic units at the token's decimals. 420000 = $0.42 at 6dp. */
export const GATE_TOKEN_AMOUNT: string = opt('GATE_TOKEN_AMOUNT', '420000');
/** Atomic HBAR (8 decimals). 1 HBAR = 100000000. */
export const GATE_PRICE_HBAR_TINYBAR: string = opt('GATE_PRICE_HBAR_TINYBAR', '100000000');
export const METER_RATE_USD_PER_SEC: string = opt('METER_RATE_USD_PER_SEC', '0.0021');
/** Tinybar charged per second of human attention. 0.0021 USD/s at ~$0.05/HBAR. */
export const METER_TINYBAR_PER_SECOND: string = opt('METER_TINYBAR_PER_SECOND', '420000');
/** x402 cannot quote a zero amount, so a floor is required. */
export const METER_MIN_TINYBAR: string = opt('METER_MIN_TINYBAR', '100000');
export const METER_MODE: 'HEDERA' | 'ARC' = (opt('METER_MODE', 'HEDERA') as 'HEDERA' | 'ARC');

// --- World ID 4.0 ----------------------------------------------------------
export const WORLD_APP_ID: string = opt('WORLD_APP_ID');
export const WORLD_RP_ID: string = opt('WORLD_RP_ID');
/** SECRET. Never expose to the client, never log. */
export const WORLD_RP_SIGNING_KEY: string = opt('WORLD_RP_SIGNING_KEY');
export const WORLD_ACTION: string = opt('WORLD_ACTION', 'proctor-witness-approval');
export const WORLD_VERIFY_URL: string = opt('WORLD_VERIFY_URL', 'https://developer.world.org');
/**
 * IDKit environment: `production` | `staging` | `sandbox`.
 *
 * **Use `sandbox` when testing against the sandbox World ID app.** World's own
 * access guide is explicit: set `environment: sandbox` in IDKit, and still send
 * the proof to the PRODUCTION verify endpoint. The two do not move together,
 * which is easy to get wrong in the opposite direction.
 *
 * Note the docs contradict themselves here and we reported it: the verify API
 * reference lists only `production | staging`, omitting `sandbox` entirely, and
 * the endpoint accepts any string without validating it. See WORLD_FEEDBACK.md
 * §1.2 and §1.3.
 */
export const WORLD_ENVIRONMENT: string = opt('WORLD_ENVIRONMENT', 'staging');
/** DEVICE until the Selfie Check beta flag is granted, then SELFIE. One variable. */
/**
 * Which credential the witness is asked for.
 *
 * DEVICE is Deprecated by World: "keep deviceLegacy only for EXISTING Device
 * integrations." A new app cannot obtain a device credential at all, which is
 * why it fails with an empty `generic_error`. ORB is the working fallback when
 * Selfie Check access has not been granted.
 */
/**
 * Enables POST /v1/demo/run, which opens a decision WITHOUT settling a payment.
 * Off by default: a deployment that forgets this gets 404, not an open door.
 */
export const DEMO_MODE: boolean = opt('DEMO_MODE', 'false') === 'true';

/** Liveness on the fallback. Env-driven so it can be bisected against World. */
export const WORLD_REQUIRE_PRESENCE: boolean = opt('WORLD_REQUIRE_PRESENCE', 'true') !== 'false';

export const WORLD_MODE: 'DEVICE' | 'SELFIE' | 'ORB' =
  (opt('WORLD_MODE', 'DEVICE') as 'DEVICE' | 'SELFIE' | 'ORB');

// --- Arc ---
export const ARC_RPC_URL: string = opt('ARC_RPC_URL', 'https://rpc.testnet.arc.io');
export const ARC_CHAIN_ID: number = Number(opt('ARC_CHAIN_ID', '5042002'));
/** SECRET. EOA that owns the ERC-8004 agent identity. */
export const ARC_PRIVATE_KEY: string = opt('ARC_PRIVATE_KEY');

/**
 * Circle's Gateway facilitator. Serves Arc testnet, which Blocky402 does not.
 * NB the SDK's own example documents `https://gateway.circle.com`, which does
 * not resolve; the testnet host below is the one Circle's seller quickstart
 * uses and the one that answers.
 */
export const ARC_FACILITATOR_URL: string = opt('ARC_FACILITATOR_URL', 'https://gateway-api-testnet.circle.com');

/**
 * Arc payout address.
 *
 * EOA, never a smart-contract wallet: Gateway needs ecrecover, not ERC-1271.
 *
 * MUST DIFFER FROM THE PAYING AGENT'S ADDRESS. Setting both to the same EOA
 * makes the agent pay itself, and Gateway rejects the authorization with a bare
 * 402 that names nothing — it looks identical to a signing failure.
 */
export const PAY_TO_ARC: string = opt('PAY_TO_ARC', '0x0000000000000000000000000000000000000000');
export const ARC_AGENT_ID: string = opt('ARC_AGENT_ID');

/** Kill switch for HCS writes. Set in tests so fixtures never reach the log. */
export const ATTEST_DISABLED: boolean = opt('ATTEST_DISABLED', '') === 'true';

// --- attestation -----------------------------------------------------------
/** SECRET. EIP-712 signing key for attestations. Distinct from the World RP key. */
export const ATTESTOR_PRIVATE_KEY: string = opt('ATTESTOR_PRIVATE_KEY');
export const ATTESTATION_SPEC_VERSION: number = 1;
/** Hard ceiling. One HCS chunk is 1024 bytes; above that a message splits. */
export const ATTESTATION_MAX_BYTES: number = 1024;

// --- Web Push (VAPID) --------------------------------------------------------
export const VAPID_PUBLIC_KEY: string = opt('VAPID_PUBLIC_KEY');
/** SECRET. */
export const VAPID_PRIVATE_KEY: string = opt('VAPID_PRIVATE_KEY');
export const VAPID_SUBJECT: string = opt('VAPID_SUBJECT', 'mailto:dev@proctor.local');

/** Base URL the witness PWA is served from, used to build the deep link. */
export const WITNESS_APP_URL: string = opt('WITNESS_APP_URL', 'http://localhost:3200');

/**
 * Publicly reachable base URL of THIS API.
 *
 * The A2A agent card must carry a URL another agent can actually call: a card
 * that only describes the service makes it legible, not reachable, and the
 * whole point of publishing one is discovery. Also what a marketplace listing
 * is health-checked against.
 */
export const PUBLIC_BASE_URL: string = opt('PUBLIC_BASE_URL', `http://localhost:${APP_PORT}`);

// --- policy ----------------------------------------------------------------
/** The gate fails CLOSED. If nothing answers within the TTL, the outcome is REFUSE. */
export const DECISION_TTL_SECONDS: number = Number(opt('DECISION_TTL_SECONDS', '60'));

// Export all as default object for convenience
export default {
  APP_PORT,
  NODE_ENV,
  IS_DEV,
  IS_PROD,
  DATABASE_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  ERROR_LOG_MAX_RECORDS,
  ERROR_LOG_CLEANUP_INTERVAL,
};
