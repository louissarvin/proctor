/**
 * The witness screen. This is the phone in the demo.
 *
 * DESIGN CONSTRAINTS, all deliberate:
 *
 * - ONE LINE, large. A witness deciding in 60 seconds reads one sentence, not a
 *   form. The full record is available behind a disclosure for anyone
 *   suspicious enough to want it.
 * - REFUSE IS ALWAYS AVAILABLE and needs no proof. Refuse is the default
 *   outcome; putting a liveness check between a person and a stop button would
 *   be a failure mode, not a security control.
 * - THE COUNTDOWN RUNS ON THE SERVER CLOCK. A skewed device must not show a
 *   deadline nobody else agrees with.
 * - EVERY FAILURE SAYS WHY. An infinite spinner is the documented worst case
 *   for a gated credential; each error code maps to a sentence.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { IDKitRequestWidget, selfieCheckLegacy, deviceLegacy, proofOfHuman, setDebug, type RpContext } from '@worldcoin/idkit';
import { env } from '@/env';
import {
  getWitnessDecision, mintRpSignature, respond, errorCopy, reportClientError,
  ProctorError, type WitnessDecision, type RespondResult,
} from '@/lib/proctor/api';
import { useCountdown } from '@/lib/proctor/useCountdown';

export const Route = createFileRoute('/w/$token')({ component: WitnessScreen });

type Phase = 'loading' | 'ready' | 'verifying' | 'done' | 'error';

function WitnessScreen() {
  const { token } = Route.useParams();

  const [phase, setPhase] = useState<Phase>('loading');
  const [decision, setDecision] = useState<WitnessDecision | null>(null);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [result, setResult] = useState<RespondResult | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  // IDKit's own debug logging, forwarded to the server. `onError` only
  // reports a category; the real detail is in these console lines. Console
  // only, no fetch patching -- a prior version wrapped window.fetch here and
  // broke every API call because it added a header the backend hadn't
  // allow-listed for CORS. Console forwarding carries no such risk.
  useEffect(() => {
    setDebug(true);
    const orig = { error: console.error, warn: console.warn, log: console.log };
    const forward = (level: 'error' | 'warn' | 'log') => (...args: unknown[]) => {
      const text = args.map((a) => {
        try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
      }).join(' ');
      if (/idkit|world|bridge|proof|rp_|credential|nonce/i.test(text)) {
        reportClientError(token, `console.${level}`, text.slice(0, 500));
      }
      orig[level](...args);
    };
    console.error = forward('error');
    console.warn = forward('warn');
    console.log = forward('log');
    return () => { console.error = orig.error; console.warn = orig.warn; console.log = orig.log; };
  }, [token]);

  const [widgetOpen, setWidgetOpen] = useState(false);
  const [showRecord, setShowRecord] = useState(false);

  const { seconds, display, expired } = useCountdown(decision?.expiresAt ?? null, decision?.serverNow ?? null);

  const fail = useCallback((e: unknown) => {
    setError(errorCopy(e instanceof ProctorError ? e.code : 'UNKNOWN'));
    setPhase('error');
  }, []);

  // Load the decision, then mint the RP signature. The signature is minted on
  // ARRIVAL rather than on page load, because its TTL is 300s.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getWitnessDecision(token);
        if (cancelled) return;
        setDecision(d);
        setPhase('ready');

      } catch (e) {
        if (!cancelled) fail(e);
      }
    })();
    return () => { cancelled = true; };
  }, [token, fail]);

  const [minting, setMinting] = useState(false);

  /**
   * Mint the RP signature HERE, not on page load.
   *
   * The nonce lives 300s. Minting it when the page opens starts that clock
   * while the witness is still reading, and scanning a QR then completing a
   * selfie can easily take longer, so a perfectly good proof comes back
   * against a dead nonce. Minting on commit gives the witness the full window.
   */
  const onApprove = async () => {
    setMinting(true);
    try {
      const sig = await mintRpSignature(token);
      setRpContext({
        rp_id: sig.rp_id as `rp_${string}`,
        nonce: sig.nonce,
        created_at: sig.created_at,
        expires_at: sig.expires_at,
        signature: sig.sig,
      });
      setWidgetOpen(true);
    } catch (e) { fail(e); } finally { setMinting(false); }
  };

  const onRefuse = async () => {
    setPhase('verifying');
    try {
      setResult(await respond(token, 'REFUSE'));
      setPhase('done');
    } catch (e) { fail(e); }
  };

  if (phase === 'loading') return <Shell><p className="text-neutral-400">Loading decision…</p></Shell>;

  if (phase === 'error' && error) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-white">{error.title}</h1>
        <p className="mt-3 text-neutral-400">{error.detail}</p>
      </Shell>
    );
  }

  if (phase === 'done' && result) {
    const approved = result.outcome === 'APPROVE';
    return (
      <Shell>
        <div className={`text-6xl ${approved ? 'text-emerald-400' : 'text-neutral-300'}`}>
          {approved ? '✓' : '✕'}
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-white">
          {approved ? 'Approved' : 'Refused'}
        </h1>
        <p className="mt-2 text-neutral-400">
          {approved
            ? 'The agent has been released. An attestation is on the evidence log.'
            : 'The agent was NOT released. The refusal is on the evidence log.'}
        </p>
        <dl className="mt-8 w-full space-y-2 text-sm">
          <Row label="Reviewed in" value={`${(result.reviewMs / 1000).toFixed(1)}s`} />
          <Row label="Authenticated by" value={result.witnessAuth === 'proof' ? 'liveness proof' : 'approval link'} />
          {result.independence && (
            <Row
              label="Independence"
              value={result.independence === 'crypto' ? 'cryptographic' : 'policy (rota)'}
            />
          )}
        </dl>
      </Shell>
    );
  }

  if (!decision) return null;

  const timeUp = expired || seconds === 0;
  const urgent = seconds !== null && seconds <= 10;

  return (
    <Shell>
      {/* The clock. Large, because it is the whole pressure of the screen. */}
      <div className="flex w-full items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-neutral-500">
          Approval required
        </span>
        <span
          className={`font-mono text-2xl tabular-nums ${urgent ? 'text-red-400' : 'text-neutral-300'}`}
          aria-live="polite"
        >
          {display}
        </span>
      </div>

      {/* THE ONE LINE. */}
      <h1 className="mt-8 text-3xl font-semibold leading-tight text-white">
        {decision.humanLine}
      </h1>

      <button
        type="button"
        onClick={() => setShowRecord((v) => !v)}
        className="mt-4 text-sm text-neutral-500 underline underline-offset-4"
      >
        {showRecord ? 'Hide full record' : 'View full record'}
      </button>

      {showRecord && (
        <pre className="mt-3 max-h-56 w-full overflow-auto rounded-lg bg-neutral-900 p-3 text-xs text-neutral-400">
          {JSON.stringify(decision.preimage, null, 2)}
        </pre>
      )}

      {timeUp ? (
        <p className="mt-10 text-neutral-400">
          The deadline passed. This decision was automatically refused and the agent was not released.
        </p>
      ) : (
        <div className="mt-10 w-full space-y-3">
          <button
            type="button"
            disabled={phase === 'verifying' || minting}
            onClick={onApprove}
            className="w-full rounded-xl bg-emerald-500 py-4 text-lg font-semibold text-black disabled:opacity-40"
          >
            {minting ? 'Preparing…' : 'Approve'}
          </button>

          {/* Refuse never waits on a proof. */}
          <button
            type="button"
            disabled={phase === 'verifying'}
            onClick={onRefuse}
            className="w-full rounded-xl border border-neutral-700 py-4 text-lg font-medium text-neutral-200 disabled:opacity-40"
          >
            Refuse
          </button>

          <p className="pt-2 text-center text-xs text-neutral-500">
            No response by the deadline is treated as a refusal.
          </p>
        </div>
      )}

      {rpContext && env.VITE_WORLD_APP_ID && (
        <IDKitRequestWidget
          open={widgetOpen}
          onOpenChange={setWidgetOpen}
          app_id={env.VITE_WORLD_APP_ID as `app_${string}`}
          action={decision.world.action}
          rp_context={rpContext}
          allow_legacy_proofs
          // LIVENESS ON THE FALLBACK. World documents this as an "optional
          // liveness step" that "Defaults to false", and user_presence_completed
          // is returned on v3 proofs too, not just v4. Without it the
          // deviceLegacy fallback proves possession of a phone and nothing
          // about a human being present, which is the one property this whole
          // product rests on. Selfie Check carries liveness itself; asking for
          // presence as well costs nothing and keeps the claim true either way.
          require_user_presence={decision.world.requirePresence !== false}
          environment={decision.world.environment}
          // THE MECHANISM: the decision hash is the signal, so this proof
          // cannot be replayed against any other decision.
          preset={
            decision.world.mode === 'SELFIE'
              ? selfieCheckLegacy({ signal: decision.signal })
              // World deprecated deviceLegacy for NEW integrations, so a new
              // app cannot get a device credential at all. proofOfHuman is the
              // working path when the Selfie Check beta has not been granted.
              : decision.world.mode === 'ORB'
                ? proofOfHuman({ signal: decision.signal })
                : deviceLegacy({ signal: decision.signal })
          }
          // Runs AFTER World returns a proof but BEFORE onSuccess. If it
          // throws, onSuccess never fires, so an unverifiable proof cannot
          // release the agent.
          handleVerify={async (proof) => {
            setPhase('verifying');
            const r = await respond(token, 'APPROVE', proof);
            setResult(r);
          }}
          onSuccess={() => setPhase('done')}
          onError={(code) => {
            setPhase('ready');
            // The widget shows the witness a generic message. Send the real
            // code to the operator, who is the only one who can act on it.
            reportClientError(token, String(code), JSON.stringify(code)?.slice(0, 400));
            setError(errorCopy(String(code)));
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-start justify-center px-6 py-10">
      {children}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-neutral-800 pb-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-200">{value}</dd>
    </div>
  );
}
