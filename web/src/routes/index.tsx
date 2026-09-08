import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getTrustRoots, getCompleteness, type TrustRoots, type Completeness } from '@/lib/proctor/console';

export const Route = createFileRoute('/')({ component: IndexPage });

/**
 * The landing page exists to make one claim and let a stranger check it in the
 * same screen. Every number below is fetched live: a hardcoded "PASS" would be
 * exactly the self-attested evidence this project argues against.
 */
function IndexPage() {
  const [roots, setRoots] = useState<TrustRoots | null>(null);
  const [completeness, setCompleteness] = useState<Completeness | null>(null);

  useEffect(() => {
    getTrustRoots().then(setRoots).catch(() => {});
    getCompleteness().then(setCompleteness).catch(() => {});
  }, []);

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-200">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-500">Proctor</p>

        <h1 className="mt-5 text-4xl font-semibold leading-tight text-white sm:text-5xl">
          An AI agent stops mid-payment and pays a live, verified human for permission to continue.
        </h1>

        <p className="mt-6 text-lg text-neutral-400">
          The product is the evidence, not the approval.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/console"
            className="rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-black hover:bg-emerald-400"
          >
            Open the evidence console
          </Link>
          {roots?.hcs.topicId && (
            <a
              href={`https://hashscan.io/testnet/topic/${roots.hcs.topicId}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-neutral-700 px-5 py-3 text-sm font-medium text-neutral-200 hover:border-neutral-500"
            >
              View the log on HashScan
            </a>
          )}
        </div>

        {/* --- the argument, in three steps ------------------------------- */}
        <section className="mt-20 border-t border-neutral-800 pt-10">
          <h2 className="text-sm uppercase tracking-widest text-neutral-500">Why this exists</h2>

          <p className="mt-5 text-neutral-300">
            Every agent framework already ships a human-approval interrupt. They are free, already
            integrated, and they all produce the same artefact:
          </p>

          <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 font-mono text-sm text-neutral-400">
            approved_by: user_44, 14:22:07
          </pre>

          <p className="mt-4 text-neutral-400">
            That row is written by the system being audited, editable by the party being audited, and
            contains no evidence that a human rather than a service account produced it.
          </p>
        </section>

        <section className="mt-14">
          <h2 className="text-sm uppercase tracking-widest text-neutral-500">What Proctor binds</h2>
          <ul className="mt-5 space-y-3 text-neutral-300">
            <Bind n="1">The decision hash, so the proof cannot be replayed against another decision</Bind>
            <Bind n="2">A liveness proof issued by a party that is not the deployer</Bind>
            <Bind n="3">A nullifier showing the approver is not the operator</Bind>
            <Bind n="4">A consensus timestamp on a log with no admin key</Bind>
          </ul>
        </section>

        {/* --- integrity and completeness are different claims ------------ */}
        <section className="mt-14">
          <h2 className="text-sm uppercase tracking-widest text-neutral-500">
            Two questions, not one
          </h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Claim
              title="Was it altered?"
              answer="The running hash chain, recomputed from genesis."
              detail="Catches insertion, removal, reordering and edits."
            />
            <Claim
              title="Is it all there?"
              answer="Dense issuance numbers, signed into every record."
              detail="Catches a decision that was never written at all, which breaks no hash."
              live={
                completeness
                  ? completeness.complete
                    ? `${completeness.attested} of ${completeness.issued} issued, no gaps`
                    : `${completeness.gaps.length} missing`
                  : null
              }
              ok={completeness?.complete}
            />
          </div>

          <p className="mt-5 text-sm text-neutral-500">
            A tamper-evident log answers the first and stays silent on the second. An operator does not
            need to forge a refusal; they can simply decline to publish it.
          </p>
        </section>

        {/* --- check it yourself ------------------------------------------ */}
        <section className="mt-14">
          <h2 className="text-sm uppercase tracking-widest text-neutral-500">Check it yourself</h2>
          <p className="mt-4 text-neutral-400">
            Zero dependencies, <code className="text-neutral-300">node:crypto</code> only. It contacts
            Hedera&rsquo;s public mirror node and nothing of ours.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 font-mono text-sm text-emerald-400">
            bun verify/bin/verify.ts --topic {roots?.hcs.topicId ?? '0.0.…'}
          </pre>
        </section>

        {/* --- honest limits ---------------------------------------------- */}
        <section className="mt-14 rounded-xl border border-neutral-800 bg-neutral-900/30 p-6">
          <h2 className="text-sm uppercase tracking-widest text-neutral-500">What we do not claim</h2>
          <ul className="mt-4 space-y-2 text-sm text-neutral-400">
            <li>
              We hold the submit key, so we can write a false entry. What the log prevents is
              retroactively editing or deleting one.
            </li>
            <li>
              Two distinct nullifiers do not prove two humans. One person can hold two World ID
              accounts. Every record says which property it carries.
            </li>
            <li>
              Completeness makes suppression loud, not impossible: an operator can still stop writing
              entirely.
            </li>
          </ul>
        </section>

        <footer className="mt-14 border-t border-neutral-800 pt-6 font-mono text-xs text-neutral-600">
          {roots ? (
            <>
              <p>attestor {roots.attestor.address}</p>
              <p className="mt-1">
                World {roots.world.mode} · {roots.canonicalization}
              </p>
            </>
          ) : (
            <p>Start the API to load live trust roots.</p>
          )}
          <p className="mt-3">Hedera testnet only. Do not send mainnet funds to any address here.</p>
        </footer>
      </div>
    </main>
  );
}

function Bind({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="font-mono text-sm text-emerald-500">{n}</span>
      <span>{children}</span>
    </li>
  );
}

function Claim({
  title,
  answer,
  detail,
  live,
  ok,
}: {
  title: string;
  answer: string;
  detail: string;
  live?: string | null;
  ok?: boolean;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
      <p className="font-medium text-white">{title}</p>
      <p className="mt-2 text-sm text-neutral-300">{answer}</p>
      <p className="mt-2 text-sm text-neutral-500">{detail}</p>
      {live && (
        <p
          className={`mt-3 font-mono text-xs ${ok ? 'text-emerald-400' : 'text-red-400'}`}
        >
          live: {live}
        </p>
      )}
    </div>
  );
}
