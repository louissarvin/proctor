# World ID Selfie Check: Access Runbook

Everything needed to go from zero to a working Selfie Check integration, in order.
Verified against live docs on 2026-09-02.

**Why this is urgent:** Selfie Check is a single-seat, winner-takes-all $3,500 track. Access has
**no documented turnaround time** anywhere. It is the only hard external blocker in the project.
Nothing else in Proctor waits on a third party. Send the requests before you write any code.


---

## STATUS (update as you go)

| Gate | State | Date | Note |
|---|---|---|---|
| 1b. Email-based portal account | **DONE** | 2026-09-02 | Was blocking iOS enrollment, see §4.0 |
| 3. Sandbox App, iOS | **PENDING** | 2026-09-02 | Enrollment submitted for `capinho77@gmail.com`. Awaiting approval email, then appears in TestFlight |
| 1. App / `rp_id` / signing key | **DONE** | 2026-09-02 | `app_e179f4985c290220a5598b841fd5e3da` / `rp_4d44df4ba311add1`. Key stored in `backend/.env`, shape verified, no leak into `web/` |
| 1c. Action | **DONE** | 2026-09-02 | `proctor-witness-approval` (`action_v4_...`). One action only, see §1.3 |
| 2. **Selfie Check (Beta) flag** | **SENT, AWAITING** | 2026-09-02 19:22 | Emailed `developers@toolsforhumanity.com` from capinho77@gmail.com. Copy in `docs/selfie-check-email.txt`. **Chase on Telegram if no reply by Sep 4.** |

**All gates are now requested or granted. Nothing external is left to do.**
Remaining follow-ups: post the same request to Telegram (§3), and chase if there is no reply by
Sep 4. Build proceeds against the simulator in the meantime (§5); the Selfie Check swap is one
variable.

---

## DO THIS NOW, in order

Total about 35 minutes. Item 2 is the one that unblocks everything else, because the Selfie Check
email cannot be sent without `app_id` and `rp_id`.

### 1. Install TestFlight on the iPhone — 2 min
App Store → TestFlight. Do it now, not when the approval email arrives. The approval is useless
without it, and you do not want this step happening on demo day.

**Do not open production World App and enrol in Selfie Check there.** When the Sandbox build lands,
your enrolment must happen **inside the Sandbox app**. Enrolling in the wrong app is a documented
full-evening loss.

### 2. Create the app in the Portal — 15 min — **THIS IS THE BLOCKER**
Work §1.1 → §1.2 → §1.3 in order. Three things that cannot be undone:

- **`app_mode: external`.** Immutable. `mini-app` locks you out of IDKit entirely.
- **Save `signing_key.private_key` the instant it appears.** Returned exactly once, never
  recoverable. Straight into `backend/.env` as `WORLD_RP_SIGNING_KEY`. Not into chat, not into a
  note "for later".
- **Create both actions**, `proctor-witness-approval` on `staging` **and** on `production`.

Come out of this with `app_id`, `rp_id`, and the key stored.

### 3. Send the Selfie Check email — 5 min — **the $3,500 gate**
§3, to `developers@toolsforhumanity.com`. Paste your `app_id` and `rp_id` into the template.

This is the **longest-lead item in the entire project** and it has no documented turnaround. Gate 3
being pending does not help you here; it is a different gate to a different address. Send it the
moment step 2 gives you the IDs.

### 4. Post the same thing to Telegram — 2 min
https://t.me/worlddevelopersupport. For a nine-day event this is plausibly faster than email and
costs nothing to do in parallel.

### 5. Belt and braces on the Sandbox app — 5 min
Your iOS enrollment is pending, which is good, but nothing here publishes a turnaround. Run the
other two channels too:
- Email `sandbox.access@toolsforhumanity.org` (§4.3) — note **`.org`**
- Submit https://forms.gle/mqbaiwMvX5MzmKdY8 — ten seconds
- Try the public TestFlight link https://testflight.apple.com/join/VZEurhHe — if it lets you in,
  you have skipped the wait entirely

### 6. Start `WORLD_FEEDBACK.md` — 5 min
Create the file with the five headings from §8 and paste in the five entries you already have.
Date them **today**. It is a scored deliverable on a single-seat track and it is the only one that
is pure effort rather than product. Reconstructing it on day 8 is much harder than appending to it
as you go.

### 7. Then start building — no access required
Everything above is waiting on other people. Nothing below is. The simulator at
https://simulator.worldcoin.org/ works against your `staging` action **right now**, with
`deviceLegacy`, with no flag and no sandbox app. Build the whole witness flow there and the Selfie
Check swap later is one variable (§5).

---

### Outside this runbook, but more urgent than any of it

- **Apply to ETHOnline. Thu Sep 3, 11:59pm EDT.** Every member applies and stakes ETH
  **individually**. This is the only truly irreversible deadline in the project and it is tomorrow.
- **`git init` and commit.** There is still no repository anywhere. Missing or single-commit history
  is a stated ETHGlobal disqualification criterion, and every hour of work without it makes the
  history look worse.

---

## 0. The three gates

There is no self-serve route to Selfie Check of any kind. **Four** separate things must happen, and
they have different contacts. Requesting one does not grant the others.

| # | Gate | Self-serve? | Contact |
|---|---|---|---|
| 1 | App, `rp_id`, action, signing key | **Yes** | https://developer.world.org |
| 1b | **An email-based portal account** (required for iOS enrollment) | Maybe, see §4.0 | `sandbox.access@toolsforhumanity.org` |
| 2 | **Selfie Check (Beta) feature flag** on your app | No | `developers@toolsforhumanity.com` |
| 3 | **Sandbox World ID App** (the phone build) | No | `sandbox.access@toolsforhumanity.org` |

Verbatim, from the docs:

> "A valid app or action does not imply Selfie Check access."
> — https://docs.world.org/world-id/SKILL.md

> "Selfie Check (Beta) must be enabled for your app before you can test it. To enable the feature
> flag, request access through your World point of contact."
> — https://docs.world.org/world-id/sandbox/testing-selfie-check.md

**Sandbox does not bypass the flag.** Enabling the flag is a *prerequisite* for testing in sandbox,
not an alternative to it.

### Two traps in the contacts

1. **The two emails are on different TLDs.** `developers@toolsforhumanity`**`.com`** for the flag,
   `sandbox.access@toolsforhumanity`**`.org`** for the sandbox app. Easy to typo, and a bounce costs
   you a day of lead time.
2. **The Google Form is not the Selfie Check request.** `https://forms.gle/mqbaiwMvX5MzmKdY8` is
   titled *"World ID Sandbox Beta Access Request"* and has exactly one field, Email. It opens gate 3
   only. Submit it anyway, it costs ten seconds, but do not treat it as having requested Selfie Check.

---

## 1. STEP 1 — Create the app (do this first, the emails need the IDs)

Go to **https://developer.world.org** and sign in.

### 1.1 Create the App

**`app_mode` is immutable after creation. Choose `external`.**

> "Note: `app_mode` is immutable after creation — choosing `mini-app` locks you out of IDKit support."

Proctor is an IDKit web app (a PWA the witness opens from a push link), **not** a Mini App. If you
pick `mini-app` your only fix is to create a new app and re-request the flag against the new
`app_id`, which restarts the lead time. Get this right the first time.

- [ ] App created with `app_mode: external`
- [ ] Note the `app_id` (`app_...`)

### 1.2 Configure World ID (this mints the RP)

Click **"Configure World ID"**, or the "Enable World ID 4.0" banner. This does two things at once:

1. Mints the **RP (relying party)** and returns your `rp_id` (`rp_...`)
2. Returns `signing_key.private_key` **exactly once**

> **CRITICAL:** "never sign on the client. Never expose `RP_SIGNING_KEY` as a `NEXT_PUBLIC_*` var.
> Never log it."

The Portal does not recover lost keys. If you lose it, your only option is rotation, which
invalidates the old signer and forces a redeploy.

**Copy the private key into your secret store in the same motion as reading it.** Do not close the
tab, do not "come back to it", do not paste it into chat. Straight into `backend/.env`.

- [ ] `rp_id` noted
- [ ] `signing_key.private_key` saved to `backend/.env` as `WORLD_RP_SIGNING_KEY`
- [ ] Verified it is **not** in any `VITE_*` or client-visible variable

### 1.3 Create ONE action

**CORRECTED 2026-09-02 against the live Portal.** Earlier guidance here said to create two actions,
one per environment. That is wrong for World ID 4.0.

The v4 action creation form and detail page expose **only two fields**: `Identifier` and
`Short description`. There is **no environment selector and no maximum-verifications setting.**
Actions are minted as `action_v4_...` and carry neither.

So:

- **Create one action**, identifier `proctor-witness-approval`
- Environment is controlled **entirely by the IDKit `environment` prop** and the matching backend
  variable, not by the action
- There is **no per-person verification cap to worry about**. A witness can approve many decisions,
  which is exactly what the rota model needs

Set the **Short description** to something human-readable, e.g.
*"Witness approval for a held AI agent decision"*. It can surface on the World App consent screen
that the witness sees, which is **on camera during the demo**. A slug there reads badly.

- [x] Action `proctor-witness-approval` created

**This contradicts the docs.** `SKILL.md` states actions define *"what credential the user proves
and in which environment"* and advises *"Create separate actions for simulator testing and
production QA if both are needed."* Neither is possible in the current UI. Logged as feedback
entry 6.

**Note on `sandbox`:** the docs' own environment table lists only `staging` and `production`. Our
audit found the live verify-endpoint request enum is also `production | staging` only. So
`environment: "sandbox"` may not be accepted by `POST /api/v4/verify/{rp_id}`. See section 6.

### 1.4 Optional but worth 20 minutes: the Developer Portal MCP

Endpoint `https://developer.world.org/api/mcp`, transport `streamable-http`,
auth `Authorization: Bearer api_<base64(id:secret)>` using a Developer Portal team API key.

| Tool | What it does |
|---|---|
| `get_team_context` | list apps |
| `get_app_config` | retrieve app details |
| `configure_world_id` | mint the RP, return the signing key |
| `create_world_id_action` | create or update actions |
| `get_world_id_signing_key` | read the signer **address** (never the private key) |
| `rotate_world_id_signing_key` | invalidate old, return new |
| `get_world_id_registration_status` | `pending` vs `registered` |

`get_world_id_registration_status` is the reason to bother. It is the **only** way to see whether
your RP's on-chain registration has flipped from `pending` to `registered`. Production verification
returns `not_registered` until it does. Start polling on day 1 so the wait is not on day 8.

---

## 2. STEP 2 — Record the values

`backend/.env` (server only, never committed):

```bash
WORLD_RP_SIGNING_KEY=      # the once-only private key from 1.2
WORLD_APP_ID=app_
WORLD_RP_ID=rp_
WORLD_ACTION=proctor-witness-approval
WORLD_VERIFY_URL=https://developer.world.org
WORLD_ENVIRONMENT=staging  # flip to production when the RP is registered
```

`web/.env` (client, safe to expose):

```bash
VITE_WORLD_APP_ID=app_
VITE_WORLD_ENVIRONMENT=staging
VITE_API_URL=http://localhost:3700
```

**The signing key never appears in `web/`.** If it does, anyone can forge proof requests from your app.

Three things must always agree: the action's environment in the Portal, the IDKit `environment` prop,
and whether you are scanning with the simulator or a real app.

---

## 3. STEP 3 — Email for the Selfie Check flag

**To:** `developers@toolsforhumanity.com`
**Subject:** Selfie Check (Beta) access request — ETHOnline 2026 — app_XXXXXXXX

Fill in the four blanks and send. Everything is in one message so there is no round trip.

```
Hi,

We're requesting Selfie Check (Beta) to be enabled for our app.

  app_id:       app_XXXXXXXX
  rp_id:        rp_XXXXXXXX
  Environments: staging, production (and sandbox if applicable)
  Action name:  proctor-witness-approval
  Team/contact: <your name>, <your email>

Use case
--------
We're building Proctor for ETHOnline 2026 and submitting to the World Selfie Check track.

An AI agent performing a high-value action is stopped by a policy gate. Before it can proceed,
a human witness who is NOT the operator of that agent must approve the specific decision. The
witness receives a push notification, opens a PWA, and completes Selfie Check with the hash of
that exact decision passed as the `signal`, so the proof is cryptographically bound to the one
action being approved and cannot be replayed against another.

We use Selfie Check as an abuse-prevention and eligibility signal, not an identity signal. It is
what stops the approval step from being satisfied by the agent's own service account. We are not
claiming it proves one-person-one-account; our claim is narrower: the approver was a live human,
and their World ID account is cryptographically distinct from the operator's.

We're also requesting the World ID Sandbox App so we can test and demo the flow remotely, per the
track requirements. Requesting that in parallel via sandbox.access@toolsforhumanity.org.

Happy to share the repo or a walkthrough if useful.

Thanks,
<your name>
```

- [ ] Sent, and a copy kept
- [ ] Same content posted to Telegram: https://t.me/worlddevelopersupport

**Use Telegram in parallel.** For a nine-day event it is likely faster than email, and it costs
nothing to do both.

---

## 4. STEP 4 — Sandbox World ID App, iOS

The track requires it explicitly: *"Uses the World ID Sandbox App to test and demo the flow
remotely."* Filming production World App would contradict a qualification bullet.

### 4.0 BLOCKER: "An email-based portal account is required to request iOS enrollment"

**Hit on 2026-09-02.** If you created your Developer Portal account by **signing in with World ID**
(the World App QR flow), the iOS enrollment form rejects you with:

> An email-based portal account is required to request iOS enrollment.

The form is **not** rejecting the Apple Account email you typed. It is rejecting **the account you
are logged in as**. iOS enrollment requires the portal account itself to carry an email identity,
which is a separate thing from the Apple Account email in the input box.

**This is documented nowhere.** Not on the sandbox access page, not in `SKILL.md`, and the error
string returns zero search results. See §8 entry 5.

Fix, in order:

| # | Fix | Notes |
|---|---|---|
| 1 | **Add email sign-in to your existing account.** Portal → profile / team settings → "Sign-in methods", "Email", or "Password" | Cleanest if it exists. Try first |
| 2 | **Create a second, email-based portal account and invite it to your team** | See the warning below |
| 3 | **Use the Android tab instead** | The restriction is scoped to iOS. Android asks for a Google account and has no equivalent requirement. Open right now, no waiting |
| 4 | **Email `sandbox.access@toolsforhumanity.org` for manual enrollment** | Do this in **parallel** with 1 and 2, not instead of them |

> **Do not delete or recreate your app to fix this.** The Portal has teams. Create the new
> email-based account, then from your existing account invite that email into the **same team**. You
> keep your `app_id`, `rp_id`, actions, and above all your **signing key, which cannot be re-read**.
> Then log in as the email account and submit the iOS enrollment from there.
>
> If you have not created the app yet, this is moot: make the email-based account **first** and do
> all of §1 from it.

Template for fix 4:

```
Hi,

I'm trying to request iOS Sandbox enrollment from the Developer Portal and getting:
"An email-based portal account is required to request iOS enrollment."

My portal account was created via World ID sign-in, so it has no email identity. I could not find
any documented way to add one or to convert the account type.

Could you either enroll my Apple Account email manually, or tell me how to attach an email
credential to an existing World ID-based portal account?

  Apple Account email: <your apple id email>
  app_id:              app_XXXXXXXX

This is for ETHOnline 2026, Selfie Check track.

Thanks,
<your name>
```

**This blocks neither of the two things that matter.** The Selfie Check flag request (§3) is a
different gate to a different address and should go out now regardless. And building is unblocked
via the simulator (§5).

### 4.1 The Portal path (the documented one)

1. Install **TestFlight** from the App Store
2. Developer Portal → **World ID Sandbox** in the sidebar → **iOS** tab
3. Submit your **Apple Account email** and request enrollment
4. Wait for approval, accept the TestFlight invite, install the build

> "Confirm the email you submitted is the Apple Account you'll use to sign in to TestFlight, not
> any other email."

That is the number one failure here. Use the Apple ID email, not your work email, not the one you
used for the Developer Portal, unless they happen to be the same.

### 4.2 The public TestFlight link (try it first)

**https://testflight.apple.com/join/VZEurhHe** — verified live, returns 200 as of 2026-09-02.

**Open it on the iPhone, in Safari.** A public join link is a different mechanism from a redeem
code: it opens TestFlight directly and needs no code and no approval. If it works you skip the
wait entirely. "Beta is full" or "no longer accepting testers" is a fine and expected outcome; the
email enrollment in §4.1 is still the real path.

Older docs said no per-email invite was required. The current docs describe the per-email approval
flow in 4.1. Do 4.1 in parallel regardless.

### 4.2b TestFlight asks for a redeem code. You do not need one.

**Hit 2026-09-02.** With no betas installed, TestFlight shows a redeem-code prompt. This is its
generic empty state, **not** the World path. There are three ways into a TestFlight beta and only
one of them uses a code:

| Path | Code? | Notes |
|---|---|---|
| **Email enrollment** (the World path) | **No** | Submit your Apple Account email in the Portal, wait for approval. The build then appears in TestFlight by itself |
| **Public join link** | No | §4.2. Open on the phone |
| **Redeem code** | Yes | Per-tester private codes. Not issued by this flow |

World's own step 3, verbatim: *"When you are approved, you will receive an email. World ID Sandbox
will then appear in TestFlight."* There is nothing to type.

**Do not go looking for a code and do not let this block you.** This is gate 3, the phone build for
filming. It is unrelated to gate 2, the Selfie Check feature flag, which is what actually decides
the track. Work §1 and §3 while this approves in the background.

### 4.3 Email as the third channel

**To:** `sandbox.access@toolsforhumanity.org`  (note: `.org`, not `.com`)

```
Hi,

Requesting World ID Sandbox App access for ETHOnline 2026 (Selfie Check track).

  app_id:            app_XXXXXXXX
  Apple Account email (for TestFlight): <your apple id email>
  Platform:          iOS

We're building Proctor, a human-oversight gate for AI agents, and the Selfie Check track requires
using the Sandbox App to test and demo remotely. We've also requested the Selfie Check (Beta)
feature flag via developers@toolsforhumanity.com.

Thanks,
<your name>
```

- [ ] Portal iOS enrollment submitted with the **Apple Account** email
- [x] TestFlight installed 2026-09-02 (redeem-code prompt is a red herring, see §4.2b)
- [ ] Public TestFlight link tried **on the iPhone in Safari**
- [ ] Email sent to `sandbox.access@toolsforhumanity.org`
- [ ] `https://forms.gle/mqbaiwMvX5MzmKdY8` submitted (10 seconds, opens gate 3 only)

### 4.4 iOS is fine for the demo

The one documented iOS limitation:

> "iOS Semi-cold is currently limited. The reinstall/login journey reliably works on Android today.
> On iOS, if the user taps 'Sign in' instead of 'Sign up' mid-flow, there's no path to add the
> invite code — they have to restart from a fresh QR or deep link."

**This does not affect Proctor.** Semi-cold is the reinstall / account-recovery journey. Your demo
is **Hot**: app installed, witness already Selfie Check enrolled, deep link straight to face match.
The docs describe Hot as *"deep link into World ID and back"* and *"If they're already Selfie Check
enrolled, they go straight to face match."* Hot is the only journey fast enough to film, and it
works on iOS.

Two non-negotiables before shooting:
- Enrol in the **Sandbox** app, not production World App
- Enrol **before** the take, never during it

---

## 5. STEP 5 — Build while you wait. Do not block on access.

**Selfie Check must not be on the critical path.** Build the entire witness flow against a preset
you can get today, keep the preset behind one variable, and swap it when the flag lands. The diff
is two lines.

```ts
// web/src/lib/worldPreset.ts
import { selfieCheckLegacy, deviceLegacy } from '@worldcoin/idkit';

export const witnessPreset = (signal: string) =>
  import.meta.env.VITE_WORLD_MODE === 'SELFIE'
    ? selfieCheckLegacy({ signal })
    : deviceLegacy({ signal });
```

Everything else is identical: the RP signature, the verify call, the signal comparison, the
nullifier check, the attestation. You exercise every line that ships.

Test with the **simulator at https://simulator.worldcoin.org/** against your `staging` action. That
needs no access of any kind and works right now.

`selfieCheckLegacy()` is exported from the SDK and will type check even without the flag. The
request fails at World App if the flag is off. **Handle that with an actionable error, not an
infinite spinner** — the skill file lists "unavailable Selfie Check" as one of three failures your
UI must handle.

---

## 6. Day-1 verification

Run these the moment you have the IDs. Each answers a question that changes a decision.

```bash
# 1. Does the verify endpoint accept environment "sandbox", or only production|staging?
#    Our audit says the live OpenAPI enum is production|staging ONLY.
#    If sandbox is rejected, build on staging and write it up in WORLD_FEEDBACK.md
#    (which is itself a prize deliverable, so the failure converts into points).
curl -s -X POST "https://developer.world.org/api/v4/verify/$WORLD_RP_ID" \
  -H 'content-type: application/json' \
  -d '{"environment":"sandbox"}' | jq .

# 2. Has the RP's on-chain registration flipped to `registered`?
#    Production verification returns not_registered until it does. Poll from day 1.
#    Via the Portal MCP tool: get_world_id_registration_status

# 3. Confirm the signing key never reached the client bundle.
grep -ri "RP_SIGNING_KEY\|signing_key" web/src web/.env 2>/dev/null && echo "LEAK" || echo "clean"
```

Answer these five open questions in the first hour of a working staging integration. Each one
changes a design decision:

- [ ] Is `require_user_presence` access-gated?
- [ ] Can a v4 **session** proof carry a `signal`? (**If not, the v4 fallback cannot bind a proof to
      a decision hash and Proctor's central mechanism does not survive the fallback.**)
- [ ] What error does a disabled Selfie Check flag return?
- [ ] What is the `deviceLegacy` identifier string?
- [ ] Is a 90-day re-enrolment observable?

---

## 7. Why Selfie Check specifically, and not the fallback

This is the finding that should drive how hard you push on access.

The World docs contradict each other on nullifier stability, and the answer decides the design:

- `idkit/integrate`: *"The same person verifying the same action always produces the same nullifier."*
- `4-0-migration`: *"In 4.0, nullifiers are one-time-use, and `session_id` is the stable link."*

The migration guide is more recent and version-qualified, so it is the correction.

| Proof type | Stable nullifier? | Stable identifier |
|---|---|---|
| **World ID 3.0** (Selfie Check, all `*Legacy` presets) | **Yes**, per (account, RP, action) | `nullifier` |
| World ID 4.0 uniqueness (`proofOfHuman`, `passport`) | **No, one-time-use** | none |
| World ID 4.0 session (`IDKit.createSession`) | n/a | `session_id` |

**Consequence:** Proctor's "the witness is not the operator" check works on Selfie Check and
**breaks silently** on the `proofOfHuman` fallback. Two proofs from the *same* account produce
different nullifiers there, so `witness_nullifier != operator_nullifier` would always pass. The
load-bearing security property would be quietly false while appearing to work.

**Selfie Check is the only path confirmed to support a stable witness pseudonym AND a signal-bound
proof at the same time.** That is why this runbook exists and why the emails go out first.

---

## 8. Feedback log — start it today

`WORLD_FEEDBACK.md` is a **required deliverable** with four named sections. It is the only thing in
the submission that is pure effort rather than product, which makes it the cheapest way to beat a
competitor with an equally good app on a single-seat track. Reconstructing it on day 8 is much
harder than writing it as you go, so **date every entry from today**.

Use their exact headings so a judge with the bullet list can tick straight down:

```markdown
# World ID feedback, ETHOnline 2026, from the Proctor build
Every item below is dated, reproducible, and cites the page it came from.

## 1. Selfie Check docs and integration flow
## 2. Developer Portal navigation, search, product discovery, and debugging guidance
## 3. Sandbox App states, proof flows, test users, errors, and edge cases
## 4. What was confusing, missing, broken, or hard to test
## 5. What is genuinely good  (unrequested, include it anyway)
```

You already have four entries from this runbook alone:

1. **§1** — the docs contradict themselves on nullifier stability (integrate page vs 4.0 migration
   page). Concrete, page-cited, reproducible, and it changes an integrator's design.
2. **§4** — the Selfie Check flag and the Sandbox App are two separate gates with **two different
   email addresses on two different TLDs**, and nothing on the docs site says they are different.
3. **§4** — the Google Form is titled "World ID Sandbox Beta Access Request" and predates the
   current distribution setup: it says Firebase App Distribution while the docs say TestFlight and
   a private Play track.
4. **§2** — `docs.world.org` serves clean markdown for any route if you append `.md`, and there is a
   full index at `/llms.txt`, and **nothing on the site advertises either.** Telling a docs team
   their own best discovery affordance is undocumented is exactly the note they act on.
5. **§3** — iOS Sandbox enrollment silently requires an **email-based portal account**. An account
   created via World ID sign-in is rejected with *"An email-based portal account is required to
   request iOS enrollment"*, and there is no documented way to add an email to an existing account
   or convert the type. The requirement appears on no docs page and the error string returns zero
   search results. Reproduced 2026-09-02. **This is the highest-value entry in the document**: it is
   a hard blocker, on the sponsor's own onboarding path, that costs an integrator an unbounded
   amount of time because there is nothing to search for.
6. **§1** — `SKILL.md` says actions define *"what credential the user proves and **in which
   environment**"* and advises *"Create separate actions for simulator testing and production QA."*
   In the live Portal, a World ID 4.0 action (`action_v4_...`) has **only** `Identifier` and
   `Short description`. There is no environment selector and no max-verifications field. The
   documented two-action pattern is not constructible. Reproduced 2026-09-02.

---

## 9. Master checklist

**Today**
- [x] **Portal account is email-based** (§4.0) — done 2026-09-02
- [x] App created — `app_e179f4985c290220a5598b841fd5e3da`
- [x] World ID configured, `rp_id` minted — `rp_4d44df4ba311add1`
- [x] Signing key saved to `backend/.env`, shape verified, confirmed absent from `web/`
- [x] Action `proctor-witness-approval` created (one only, see §1.3 correction)
- [x] Email → `developers@toolsforhumanity.com` (Selfie Check flag) — sent 2026-09-02 19:22
- [ ] Telegram → https://t.me/worlddevelopersupport (same content)
- [x] Portal → World ID Sandbox → iOS tab → **Apple Account** email — submitted 2026-09-02, **pending**
- [x] TestFlight installed 2026-09-02 (redeem-code prompt is a red herring, see §4.2b)
- [ ] Public TestFlight link tried **on the iPhone in Safari**
- [ ] Email → `sandbox.access@toolsforhumanity.org` (note `.org`)
- [ ] Google Form submitted
- [ ] `WORLD_FEEDBACK.md` started, entries dated

**Day 1**
- [ ] Simulator flow working end to end on `staging` with `deviceLegacy`
- [ ] `environment: "sandbox"` accepted or rejected by the verify endpoint — recorded either way
- [ ] RP registration status polled
- [ ] The five open questions in §6 answered

**When the flag lands**
- [ ] `VITE_WORLD_MODE=SELFIE`
- [ ] Sandbox app installed on the demo phone
- [ ] Witness **enrolled in Selfie Check inside the Sandbox app** (not production)
- [ ] Full Hot-flow rehearsal, timed

**Day 3, 18:00 — the fallback decision**
- [ ] Flag granted → continue
- [ ] Not granted → the escape hatch below

---

## 10. If access does not arrive

The qualification bullet reads: *"Uses Selfie Check **or a Selfie Check-compatible World ID
credential flow** in a meaningful way."*

That phrasing matters. A compatible preset running through the **Sandbox App**, built on the
identical code path with the preset behind one variable, is arguably a "Selfie Check-compatible
credential flow", and the submission can say so honestly:

> "Built for Selfie Check, running on the compatible fallback preset because the beta flag was not
> granted in time. The switch is one environment variable and the verification path is identical."

That is a weaker submission and it should not be the plan. But **the day-3 decision is a judgement
about demo strength, not a qualification cliff.** Keep the deadline, drop the
automatic-disqualification framing.

Be aware of what genuinely breaks on the fallback: per §7, the operator-independence check stops
working on `proofOfHuman`. If you end up there, either move to the v4 **session** flow and compare
`session_id`s instead of nullifiers, or state plainly in the README that independence is enforced
as a policy property of the rota rather than a cryptographic one. **Do not claim a property the
fallback does not have.** On a track judged by the team that built the credential, an honest
narrower claim beats an overclaim every time.

---

## Sources

All fetched or verified 2026-09-02:

- https://docs.world.org/world-id/SKILL.md
- https://docs.world.org/world-id/idkit/integrate.md
- https://docs.world.org/world-id/idkit/credentials.md
- https://docs.world.org/world-id/sandbox/sandbox-access.md
- https://docs.world.org/world-id/sandbox/testing-selfie-check.md
- https://developer.world.org (200)
- https://testflight.apple.com/join/VZEurhHe (200)
- https://simulator.worldcoin.org/
- Internal: `18_TECH_WORLD.md`, `24_MAXIMIZE.md` §1.3, `22_CONSISTENCY_AUDIT.md` B7
