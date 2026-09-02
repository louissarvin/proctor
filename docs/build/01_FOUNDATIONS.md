# Step 01 — Foundations

**Goal:** dependencies installed and verified on Bun, one env contract, the Prisma schema migrated,
and the server booting with a health check that actually checks things.

**Prize linkage:** none directly. This is the floor everything else stands on.

**Day:** 1 (Sep 4). Budget 2 to 3 hours.

---

## 1. Dependencies

Versions confirmed against the npm registry on **2026-09-02**.

```bash
cd backend

# x402 v2 line. The unscoped `x402-*` packages are v1 and have NO Hedera support, ever.
bun add @x402/core@2.24.0 @x402/fastify@2.24.0 @x402/hedera@2.24.0 \
        @x402/evm@2.24.0 @x402/fetch@2.24.0

# Hedera. @x402/hedera depends on @hiero-ledger/sdk, NOT @hashgraph/sdk.
bun add @hiero-ledger/sdk@2.87.0

# World ID. idkit-core ONLY on the server. @worldcoin/idkit is React and will break Bun's linker.
bun add @worldcoin/idkit-core@4.2.4

# Supporting
bun add zod@^4 viem@^2 argon2 web-push
bun add -d @types/web-push
```

### The pin that prevents a whole class of nonsense

Add to `backend/package.json`:

```json
{
  "resolutions": { "@hiero-ledger/sdk": "2.87.0" },
  "trustedDependencies": ["esbuild", "lightningcss"]
}
```

**Why.** Two copies of the SDK means two `PrivateKey` classes, and every `instanceof` check across
the x402 boundary fails with type errors that make no sense. Bun's isolated linker has no hoisting,
so this bites harder here than on npm.

Verify exactly one copy:

```bash
find node_modules -type d -name "sdk" -path "*hiero-ledger*" | wc -l   # must be 1
```

### Three package traps

| Trap | Symptom | Fix |
|---|---|---|
| `x402-express@1.2.0` or any unscoped `x402-*` | no `hedera:testnet` in `accepts[]`, scheme registration silently does nothing | scoped `@x402/*` v2 only |
| `@hashgraph/sdk` alongside `@hiero-ledger/sdk` | "invalid private key" on an obviously valid key | standardise on `@hiero-ledger/sdk` |
| `@worldcoin/idkit` imported server-side | hard failure under Bun, not in the dependency list | `@worldcoin/idkit-core` on the server |

---

## 2. The env contract

**`config/main-config.ts` is the only module in the repo that reads `process.env`.** This is not
style. It is what makes the mainnet-readiness claim structural: there are zero chain literals in
source, so porting is an env file rather than a refactor.

Extend the existing file:

```ts
// src/config/main-config.ts
import 'dotenv/config';

const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var: ${k}`);
  return v;
};
const opt = (k: string, d = ''): string => process.env[k] ?? d;

// --- existing
export const APP_PORT = Number(opt('APP_PORT', '3700'));
export const NODE_ENV = opt('NODE_ENV', 'development');
export const IS_DEV = NODE_ENV === 'development';
export const DATABASE_URL = req('DATABASE_URL');

// --- Hedera
export const HEDERA_NETWORK = opt('HEDERA_NETWORK', 'testnet');
export const HEDERA_OPERATOR_ID = opt('HEDERA_OPERATOR_ID');
export const HEDERA_OPERATOR_KEY = opt('HEDERA_OPERATOR_KEY');
export const HEDERA_TOPIC_ID = opt('HEDERA_TOPIC_ID');
export const HEDERA_USDC_TOKEN_ID = opt('HEDERA_USDC_TOKEN_ID', '0.0.429274');
export const MIRROR_NODE_URL = opt('MIRROR_NODE_URL', 'https://testnet.mirrornode.hedera.com');
export const HASHSCAN_BASE = opt('HASHSCAN_BASE', 'https://hashscan.io/testnet');

// --- x402. Blocky402 is the DEFAULT, not a fallback. Hedera names it in the prize bullet.
export const FACILITATOR_URL = opt('FACILITATOR_URL', 'https://api.testnet.blocky402.com');
export const FACILITATOR_FALLBACK_URL = opt('FACILITATOR_FALLBACK_URL', 'https://x402.org/facilitator');
export const GATE_PRICE_USD = opt('GATE_PRICE_USD', '0.42');
export const METER_RATE_USD_PER_SEC = opt('METER_RATE_USD_PER_SEC', '0.0021');
export const PAY_TO_HEDERA = opt('PAY_TO_HEDERA');

// --- World
export const WORLD_APP_ID = opt('WORLD_APP_ID');
export const WORLD_RP_ID = opt('WORLD_RP_ID');
export const WORLD_RP_SIGNING_KEY = opt('WORLD_RP_SIGNING_KEY');
export const WORLD_ACTION = opt('WORLD_ACTION', 'proctor-witness-approval');
export const WORLD_VERIFY_URL = opt('WORLD_VERIFY_URL', 'https://developer.world.org');
export const WORLD_ENVIRONMENT = opt('WORLD_ENVIRONMENT', 'staging');
export const WORLD_MODE = opt('WORLD_MODE', 'DEVICE') as 'DEVICE' | 'SELFIE';

// --- policy
export const DECISION_TTL_SECONDS = Number(opt('DECISION_TTL_SECONDS', '60'));
export const METER_MODE = opt('METER_MODE', 'HEDERA') as 'HEDERA' | 'ARC';
```

**Never** hardcode the verify URL, the mirror node, or a chain id anywhere else. Defect C11 in the
audit was exactly this: `verify.ts` hardcoding the World URL while the design promised one env
reader.

---

## 3. Prisma schema

The full design has ~15 models. **Build only what the witness flow needs first.** The rest arrive
with their steps. Premature models are dead weight you will migrate twice.

### 3.1 Fix the generator and datasource first

Current `backend/prisma/schema.prisma` has:

```prisma
datasource db {
  provider = "postgresql"
}
```

Good news: the `url = env("DATABASE_URL")` line is already absent, so **defect A2 does not apply
here**. Prisma 7 wants the URL in `prisma/prisma.config.ts`, which the starter already has. Leave it.

Change the generator to Prisma 7's default so the Bun path works:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}
```

### 3.2 The models for steps 01 to 06

```prisma
enum DecisionState {
  PENDING_PAYMENT   // 402 issued, no valid payment yet
  OPEN              // gate payment settled, not yet dispatched
  DISPATCHED        // witness has it on a phone, TTL running
  APPROVED
  REFUSED
  EXPIRED           // TTL elapsed. THE DEFAULT OUTCOME
  FAILED            // internal error. NEVER releases the agent
}

enum DecisionOutcome { APPROVE REFUSE EXPIRE }
enum WitnessState   { ENROLLED SUSPENDED REVOKED }
enum WitnessMode    { SELFIE ORB_PRESENCE DEVICE_DEV_ONLY }

/// The deployer of the AI system. The party being audited.
model Org {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())

  /// The operator's World ID nullifier. Enrolled ONCE, out of band.
  /// Every witness nullifier is compared against this.
  operatorNullifier  Decimal?  @db.Decimal(78, 0)
  operatorEnrolledAt DateTime?

  apiKeys   ApiKey[]
  witnesses Witness[]
  decisions Decision[]

  @@index([slug])
}

model ApiKey {
  id        String    @id @default(cuid())
  orgId     String
  org       Org       @relation(fields: [orgId], references: [id], onDelete: Cascade)
  hash      String    @unique   // argon2id. Plaintext shown once.
  label     String
  createdAt DateTime  @default(now())
  revokedAt DateTime?

  @@index([orgId, revokedAt])
}

/// The rota. NEVER call it a marketplace.
model Witness {
  id     String @id @default(cuid())
  orgId  String
  org    Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)

  /// Stable World ID pseudonym under the fixed action. Decimal, NEVER a string:
  /// hex casing and 0x-prefix differences silently produce two rows for one witness.
  nullifier Decimal @db.Decimal(78, 0)

  label String
  role  String       @default("standard")
  state WitnessState @default(ENROLLED)

  hederaAccountId String?   // the no-Arc payout path reads this
  circleWalletId  String?
  arcAddress      String?

  pushEndpoint String?
  pushP256dh   String?
  pushAuth     String?

  enrolledAt     DateTime  @default(now())
  lastVerifiedAt DateTime?
  revokedAt      DateTime?

  decisions Decision[]
  proofs    WorldProof[]

  @@unique([orgId, nullifier])
  @@index([orgId, state, role])
}

model Decision {
  id      String  @id @default(cuid())
  orgId   String
  org     Org     @relation(fields: [orgId], references: [id])

  state   DecisionState    @default(PENDING_PAYMENT)
  outcome DecisionOutcome?

  /// The canonical JSON the witness attests to. Stored in full: the Article 12 export
  /// must be human readable.
  preimage     Json
  /// keccak256(utf8(canonical(preimage))). THIS IS THE WORLD `signal`.
  decisionHash String @unique
  /// The single line rendered on the phone.
  humanLine    String
  /// Single-use randomness inside the preimage. Makes two identical payments distinct.
  nonce        String @unique

  requiredRole String @default("standard")

  /// Opaque bearer token in the push deep link. Hashed at rest.
  witnessTokenHash String   @unique
  witnessId        String?
  witness          Witness? @relation(fields: [witnessId], references: [id])

  /// THE CLOCK. Server authoritative. Every TTL decision is made against expiresAt.
  issuedAt     DateTime  @default(now())
  dispatchedAt DateTime?
  expiresAt    DateTime
  respondedAt  DateTime?
  releasedAt   DateTime?

  /// dispatchedAt -> respondedAt in ms. Drives the meter price.
  reviewMs Int?

  proof  WorldProof?
  events DecisionEvent[]

  @@index([orgId, issuedAt(sort: Desc)])
  @@index([state, expiresAt])         // the TTL sweeper's ONLY query
  @@index([witnessId, issuedAt(sort: Desc)])
}

/// Append-only. Every transition, every error, every external call outcome.
/// This is what makes a stuck decision debuggable at 2am on day 8.
model DecisionEvent {
  id         String   @id @default(cuid())
  decisionId String
  decision   Decision @relation(fields: [decisionId], references: [id], onDelete: Cascade)
  at         DateTime @default(now())
  kind       String   // "state.APPROVED", "x402.settle.ok", "world.verify.signal_mismatch"
  detail     Json?

  @@index([decisionId, at])
}

model WorldProof {
  id         String   @id @default(cuid())
  decisionId String   @unique      // <- the CORRECT uniqueness constraint
  decision   Decision @relation(fields: [decisionId], references: [id], onDelete: Cascade)
  witnessId  String
  witness    Witness  @relation(fields: [witnessId], references: [id])

  /// The IDKitResult byte for byte as received. NEVER re-serialised, NEVER normalised.
  /// Published in the export so a third party re-verifies it against World, not against us.
  raw       Json
  rawDigest String   // sha256 of the exact bytes above

  signalHash            String
  identifier            String   // "selfie"
  protocolVersion       String   // "3.0"
  nullifier             Decimal  @db.Decimal(78, 0)
  userPresenceCompleted Boolean  @default(false)
  mode                  WitnessMode

  portalVerifiedAt DateTime   // World's clock, not ours
  receivedAt       DateTime @default(now())

  @@index([nullifier])
}

/// Single-use RP signing nonces. Reuse returns duplicate_nonce.
model RpNonce {
  nonce      String    @id
  action     String
  decisionId String?
  createdAt  DateTime  @default(now())
  expiresAt  DateTime
  usedAt     DateTime?

  @@index([expiresAt])
}
```

### 3.3 Three schema decisions worth defending

**`decisionHash` is `@unique`, not merely indexed.** It is the World `signal`. If two decisions ever
shared a hash, a proof for one would verify against the other. The `nonce` inside the preimage makes
collision impossible; the constraint is the belt to that braces.

**`WorldProof` is unique on `decisionId`, NOT on `(nullifier, action)`.** A witness is *supposed* to
approve many times. A uniqueness constraint on the nullifier would break the rota on the second
decision. This is the same reason the v4 Portal action has no verification cap.

**Nullifiers are `Decimal(78,0)`, never `String`.** Hex casing and `0x`-prefix differences silently
produce two rows for one human. Convert at the boundary, once.

### 3.4 Migrate

```bash
bun run db:generate
# Then ASK THE USER to run the push themselves. Per backend/CLAUDE.md, never run a
# destructive Prisma command on their behalf.
bun run db:push
```

---

## 4. Wire it up

Replace the example route registration in `index.ts`. Keep the existing CORS and worker patterns.

```ts
// index.ts
import { gateRoutes } from './src/routes/gateRoutes.ts';
import { witnessRoutes } from './src/routes/witnessRoutes.ts';
import { worldRoutes } from './src/routes/worldRoutes.ts';

fastify.register(gateRoutes,    { prefix: '/v1/gate' });
fastify.register(witnessRoutes, { prefix: '/v1/witness' });
fastify.register(worldRoutes,   { prefix: '/v1/world' });
```

### `/readyz` is the pre-flight the demo runs at minute zero

Not a stub. It must actually check the four things that can be down:

```ts
fastify.get('/readyz', async (_req, reply) => {
  const checks = await Promise.allSettled([
    prismaQuery.$queryRaw`SELECT 1`,
    fetch(`${FACILITATOR_URL}/supported`).then(r => r.ok),
    fetch(`${MIRROR_NODE_URL}/api/v1/network/nodes?limit=1`).then(r => r.ok),
    fetch(`${WORLD_VERIFY_URL}/api/v4/health`).then(r => r.status < 500),
  ]);
  const names = ['postgres', 'facilitator', 'mirrorNode', 'world'];
  const results = Object.fromEntries(
    checks.map((c, i) => [names[i], c.status === 'fulfilled' && c.value !== false]),
  );
  const ok = Object.values(results).every(Boolean);
  return reply.code(ok ? 200 : 503).send({ success: ok, error: null, data: results });
});
```

---

## 5. Definition of done

- [ ] `bun run typecheck` is green
- [ ] Exactly one `@hiero-ledger/sdk` in `node_modules`
- [ ] No unscoped `x402-*` package present
- [ ] `@worldcoin/idkit` (React) is **not** a backend dependency
- [ ] `bun run db:push` applied, tables exist
- [ ] Server boots, `GET /readyz` returns 200 with all four checks true
- [ ] `grep -rn "process.env" src/ | grep -v config/main-config` returns **nothing**
- [ ] Committed in small steps, not one blob

---

## 6. Spikes to run before this step (day 0, in `/tmp`, never committed)

```bash
# The Hedera leg is viable? Answered in under a minute.
curl -s https://api.testnet.blocky402.com/supported | jq '.kinds[] | select(.network=="hedera:testnet")'
# ALREADY VERIFIED 2026-09-02: exact, feePayer 0.0.7162784. GREEN.

# Testnet alive and on a recent version?
curl -s "https://testnet.mirrornode.hedera.com/api/v1/blocks?limit=1&order=desc" | jq .blocks[0].hapi_version

# USDC token id is real?
curl -s https://testnet.mirrornode.hedera.com/api/v1/tokens/0.0.429274 | jq '{token_id,symbol,decimals,deleted}'
```

Then, at https://portal.hedera.com, and this order matters:

1. Create **two ECDSA** testnet accounts (agent, service). **Not ED25519** — it has no EVM alias and
   the Hedera Harness Tier requires ECDSA.
2. Fund both from the faucet.
3. **Complete each hollow account** with one trivial transaction as fee payer. A faucet-funded
   account is hollow: it can receive but **cannot pay**, so your first x402 payment fails. Ten
   seconds if you know, an hour if you do not.
4. Associate both with USDC `0.0.429274`, or set `maxAutomaticTokenAssociations = -1`.
5. Subscribe to https://status.hedera.com/ and confirm **no testnet reset is announced for Sep 4-13**.
   A reset mid-event is unrecoverable.
