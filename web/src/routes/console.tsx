import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { listDecisions, getTrustRoots, getCompleteness, consensusToDate, type DecisionRow, type TrustRoots, type Completeness } from '@/lib/proctor/console';
import { useDecisionStream } from '@/lib/proctor/useDecisionStream';

export const Route = createFileRoute('/console')({ component: Console });

function Console() {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [roots, setRoots] = useState<TrustRoots | null>(null);
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      listDecisions().then((d) => setRows(d.decisions)).catch((e) => setError(e.message));
      getCompleteness().then(setCompleteness).catch(() => {});
    };
    load();
    getTrustRoots().then(setRoots).catch(() => {});
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  const live = rows.find((r) => r.state === 'DISPATCHED') ?? null;
  const stream = useDecisionStream(live?.id ?? null);

  const resolved = rows.filter((r) => r.outcome);
  const refused = resolved.filter((r) => r.outcome !== 'APPROVE').length;
  const attested = resolved.filter((r) => r.sequenceNumber).length;

  return (
    <main className="min-h-dvh bg-neutral-950 px-6 pt-28 pb-8 text-neutral-200">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-baseline justify-between border-b border-neutral-800 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Evidence console</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Postgres is the index. HCS is the truth. Every row carries the sequence number needed to re-verify.
            </p>
          </div>
          {roots?.hcs.topicId && (
            <a
              href={`https://hashscan.io/testnet/topic/${roots.hcs.topicId}`}
              target="_blank" rel="noreferrer"
              className="font-mono text-xs text-emerald-400 underline underline-offset-4"
            >
              topic {roots.hcs.topicId}
            </a>
          )}
        </header>

        {error && (
          <p className="mt-6 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}. Is the API running on {import.meta.env.VITE_API_URL}?
          </p>
        )}

        {/* The on-camera panel: a decision in flight, its deadline, and the meter. */}
        {live && (
          <section className="mt-6 rounded-xl border border-amber-800/60 bg-amber-950/20 p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-amber-500">
                Awaiting an attested human witness
              </span>
              <span className={`h-2 w-2 rounded-full ${stream.connected ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
            </div>

            <p className="mt-3 text-2xl font-semibold text-white">{live.humanLine}</p>

            <div className="mt-5 grid grid-cols-3 gap-4">
              <Stat
                label="Deadline"
                value={stream.meter ? `${Math.ceil(stream.meter.remainingMs / 1000)}s` : '—'}
                accent={stream.meter !== null && stream.meter.remainingMs < 10_000}
              />
              <Stat
                label="Witness attention"
                value={stream.meter ? `${(stream.meter.elapsedMs / 1000).toFixed(1)}s` : '—'}
              />
              <Stat
                label="Metered"
                value={stream.meter ? `$${stream.meter.accruedUsd}` : '—'}
              />
            </div>
          </section>
        )}

        <div className="mt-8 grid grid-cols-3 gap-4">
          <Stat label="Decisions" value={String(rows.length)} />
          <Stat label="Refused or expired" value={String(refused)} />
          <Stat label="On the evidence log" value={String(attested)} />
        </div>

        {/* Completeness, which the running hash cannot answer. */}
        {completeness && (
          <section
            className={`mt-4 rounded-xl border p-5 ${
              completeness.complete
                ? 'border-emerald-900/60 bg-emerald-950/20'
                : 'border-red-800 bg-red-950/30'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span
                className={`text-xs uppercase tracking-widest ${
                  completeness.complete ? 'text-emerald-500' : 'text-red-400'
                }`}
              >
                Evidence gap
              </span>
              <span className="font-mono text-xs text-neutral-500">
                {completeness.attested} of {completeness.issued} issued
              </span>
            </div>

            <p
              className={`mt-2 font-mono tabular-nums ${
                completeness.complete ? 'text-4xl text-emerald-400' : 'text-4xl text-red-400'
              }`}
            >
              {completeness.gaps.length}
            </p>

            <p className="mt-2 text-sm text-neutral-400">
              {completeness.complete
                ? 'Every resolved decision reached the evidence log. The running hash proves nothing was altered; this proves nothing was withheld.'
                : `Issued but absent from the log: ${completeness.gaps
                    .map((g) => `#${g.orgSeq}`)
                    .join(', ')}. A record exists locally that the operator never published.`}
            </p>

            {/* Undecided decisions are not gaps. Showing them separately stops
                an open decision reading as suppressed evidence. */}
            {completeness.inFlight?.length > 0 && (
              <p className="mt-2 text-xs text-neutral-500">
                {completeness.inFlight.length} decision(s) still in flight (
                {completeness.inFlight.map((n) => `#${n}`).join(', ')}). Undecided records owe
                the log nothing yet.
              </p>
            )}
          </section>
        )}

        <table className="mt-6 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-500">
            <tr className="border-b border-neutral-800">
              <th className="py-2">Decision</th>
              <th>Outcome</th>
              <th>Review</th>
              <th>Consensus</th>
              <th className="text-right">Seq</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-neutral-900">
                <td className="max-w-xs truncate py-3 pr-4">{r.humanLine}</td>
                <td><Outcome value={r.outcome} state={r.state} /></td>
                <td className="text-neutral-400">
                  {r.reviewMs !== null ? `${(r.reviewMs / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="font-mono text-xs text-neutral-500">
                  {r.consensusTimestamp ? consensusToDate(r.consensusTimestamp).toISOString().slice(11, 19) : '—'}
                </td>
                <td className="text-right">
                  {r.sequenceNumber && r.explorerUrl ? (
                    <a href={r.explorerUrl} target="_blank" rel="noreferrer"
                       className="font-mono text-xs text-emerald-400 underline underline-offset-4">
                      #{r.sequenceNumber}
                    </a>
                  ) : <span className="text-neutral-600">—</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={5} className="py-8 text-center text-neutral-600">
                No decisions yet. Run <code className="text-neutral-400">bun run demo</code> in backend/.
              </td></tr>
            )}
          </tbody>
        </table>

        {roots && (
          <footer className="mt-10 border-t border-neutral-800 pt-4 text-xs text-neutral-600">
            <p>{roots.hcs.note}</p>
            <p className="mt-1">
              Attestor {roots.attestor.address} · World {roots.world.mode} on {roots.world.environment} · {roots.canonicalization}
            </p>
          </footer>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl tabular-nums ${accent ? 'text-red-400' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}

function Outcome({ value, state }: { value: string | null; state: string }) {
  if (!value) return <span className="text-amber-400">{state.toLowerCase()}</span>;
  const approved = value === 'APPROVE';
  return (
    <span className={approved ? 'text-emerald-400' : 'text-neutral-400'}>
      {approved ? 'approved' : value === 'REFUSE' ? 'refused' : 'expired'}
    </span>
  );
}
