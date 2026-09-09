# World ID feedback, ETHOnline 2026, from the Proctor build

Every item is dated, reproducible, and cites the page or file it came from.
Written as we hit each one, not reconstructed afterwards.

App: `app_e179f4985c290220a5598b841fd5e3da` · RP: `rp_4d44df4ba311add1`
SDK: `@worldcoin/idkit-core@4.2.4`

---

## 1. Selfie Check docs and integration flow

### 1.1 The docs contradict each other on nullifier stability, and it changes an integrator's design
*2026-09-02*

- [`/world-id/idkit/integrate`](https://docs.world.org/world-id/idkit/integrate): *"The same person verifying the same action always produces the same nullifier."*
- [`/world-id/4-0-migration`](https://docs.world.org/world-id/4-0-migration): *"In 3.0, many RPs treated nullifiers as persistent user identifiers. In 4.0, nullifiers are one-time-use, and `session_id` is the stable link across requests."*

These cannot both be true. We read the migration guide as the correction because it is
version-qualified, but nothing on the integrate page says it applies to 3.0 only.

**Why it mattered to us.** Our core security property is *the approving witness is not the
operator*, enforced by comparing nullifiers. That comparison is **meaningful on a v3 credential
and silently meaningless on a v4 uniqueness proof**, where two proofs from the same account
produce different nullifiers, so `witness !== operator` always passes. An integrator who reads
only the integrate page ships a check that looks like it works and does not.

**Suggestion:** version-qualify the sentence on the integrate page, and add one line naming
`session_id` as the v4 replacement.

### 1.2 `IDKitResult.environment` and the verify API disagree on valid values
*2026-09-03*

The shipped SDK type says:

```ts
/** The environment used for this request ("production", "staging", or "sandbox") */
environment: string;
```
`node_modules/@worldcoin/idkit-core/dist/index.d.ts`

The API reference for `POST /api/v4/verify/{rp_id}` documents `environment` as
`"production" | "staging"`, default `"production"`. **`sandbox` is absent.**

Since the Selfie Check track requires using the Sandbox App, an integrator cannot tell from the
docs whether `sandbox` is a valid verify-time environment.

### 1.3 `environment` is documented as an enum but is not validated
*2026-09-03*

```bash
curl -X POST https://developer.world.org/api/v4/verify/rp_4d44df4ba311add1 \
  -H 'content-type: application/json' \
  -d '{"protocol_version":"3.0","nonce":"0x00","action":"proctor-witness-approval","environment":"nonsense","responses":[]}'
# -> {"code":"validation_error","detail":"At least one response item is required","attribute":"responses"}
```

`"nonsense"` passes environment validation. `production`, `staging`, `sandbox` and garbage all
produce the same next error. If the enum is real, rejecting an unknown value with
`attribute: "environment"` would save an integrator a lot of guessing.

### 1.4 The only non-deprecated path for a new integration is access-gated
*2026-09-05*

`idkit/credentials` marks `deviceLegacy` **Deprecated**, verbatim:

> **Deprecated.** Keep `deviceLegacy` only for existing Device integrations. For new
> integrations, use [Selfie Check (Beta)](#selfie-check-beta).

Selfie Check is then gated on the same page:

> [Request access](mailto:developers@toolsforhumanity.com) to enable Selfie Check (Beta)
> for your app.

So a new integrator who wants a low-friction credential and has no World point of contact
is told to stop using the one preset available to them and adopt one they cannot enable.
The remaining legacy presets do not fill the gap: `orbLegacy`, `documentLegacy` and
`secureDocumentLegacy` all require the user to already hold a stronger credential, which
is the exact friction `deviceLegacy` and Selfie Check exist to avoid.

This is a docs problem rather than a product one, and it is cheap to fix: say on the
credentials page what a new integration should build against *while* an access request is
pending, and whether shipping on a deprecated preset is acceptable in the interim.

**What we did.** Built against `selfieCheckLegacy` with the preset behind one variable,
and run on `deviceLegacy` until the flag arrives. We added `require_user_presence` to the
fallback so the request still carries a liveness step, because `device` alone proves
possession of a phone rather than the presence of a person, and liveness is the property
our product rests on. That mitigation was not obvious from the credentials page, which
documents `require_user_presence` only in a parameters table two sections below the preset
list, without noting that it is what makes a legacy preset carry presence at all.

### 1.5 `require_user_presence` is documented as a parameter, not as the liveness control
*2026-09-05*

It appears once, in the "Common parameters" table:

> `require_user_presence` — Optional liveness step. Defaults to `false`.

Nothing on the page connects it to the question an integrator is actually asking, which is
"which of these presets tells me a human was present, and how do I ask for that?". The
answer is that most presets do not, and this flag is how you add it. `user_presence_completed`
appears in the v3, v4 **and** session response shapes, so it works with legacy presets, but
we only established that by reading the three response examples in `idkit/integrate` side by
side. One sentence on the credentials page would have saved that.

---

### 1.6 `deviceLegacy` is deprecated for new integrations, and nothing says so at runtime
*2026-09-09*

`/world-id/idkit/credentials` marks `deviceLegacy` **Deprecated**, with:

> "Keep `deviceLegacy` only for existing Device integrations. For new integrations, use
> Selfie Check (Beta)."

We are a new integration, so the device credential is not obtainable. What is missing is
any runtime signal saying so. The request does not return `credential_unavailable`; it
returns `generic_error` with an empty payload (§2.5), which is indistinguishable from a
network fault or a bad key.

Combined with §1.4, the path for a new integrator is: the non-deprecated option is
access-gated, the deprecated one silently cannot succeed, and the error names neither.

## 2. Developer Portal navigation, search, product discovery, and debugging guidance

### 2.1 `docs.world.org` serves clean markdown for any route, and an LLM index, and advertises neither
*2026-09-02*

Appending `.md` to any docs route returns clean markdown, and there is a full index at
[`/llms.txt`](https://docs.world.org/llms.txt). Nothing on the site links to or mentions either.

This is the single best discovery affordance the docs have and it is invisible. One line in the
footer would surface it.

### 2.2 A v4 action exposes only two fields, but the docs describe per-action environments
*2026-09-03*

`SKILL.md` states actions define *"what credential the user proves and **in which environment**"*
and advises: *"Create separate actions for simulator testing and production QA if both are
needed."*

In the live Portal, creating an action (`action_v4_...`) offers **only** `Identifier` and
`Short description`. There is no environment selector and no maximum-verifications field. The
documented two-action pattern is not constructible, and an integrator following it will look for
a control that does not exist.

### 2.3 Nothing tells you whether a credential is enabled for your app
*2026-09-09*

Selfie Check is access-gated per app. There is no way to ask whether the flag is on.

We looked: the Portal serves HTML rather than JSON for app and RP routes, and
`POST /api/v4/verify/{rp_id}` answers (so the RP is clearly live and registered) but says
nothing about which credentials that app may request. The only way to discover the answer
is to put the preset in front of a real user on a real phone and see what happens.

That turns a config question into a field test. A single read-only field on the app page —
"Selfie Check: enabled / not enabled / requested" — would close it. As it stands, an
integrator building against a gated credential cannot distinguish "not enabled yet" from
"enabled, and my integration is wrong", which are very different debugging paths.

### 2.4 Sandbox enrolment is team-scoped, and that is mentioned once, parenthetically
*2026-09-09*

From the access guide: *"Enrollment is tied to a team, so open the sandbox panel from
within a team."*

That is the whole warning. An account viewing the panel outside a team context sees a form
that looks functional and submits into nothing obvious. Given that the panel is now the
primary access route, this deserves to be a callout rather than a subordinate clause —
it is the difference between a request that queues and a request that does not.

---

### 2.5 BLOCKER: a bundler failure is reported as `generic_error` with an empty object
*2026-09-09*

This cost us most of a day, and the cause was three lines away in the browser console.

IDKit ships a wasm-bindgen binary. Under **Vite** — the default React toolchain — the
dependency optimiser rewrites the package's JS into `.vite/deps` but does **not** copy
`idkit_wasm_bg.wasm` beside it:

```
GET /node_modules/.vite/deps/idkit_wasm_bg.wasm   404
Failed to initialize IDKit WASM:
  TypeError: Failed to execute 'compile' on 'WebAssembly': HTTP status code is not ok
```

What the integrator receives:

| Layer | What it says |
|---|---|
| `onError` | `generic_error` |
| debug log | `[IDKit] Flow error: {}` — an **empty object** |
| the witness | "Something went wrong. Please try again." |

**Every credential fails identically**, because the SDK never initialises and no
credential is ever requested. We changed `environment`, rotated the signing key, switched
`deviceLegacy` → `proofOfHuman` → `selfieCheckLegacy`, moved to HTTPS, and re-checked the
action — all reasonable, all irrelevant, because the error pointed at none of it.

The fix is one line of integrator config:

```ts
// vite.config.ts — idkit-core ONLY. Excluding the React wrapper too leaves its
// CJS dependency `qrcode` unconverted: "does not provide an export named 'default'".
optimizeDeps: { exclude: ['@worldcoin/idkit-core'] }
```

Three asks, in order of value:

1. **Detect it.** A WASM init failure is a distinct, detectable condition. Surface it as
   its own error code rather than folding it into `generic_error`.
2. **Never report an empty object.** `Flow error: {}` is strictly worse than no log: it
   says the SDK knows something failed and has nothing to say about it.
3. **Document the Vite config.** One line in the integration guide removes this entirely
   for what is likely the most common React toolchain among your integrators.

Related: the SDK already computes 26 specific codes (`credential_unavailable`,
`invalid_rp_signature`, `unknown_rp`, `rp_signature_expired`, `user_presence_failed`,
`world_id_4_not_available`, ...). We only learned they existed by running `strings` over
`idkit_wasm_bg.wasm`. None of them reached us.

## 3. Sandbox App states, proof flows, test users, errors, and edge cases

> **Scope note, stated plainly.** Everything below is about *reaching* Sandbox, because
> as of 2026-09-09 we never got in: the enrolment request for `capinho77@gmail.com` is
> still pending. We therefore cannot report on states, proof flows, test users or edge
> cases from the inside, and we are not going to invent observations we did not make.
>
> That gap is itself the finding. A developer who follows the documented path can spend a
> week without reaching the first testable screen, and nothing in the flow distinguishes
> "queued" from "went nowhere". The items below are the obstacles that consumed that week.


### 3.1 BLOCKER: iOS Sandbox enrollment silently requires an email-based Portal account
*2026-09-02*

A Developer Portal account created via **World ID sign-in** cannot request iOS enrollment. The
form rejects with:

> An email-based portal account is required to request iOS enrollment.

The message is accurate but appears **nowhere in the documentation**, and the error string
returns zero search results. There is no documented way to add an email credential to an existing
account or to convert account type. We resolved it by moving to an email-based account.

**This was the single most expensive item in our integration**, precisely because there was
nothing to search for. One sentence on the sandbox access page would remove it entirely.

### 3.2 Selfie Check access and Sandbox App access are two separate gates, on two different domains
*2026-09-02*

- Selfie Check feature flag: `developers@toolsforhumanity.com`
- Sandbox App access: `sandbox.access@toolsforhumanity.org`

Note `.com` versus `.org`. Nothing on the docs site states these are different requests, and the
sandbox page's *"request access through your World point of contact"* does not distinguish them.
We initially assumed one request covered both.

**Update 2026-09-09:** the `.org` address does not merely differ from the `.com` one — the
domain is **unregistered** and mail to it bounces. See §3.7.

### 3.3 The Google Form predates the current distribution setup
*2026-09-02*

`https://forms.gle/mqbaiwMvX5MzmKdY8` is titled *"World ID Sandbox Beta Access Request"* and says
it grants **Firebase App Distribution** access. The docs say iOS is **TestFlight** and Android is
a private Google Play track. The form appears stale.

### 3.4 TestFlight's redeem-code prompt is a dead end for this flow
*2026-09-02*

With no betas installed, TestFlight shows a redeem-code prompt. The World flow issues no code:
approval is by email and the build then appears automatically. Minor, but it cost us time looking
for a code that does not exist. Worth one line in the iOS steps.

---

### 3.5 The access instructions we followed were stale, and nothing said so
*2026-09-09*

We requested Sandbox access on 2026-09-02 through the `forms.gle` form titled "World ID
Sandbox Beta Access Request" and by email, and heard nothing for seven days.

The current documented process is neither of those. `/world-id/sandbox/sandbox-access`
describes a **self-service panel in the Developer Portal** — *"select World ID Sandbox
from the sidebar, choose the iOS tab, and submit the Apple Account email"* — with a
separate Android flow in the same panel.

The form still exists, still accepts submissions, and still returns a confirmation. From
the requester's side, a request that goes nowhere and a request that is queued look
identical. Retiring the form, or adding one line pointing at the Portal panel, would have
saved a week on a nine-day event.

Related: the enrolment being **tied to a team** is stated once, parenthetically. An account
with no team selected has a sandbox panel that appears to work and produces nothing.

### 3.6 `environment: sandbox` is correct in IDKit and undocumented at the verify endpoint
*2026-09-09*

`/world-id/sandbox/sandbox-access` says to set `environment: sandbox` in IDKit and send the
proof to the **production** verify endpoint. Those two not moving together is the
non-obvious part, and it is stated only once.

Meanwhile the verify API reference (§1.2) lists `environment` as `production | staging`
with `sandbox` absent, and the endpoint accepts any string without validating it (§1.3).
So the value the sandbox guide tells you to send is the one the API reference says does not
exist, and nothing rejects a typo either way.

### 3.7 BLOCKER: the documented Sandbox Support address is at a domain that does not exist
*2026-09-09*

`/world-id/sandbox/sandbox-access` ends its iOS troubleshooting with the escalation path:

> *"If your request was rejected or your access was revoked, submitting the same email
> again won't create a new request. Contact Sandbox Support at
> **sandbox.access@toolsforhumanity.org**."*

**That domain is unregistered.** Not misconfigured, not missing an MX record — it does not
resolve at all, and it is not in the registry:

```console
$ dig +short NS toolsforhumanity.org       # (also A, MX, SOA)
                                            # ← empty
$ whois toolsforhumanity.org
Domain not found.

$ dig +short MX toolsforhumanity.com
1 smtp.google.com.                          # the real domain, live
```

The company domain is **`.com`**. The docs say `.org`. Mail to it bounces with
`Address not found ... because the domain toolsforhumanity.org could not be found`.

Three reasons this is worse than a typo:

1. **It is the escalation path for the one state you cannot self-serve out of.** The
   sentence is specifically for developers who were *rejected or revoked*, for whom the
   docs have just explained that resubmitting does nothing. Their only documented action
   is undeliverable, so a recoverable state becomes a dead end.
2. **The bounce blames the sender.** Gmail's message asks the user to *check for typos or
   extra spaces*. A developer who copied a `mailto:` link out of official docs will assume
   they fumbled the paste and retype it, rather than report a docs bug. That is likely why
   this has survived.
3. **An unregistered domain is registrable by anyone.** Developers are being directed to
   send app ids, RP ids and Apple Account emails there. Today it bounces; if someone
   registers it, it does not. Worth a defensive registration regardless of the docs fix.

Reproducing costs one command, which suggests no automated link-checking covers `mailto:`
targets in the docs. The `https://` links on the same page all resolve.

**Fix:** change `.org` to `.com` in `sandbox-access`, and grep the docs corpus for other
`@toolsforhumanity.org` addresses.

### 3.8 The 300s RP signature TTL is shorter than the flow it authorises
*2026-09-09*

`signRequest` defaults to `ttl: 300`. That is the window for the whole human journey:
read the request, open the World App, scan a code, complete a selfie, return.

Our first successful Selfie Check produced a valid proof that arrived **7m43s** after the
signature was minted. World issued the proof and the app confirmed
*"You've successfully connected your World ID"* — and it was unusable, because the nonce
had expired three minutes earlier.

Mostly our bug: mint on commit, not on page load, and the window is ample. But two things
would have made it obvious:

- The default is documented as a number, not as a **budget for a human being**. One
  sentence — "this must cover the user's entire journey, including installing or opening
  the app" — would have set the expectation.
- Nothing in the returned proof indicates the signature it was issued against has expired.
  The RP discovers it only when its own check fails.

## 4. What was confusing, missing, broken, or hard to test

| # | Item | Impact |
|---|---|---|
| 1 | §3.1, the undocumented email-account requirement | **blocker**, unbounded time cost |
| 2 | §1.1, contradictory nullifier stability | **security-relevant**, changes the design |
| 3 | §3.2, two gates on two TLDs, undocumented | hours |
| 4 | §2.2, documented per-action environments that do not exist | confusion |
| 5 | §1.2 / §1.3, `environment` disagreement and non-validation | guesswork |
| 6 | No documented turnaround for either access gate | unplannable on a 9-day event |
| 7 | §1.4, the only non-deprecated low-friction preset is access-gated | **no clean path** for a new integration |
| 8 | §1.5, `require_user_presence` not presented as the liveness control | shipped without liveness by default |
| 9 | §3.5, the access form is stale but still live, and a dead request is indistinguishable from a queued one | **a week lost on a nine-day event** |
| 10 | §3.6, `environment: sandbox` is required by one page and absent from the API reference | guesswork at the one step you cannot test without |
| 11 | §2.3, no way to query whether a gated credential is enabled for your app | cannot separate "not enabled" from "my integration is wrong" |
| 12 | §2.4, team-scoped enrolment stated only as a subordinate clause | a request that silently does not queue |

**The one thing we would most want:** an "access" page that lists every gate, which channel opens
it, and a rough turnaround. All three of our access problems were about *which door to knock on*,
not about the product.

---

## 5. What is genuinely good  (unrequested, included anyway)

- **`signRequest` is pure JS with no WASM.** It ran under Bun with zero configuration on the first
  attempt. The docstring even names the Rust function it matches
  (`compute_rp_signature_msg` in `world-id-primitives`) and links the exact source line for nonce
  generation. That is unusually good provenance.
- **The shipped `.d.ts` files are excellent.** `issuer_schema_id` is documented inline
  (`1=proof_of_human, 11=selfie, 9303=passport, 9310=mnc`), and `signal_hash` is correctly typed
  as optional, which caught a real bug in our verifier at compile time.
- **`hashSignal` is exported from a subpath** rather than buried, so binding a proof to an
  application-specific value is a two-line change. This is the mechanism our whole product rests
  on and it was the easiest part of the integration.
- **Presets are a better API than `verification_level`.** `selfieCheckLegacy({ signal })` reads
  clearly and made our credential swap a single variable.
- **The 4.0 migration guide is direct about what broke.** Stating plainly that v2/v3 samples will
  not work saved us from trusting older material.
