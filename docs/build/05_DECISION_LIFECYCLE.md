# Step 05 — Decision lifecycle and the 60-second clock

**Goal:** a decision state machine that **fails closed**, with one atomic arbiter for every
transition, and a sweeper that cannot race the approver.

**Prize linkage:** indirect but load-bearing. The countdown is on camera, and "default refuse" is a
real security property a judge can check.

**Day:** 4 (Sep 7). Budget 4 hours. **Also measure Web Push today, not on day 8.**

---

## 1. States

```
PENDING_PAYMENT --402 settled--> OPEN --dispatch--> DISPATCHED
                                                      |
                        +-----------------------------+------------------+
                        v                     v                          v
                    APPROVED              REFUSED                    EXPIRED
                  (proof verified)   (explicit, no proof)     (TTL elapsed, THE DEFAULT)

FAILED = internal error. NEVER releases the agent.
```

**The default outcome is EXPIRE, and EXPIRE does not release the agent.** If Proctor is down, an
agent stays blocked. Fail closed is the whole point; an oversight gate that fails open is worse than
no gate, because it produces evidence of oversight that did not happen.

---

## 2. The clock

**The server clock is authoritative. Always.** `expiresAt` is set once, at dispatch, and every
decision is made against it.

The phone gets `serverNow` in the decision payload and renders its countdown as an offset from that,
never from the device clock. A witness with a skewed phone must not be able to approve at second 71.

```ts
type WitnessDecisionResponse = {
  decisionId: string;
  humanLine: string;       // "Release EUR 41,200 to Meridian Logistics?"
  signal: string;          // = decisionHash, passed into the IDKit preset
  expiresAt: string;
  serverNow: string;       // countdown renders against OUR clock
  preimage: Record<string, unknown>;  // so a suspicious witness can expand the one line
};
```

---

## 3. ONE atomic arbiter for every transition

Every transition is a single conditional UPDATE. No read-then-write, no transaction gymnastics, no
Redis.

```ts
// Approve. Succeeds ONLY if still DISPATCHED and still inside the TTL.
const updated = await prismaQuery.decision.updateMany({
  where: { id, state: 'DISPATCHED', expiresAt: { gt: new Date() } },
  data: {
    state: 'APPROVED', outcome: 'APPROVE',
    respondedAt: new Date(),
    reviewMs: Math.round(Date.now() - dispatchedAt.getTime()),
  },
});
if (updated.count === 0) {
  // Lost the race. Either the sweeper expired it or it was already answered.
  return handleError(reply, 409, 'Already resolved', 'ALREADY_RESOLVED');
}
```

```ts
// The sweeper. Its ONLY query, and it is index-backed.
await prismaQuery.decision.updateMany({
  where: { state: 'DISPATCHED', expiresAt: { lte: new Date() } },
  data: { state: 'EXPIRED', outcome: 'EXPIRE', respondedAt: new Date() },
});
```

**Because both are conditional updates on the same row, the sweeper cannot beat an in-flight
approver and vice versa.** Postgres arbitrates. Exactly one wins. `@@index([state, expiresAt])`
exists for the sweeper's query specifically.

**Write the race tests on day 4, not day 7.** Fire an approve and a sweep concurrently, a hundred
times, and assert exactly one wins and the row is never left inconsistent.

---

## 4. Worker, following the starter's pattern

```ts
// src/workers/ttlSweeper.ts
import cron from 'node-cron';
let isRunning = false;

const sweep = async (): Promise<void> => {
  if (isRunning) { console.log('[TTLSweeper] previous run active, skipping'); return; }
  isRunning = true;
  try { /* the updateMany above, then emit DecisionEvent rows */ }
  catch (e) { console.error('[TTLSweeper] Error:', e); }
  finally { isRunning = false; }
};

export const startTtlSweeper = (): void => {
  console.log('[TTLSweeper] Scheduled');
  cron.schedule('* * * * * *', sweep);   // every second: the TTL is 60s
  sweep();
};
```

Register in `index.ts` alongside `startErrorLogCleanupWorker()`.

---

## 5. DECIDE THE EXPIRE METERING POLICY ONCE

Three sections of the original design contradict each other, and the sweeper never writes
`reviewMs`, so an expired decision meters at `$0.000000` and **throws**.

**Recommended, pick it and never revisit:**

> **EXPIRE meters to zero.** Settles nothing. `meterPayment: null`. `mtr.s = "0"`.
> **And the README says why.**

The reason is defensible: the agent paid the fixed fee to *interrupt*. It consumed no human
attention, so it owes nothing for attention. **Write that sentence down.** An auditor reading a $0
meter on an expiry should find the explanation, not a bug.

---

## 6. Witness dispatch

Select from the pool by `requiredRole` and `state = ENROLLED`, then Web Push.

**Bind the payer.** Assert `releasePayer === gatePayment.payer`, else `403 payer_mismatch`. Nothing
in x402 binds the two calls together; do it yourself, or one agent can pay to open a decision and
another can collect the outcome.

### Measure push TODAY, day 4

**Web Push delivery is the largest variance in the demo budget**, and the original plan first
measured it on day 8, which is far too late.

- 30 samples, record p50 and p95
- Benchmarks that exist (APNs p50 66ms, FCM p50 99ms) measure **API acceptance, not delivery**
- On an awake, unlocked, screen-on device the last hop is typically sub-second. On a sleeping or
  backgrounded device it is **unbounded**
- **This is why "unlocked, screen on, DND off" is a demo requirement, not a nicety**
- **If p95 > 2s, build the WebSocket fallback on day 5**

---

## 7. Definition of done

- [ ] All seven states reachable, every transition writes a `DecisionEvent`
- [ ] Race test: concurrent approve vs sweep, 100 iterations, exactly one wins every time
- [ ] Second 61 is a hard refuse. No approval is ever accepted after `expiresAt`
- [ ] A skewed client clock cannot approve late
- [ ] EXPIRE policy implemented as decided, and the README paragraph written
- [ ] Push p50/p95 measured over 30 samples and **written down**
- [ ] `payer_mismatch` enforced between the gate and release calls
- [ ] Proctor being down leaves the agent blocked, never released
