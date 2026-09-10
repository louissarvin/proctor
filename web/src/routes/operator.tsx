import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { WitnessHandoff } from '@/components/WitnessHandoff';
import { useDecisionStream } from '@/lib/proctor/useDecisionStream';
import { useCountdown } from '@/lib/proctor/useCountdown';
import { env } from '@/env';

export const Route = createFileRoute('/operator')({ component: Operator });

interface Evidence {
  outcome: string | null;
  attestation: {
    sequenceNumber: string | null;
    topicId: string;
    explorerUrl: string | null;
    consensusTimestamp: string | null;
    // The signed core, published so a third party re-verifies without
    // trusting this page. `wa`/`ind` are exactly what the witness's own
    // confirmation screen calls "Authenticated by" / "Independence".
    body: string;
  } | null;
  payments: { leg: string; state: string; explorerUrl: string | null; amountUsd: string }[];
}

/** Pull `wa`/`ind` out of the published attestation body. Never throws. */
const coreOf = (body: string | undefined): { wa?: string; ind?: string } => {
  try { return body ? (JSON.parse(body) as { wa?: string; ind?: string }) : {}; }
  catch { return {}; }
};

interface RunResult {
  escalated: boolean;
  reason?: string;
  decisionId?: string;
  humanLine?: string;
  policyReason?: string;
  decisionHash?: string;
  expiresAt?: string;
  serverNow?: string;
  handoffUrl?: string;
  witnessUrl?: string;
  amountThreshold?: string;
  paid?: boolean;
  note?: string;
}

function Operator() {
  const [amount, setAmount] = useState('41200.00');
  // Blank by default, on purpose: the server's own default names its REAL
  // Hedera testnet treasury account, read from its own config. Hardcoding
  // that address here too would risk it drifting out of sync.
  const [counterparty, setCounterparty] = useState('');
  const [ttl, setTtl] = useState(600);
  // Demo-only: the paid gate hardcodes its threshold, on purpose, so an agent
  // can never set its own bar for escalation. This override exists ONLY on
  // the unpaid operator endpoint, to make the threshold demonstrable.
  const [threshold, setThreshold] = useState('25000');
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stream = useDecisionStream(run?.decisionId ?? null);
  const { display, expired } = useCountdown(run?.expiresAt ?? null, run?.serverNow ?? null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);

  const state = stream.state ?? (run?.escalated ? 'DISPATCHED' : null);
  const terminal = state === 'APPROVED' || state === 'REFUSED' || state === 'EXPIRED';

  // Fetch the real evidence record once the decision settles. This is what
  // turns "the console says approved" into something a skeptic can click
  // through to HashScan and check without trusting this page at all.
  useEffect(() => {
    if (!terminal || !run?.decisionId) { setEvidence(null); return; }
    let cancelled = false;
    fetch(`${env.VITE_API_URL}/v1/evidence/decisions/${run.decisionId}`,
      { headers: { 'ngrok-skip-browser-warning': '1' } })
      .then((r) => r.json())
      .then((body: { data?: Evidence }) => { if (!cancelled) setEvidence(body.data ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [terminal, run?.decisionId]);

  const start = async () => {
    setBusy(true); setError(null); setRun(null);
    try {
      const res = await fetch(`${env.VITE_API_URL}/v1/demo/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({ amount, counterparty, ttlSeconds: ttl, amountThreshold: threshold }),
      });
      const body = await res.json() as { data?: RunResult; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setRun(body.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs tracking-widest text-neutral-500">OPERATOR CONSOLE</p>
        <h1 className="mt-2 text-2xl font-semibold">Hold an agent on a human decision</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Describe what an agent is about to do. Policy decides whether it proceeds or stops
          for a person. Most actions proceed.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-4">
          <label className="text-sm">
            <span className="text-neutral-400">Amount (EUR)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="text-neutral-400">Counterparty</span>
            <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)}
              placeholder="Hedera Testnet Treasury"
              className="mt-1 w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="text-neutral-400">Deadline (s)</span>
            <input type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}
              className="mt-1 w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="text-neutral-400">Escalation threshold (EUR)</span>
            <input value={threshold} onChange={(e) => setThreshold(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2" />
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Amounts at or above the threshold hold for a human. Below it, the action proceeds
          for free. This slider only exists on the unpaid demo path — the real x402 gate
          hardcodes its policy, so a paying agent can never move its own bar.
        </p>

        <button onClick={start} disabled={busy}
          className="mt-5 rounded bg-emerald-500 px-5 py-2.5 font-medium text-black disabled:opacity-50">
          {busy ? 'Evaluating…' : 'Run the action'}
        </button>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {/* The common path: no human was needed. Worth showing, because a gate
            that stops everything is a gate nobody would deploy. */}
        {run && !run.escalated && (
          <div className="mt-8 rounded border border-neutral-800 bg-neutral-900 p-5">
            <p className="text-emerald-400">Proceeded. No human needed.</p>
            <p className="mt-1 text-sm text-neutral-400">
              Policy returned <code>{run.reason}</code> — below the {run.amountThreshold ?? threshold} EUR
              threshold. This call was free and never touched a paywall.
            </p>
          </div>
        )}

        {run?.escalated && (
          <div className="mt-8 space-y-6">
            <div className="rounded border border-amber-900/60 bg-amber-950/20 p-5">
              <p className="text-xs tracking-widest text-amber-500">AGENT HELD</p>
              <p className="mt-2 text-lg">{run.humanLine}</p>
              <p className="mt-1 text-sm text-neutral-400">
                Fired on <code>{run.policyReason}</code>. It cannot proceed unless a person says so.
              </p>
              <div className="mt-3 flex items-center gap-4 text-sm">
                <span className={expired ? 'text-red-400' : 'text-neutral-300'}>
                  {expired ? 'deadline passed' : `${display} left`}
                </span>
                <span className="text-neutral-500">state {state}</span>
              </div>
            </div>

            {!terminal && run.witnessUrl && (
              <div className="rounded border border-neutral-800 bg-neutral-900 p-5">
                <p className="mb-3 text-sm text-neutral-400">
                  Scan with the witness's phone. The witness is not the operator.
                </p>
                {/* witnessUrl -> /w/:token, the actual decision page. handoffUrl
                    points at /handoff/:token, a SECOND operator screen that shows
                    this same QR again -- scanning it lands a phone on another QR
                    instead of the approve/refuse page. */}
                <WitnessHandoff url={run.witnessUrl} humanLine={run.humanLine ?? ''} />
              </div>
            )}

            {terminal && (() => {
              const att = evidence?.attestation;
              const core = coreOf(att?.body);
              const witnessFee = evidence?.payments.find((p) => p.leg === 'WITNESS_FEE');
              return (
                <div className="rounded border border-neutral-800 bg-neutral-900 p-5">
                  <p className={state === 'APPROVED' ? 'text-emerald-400' : 'text-red-400'}>
                    {state === 'APPROVED' ? 'Approved. The agent is released.' : 'Not released.'}
                  </p>
                  <p className="mt-2 text-sm text-neutral-400">
                    The evidence record is written to a Hedera topic with no admin key, after the
                    agent is released rather than on its critical path.
                  </p>

                  {!evidence && (
                    <p className="mt-3 text-xs text-neutral-500">Waiting for the attestation to land…</p>
                  )}

                  {att?.sequenceNumber && (
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-neutral-500">HCS sequence</dt>
                      <dd className="text-neutral-200">#{att.sequenceNumber}</dd>

                      <dt className="text-neutral-500">Authenticated by</dt>
                      <dd className="text-neutral-200">
                        {core.wa === 'proof' ? 'liveness proof' : core.wa === 'token' ? 'token only' : '—'}
                      </dd>

                      <dt className="text-neutral-500">Independence</dt>
                      <dd className={core.ind === 'crypto' ? 'text-emerald-400' : 'text-neutral-200'}>
                        {core.ind === 'crypto' ? 'cryptographic' : core.ind === 'policy' ? 'policy' : '—'}
                      </dd>

                      {witnessFee && (
                        <>
                          <dt className="text-neutral-500">Witness paid</dt>
                          <dd className="text-neutral-200">
                            {witnessFee.state === 'SETTLED' ? `$${witnessFee.amountUsd}` : witnessFee.state}
                          </dd>
                        </>
                      )}
                    </dl>
                  )}

                  {att?.explorerUrl && (
                    <a href={att.explorerUrl} target="_blank" rel="noreferrer"
                      className="mt-3 inline-block text-sm text-emerald-400 underline">
                      View on HashScan, verified independently of this page
                    </a>
                  )}
                  <a href="/console" className="mt-3 block text-sm text-emerald-400 underline">
                    Open the evidence console
                  </a>
                </div>
              );
            })()}

            {/* Said on screen, not only in the docs. */}
            {run.paid === false && (
              <p className="text-xs text-neutral-500">
                {run.note}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
