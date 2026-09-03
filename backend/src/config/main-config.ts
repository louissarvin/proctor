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
export const MIRROR_NODE_URL: string = opt('MIRROR_NODE_URL', 'https://testnet.mirrornode.hedera.com');
export const HASHSCAN_BASE: string = opt('HASHSCAN_BASE', 'https://hashscan.io/testnet');
// NOTE: the USDC token id is deliberately NOT here. Import HEDERA_TESTNET_USDC
// from '@x402/hedera' so it can never drift from the scheme's own table.

// --- x402 ------------------------------------------------------------------
// Blocky402 is the DEFAULT, not a fallback. Hedera's qualification bullet names
// it explicitly: "settled through the Blocky402 facilitator".
export const FACILITATOR_URL: string = opt('FACILITATOR_URL', 'https://api.testnet.blocky402.com');
export const FACILITATOR_FALLBACK_URL: string = opt('FACILITATOR_FALLBACK_URL', 'https://x402.org/facilitator');
export const PAY_TO_HEDERA: string = opt('PAY_TO_HEDERA');
export const GATE_PRICE_USD: string = opt('GATE_PRICE_USD', '0.42');
export const METER_RATE_USD_PER_SEC: string = opt('METER_RATE_USD_PER_SEC', '0.0021');
export const METER_MODE: 'HEDERA' | 'ARC' = (opt('METER_MODE', 'HEDERA') as 'HEDERA' | 'ARC');

// --- World ID 4.0 ----------------------------------------------------------
export const WORLD_APP_ID: string = opt('WORLD_APP_ID');
export const WORLD_RP_ID: string = opt('WORLD_RP_ID');
/** SECRET. Never expose to the client, never log. */
export const WORLD_RP_SIGNING_KEY: string = opt('WORLD_RP_SIGNING_KEY');
export const WORLD_ACTION: string = opt('WORLD_ACTION', 'proctor-witness-approval');
export const WORLD_VERIFY_URL: string = opt('WORLD_VERIFY_URL', 'https://developer.world.org');
export const WORLD_ENVIRONMENT: string = opt('WORLD_ENVIRONMENT', 'staging');
/** DEVICE until the Selfie Check beta flag is granted, then SELFIE. One variable. */
export const WORLD_MODE: 'DEVICE' | 'SELFIE' = (opt('WORLD_MODE', 'DEVICE') as 'DEVICE' | 'SELFIE');

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
