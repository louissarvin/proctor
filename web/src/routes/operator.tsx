import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { WitnessHandoff } from '@/components/WitnessHandoff';
import { useDecisionStream } from '@/lib/proctor/useDecisionStream';
import { useCountdown } from '@/lib/proctor/useCountdown';
import { env } from '@/env';

export const Route = createFileRoute('/operator')({ component: Operator });

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
  paid?: boolean;
  note?: string;
}

function Operator() {
  const [amount, setAmount] = useState('41200.00');
  const [counterparty, setCounterparty] = useState('Meridian Logistics');
  const [ttl, setTtl] = useState(600);
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stream = useDecisionStream(run?.decisionId ?? null);
  const { display, expired } = useCountdown(run?.expiresAt ?? null, run?.serverNow ?? null);

  const start = async () => {
    setBusy(true); setError(null); setRun(null);
    try {
      const res = await fetch(`${env.VITE_API_URL}/v1/demo/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({ amount, counterparty, ttlSeconds: ttl }),
      });
      const body = await res.json() as { data?: RunResult; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setRun(body.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start');
    } finally { setBusy(false); }
  };

  const state = stream.state ?? (run?.escalated ? 'DISPATCHED' : null);
  const terminal = state === 'APPROVED' || state === 'REFUSED' || state === 'EXPIRED';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs tracking-widest text-neutral-500">OPERATOR CONSOLE</p>
        <h1 className="mt-2 text-2xl font-semibold">Hold an agent on a human decision</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Describe what an agent is about to do. Policy decides whether it proceeds or stops
          for a person. Most actions proceed.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="text-neutral-400">Amount (EUR)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="text-neutral-400">Counterparty</span>
            <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="text-neutral-400">Deadline (s)</span>
            <input type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}
              className="mt-1 w-full rounded border border-neutral-800 bg-neutral-900 px-3 py-2" />
          </label>
        </div>

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
              Policy returned <code>{run.reason}</code>. This call was free and never touched a paywall.
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

            {!terminal && run.handoffUrl && (
              <div className="rounded border border-neutral-800 bg-neutral-900 p-5">
                <p className="mb-3 text-sm text-neutral-400">
                  Scan with the witness's phone. The witness is not the operator.
                </p>
                <WitnessHandoff url={run.handoffUrl} humanLine={run.humanLine ?? ''} />
              </div>
            )}

            {terminal && (
              <div className="rounded border border-neutral-800 bg-neutral-900 p-5">
                <p className={state === 'APPROVED' ? 'text-emerald-400' : 'text-red-400'}>
                  {state === 'APPROVED' ? 'Approved. The agent is released.' : 'Not released.'}
                </p>
                <p className="mt-2 text-sm text-neutral-400">
                  The evidence record is written to a Hedera topic with no admin key, after the
                  agent is released rather than on its critical path.
                </p>
                <a href="/console" className="mt-3 inline-block text-sm text-emerald-400 underline">
                  Open the evidence console
                </a>
              </div>
            )}

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
