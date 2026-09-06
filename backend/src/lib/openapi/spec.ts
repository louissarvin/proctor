/**
 * OpenAPI 3 document.
 *
 * WHY THIS EXISTS
 * Hedera's extra-points list asks for "agent discovery via UCP, or a directory
 * that makes your service findable by other agents". This is the second clause:
 * a machine-readable contract at a stable path, alongside the A2A agent card
 * and the x402 `accepts[]` array.
 *
 * It is also the artefact the Circle Agent Marketplace listing asks for, so it
 * is written once and cited three times.
 *
 * Generated from the routes' own schemas by @fastify/swagger, so it cannot
 * drift from the implementation the way a hand-maintained spec does.
 */
import { GATE_PRICE_USD, DECISION_TTL_SECONDS } from '../../config/main-config.ts';
import { PUBLIC_BASE_URL } from '../../config/main-config.ts';

export const openapiConfig = {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'Proctor',
      version: '1.0.0',
      description: [
        'An AI agent stops mid-payment and pays a live, verified human for permission to continue.',
        '',
        '## Paying for the gate',
        '',
        `\`POST /v1/gate/decisions\` is paywalled with x402 v2. An unpaid request returns **402** with the`,
        'payment requirements in a base64 **`payment-required` response header**, not in the body.',
        'The body is `{}`. Clients using `@x402/fetch`\'s `wrapFetchWithPayment` handle this automatically.',
        '',
        `Current price: **$${GATE_PRICE_USD}** in USDC on Hedera testnet, settled through the Blocky402 facilitator.`,
        '',
        '## The oversight loop',
        '',
        '1. `POST /v1/gate/evaluate` — free. Most actions return `escalate: false` and proceed.',
        '2. `POST /v1/gate/decisions` — paid. Opens a decision and dispatches a witness.',
        `3. \`GET /v1/gate/decisions/{id}/stream\` — SSE. Holds the agent open for the ${DECISION_TTL_SECONDS}s deadline.`,
        '4. The witness approves or refuses on a phone. **The default outcome is refuse.**',
        '5. An attestation is written to a Hedera Consensus Service topic with no admin key.',
        '',
        '## What the evidence establishes',
        '',
        'A live human approved **this** decision, their World ID account is distinct from the',
        'operator\'s, and the record cannot be altered afterwards. Every attestation records',
        'whether independence is cryptographic or a policy property of the rota.',
      ].join('\n'),
      license: { name: 'MIT' },
    },
    // A marketplace listing is health-checked against this, and an agent that
    // reads the spec will call it. Hardcoding localhost publishes a service
    // description nothing outside this machine can act on.
    servers: [{ url: PUBLIC_BASE_URL, description: PUBLIC_BASE_URL.includes('localhost') ? 'Local' : 'Public' }],
    tags: [
      { name: 'gate', description: 'Agent-facing. Policy evaluation and the x402-paid decision gate.' },
      { name: 'witness', description: 'Phone-facing. Token-authenticated, scoped to one decision.' },
      { name: 'evidence', description: 'Auditor-facing. Records and the Article 12 export.' },
      { name: 'discovery', description: 'Public. Trust roots and machine-readable service description.' },
    ],
    components: {
      securitySchemes: {
        x402: {
          type: 'http',
          scheme: 'bearer',
          description:
            'x402 v2. Send `payment-signature`. An unpaid request returns 402 with requirements in the `payment-required` header.',
        },
        witnessToken: {
          type: 'apiKey',
          in: 'path',
          name: 'token',
          description:
            'Opaque 32-byte token from the push deep link. Scoped to one decision, stored hashed, dies with the TTL.',
        },
      },
    },
  },
  // Route schemas are the source of truth; this only wraps them.
  hideUntagged: false,
} as const;
