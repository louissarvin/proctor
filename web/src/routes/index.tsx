import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { Completeness, TrustRoots } from '@/lib/proctor/console';
import AnimateComponent from '@/components/elements/AnimateComponent';
import { getCompleteness, getTrustRoots } from '@/lib/proctor/console';

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
    <main className="min-h-dvh bg-neutral-950 text-neutral-300">
      {/* --- hero -------------------------------------------------------- */}
      <section className="relative overflow-hidden px-6 pt-44 pb-28">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.14),transparent_65%)]"
        />
        <div className="mx-auto max-w-3xl">
          <AnimateComponent entry="fadeInUp">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-500">
              Human oversight for AI agents
            </p>
          </AnimateComponent>

          <AnimateComponent entry="fadeInUp" delay={80}>
            <h1 className="mt-6 text-[2.75rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl">
              x402 lets an agent pay for anything. Nothing forces it to ask a human first.
            </h1>
          </AnimateComponent>

          <AnimateComponent entry="fadeInUp" delay={160}>
            <p className="mt-6 max-w-xl text-lg text-neutral-400">
              Proctor is the human in the loop that&rsquo;s missing. An agent stops at a threshold,
              pays a 402 just to ask, and a witness who is cryptographically not the operator
              approves or refuses. No answer means refuse. The decision lands on a Hedera topic
              with no admin key.
            </p>
          </AnimateComponent>

          <AnimateComponent entry="fadeInUp" delay={240}>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                to="/operator"
                className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-emerald-400"
              >
                Run the live demo
              </Link>
              {roots?.hcs.topicId && (
                <a
                  href={`https://hashscan.io/testnet/topic/${roots.hcs.topicId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-full border border-neutral-700 px-6 py-3 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500"
                >
                  View the log on HashScan
                </a>
              )}
            </div>
          </AnimateComponent>
        </div>
      </section>

      {/* --- the mechanism ------------------------------------------------ */}
      <section className="border-t border-neutral-900 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <AnimateComponent onScroll entry="fadeInUp">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
              What it binds
            </h2>
          </AnimateComponent>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Step n="1" title="A threshold, not a vibe">
              The agent hits a hardcoded bar it cannot raise itself and pays an HTTP 402 to ask.
            </Step>
            <Step n="2" title="A witness, not the operator">
              A liveness proof from a party that is not the deployer, with a nullifier showing the
              approver isn&rsquo;t running the agent.
            </Step>
            <Step n="3" title="Silence refuses">
              No answer within the deadline is a refusal. The fail-safe direction is closed, not
              open.
            </Step>
            <Step n="4" title="Evidence with no admin key">
              The decision and its hash land on a Hedera topic nobody, including us, can edit
              after the fact.
            </Step>
          </div>
        </div>
      </section>

      {/* --- real right now ------------------------------------------------ */}
      <section className="border-t border-neutral-900 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <AnimateComponent onScroll entry="fadeInUp">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
              Real right now, not a mockup
            </h2>
          </AnimateComponent>

          <AnimateComponent onScroll entry="fadeInUp" delay={80}>
            <p className="mt-5 text-neutral-400">
              Published on npm and the official MCP Registry. Any MCP-compatible client, Claude
              Desktop, Cursor, or your own agent, can install it in one line:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 font-mono text-sm text-emerald-400">
              npx -y proctor-mcp
            </pre>
          </AnimateComponent>

          <AnimateComponent onScroll entry="fadeInUp" delay={160}>
            <ul className="mt-8 space-y-3 text-sm text-neutral-400">
              <Proof>Real settlements on Hedera testnet, not simulated numbers.</Proof>
              <Proof>
                An independent verifier that recomputes the hash chain from a public mirror node
                and never talks to our server.
              </Proof>
              <Proof>Listed in the official MCP Registry, installable by name.</Proof>
            </ul>
          </AnimateComponent>
        </div>
      </section>

      {/* --- integrity and completeness are different claims ------------ */}
      <section className="border-t border-neutral-900 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <AnimateComponent onScroll entry="fadeInUp">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
              Two questions, not one
            </h2>
          </AnimateComponent>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <AnimateComponent onScroll entry="fadeInUp" delay={80}>
              <Claim
                title="Was it altered?"
                answer="The running hash chain, recomputed from genesis."
                detail="Catches insertion, removal, reordering and edits."
              />
            </AnimateComponent>
            <AnimateComponent onScroll entry="fadeInUp" delay={160}>
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
            </AnimateComponent>
          </div>

          <AnimateComponent onScroll entry="fadeInUp" delay={220}>
            <p className="mt-6 text-sm text-neutral-500">
              A tamper-evident log answers the first and stays silent on the second. An operator
              does not need to forge a refusal; they can simply decline to publish it.
            </p>
          </AnimateComponent>
        </div>
      </section>

      {/* --- check it yourself ------------------------------------------ */}
      <section className="border-t border-neutral-900 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <AnimateComponent onScroll entry="fadeInUp">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
              Check it yourself
            </h2>
          </AnimateComponent>
          <AnimateComponent onScroll entry="fadeInUp" delay={80}>
            <p className="mt-5 text-neutral-400">
              Zero dependencies, <code className="text-neutral-300">node:crypto</code> only. It
              contacts Hedera&rsquo;s public mirror node and nothing of ours.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 font-mono text-sm text-emerald-400">
              bun verify/bin/verify.ts --topic {roots?.hcs.topicId ?? '0.0.…'}
            </pre>
          </AnimateComponent>
        </div>
      </section>

      {/* --- honest limits ---------------------------------------------- */}
      <section className="border-t border-neutral-900 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <AnimateComponent onScroll entry="fadeInUp">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-6">
              <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
                What we do not claim
              </h2>
              <ul className="mt-4 space-y-2 text-sm text-neutral-400">
                <li>
                  We hold the submit key, so we can write a false entry. What the log prevents is
                  retroactively editing or deleting one.
                </li>
                <li>
                  Two distinct nullifiers do not prove two humans. One person can hold two World
                  ID accounts. Every record says which property it carries.
                </li>
                <li>
                  Completeness makes suppression loud, not impossible: an operator can still stop
                  writing entirely.
                </li>
              </ul>
            </div>
          </AnimateComponent>
        </div>
      </section>

      {/* --- final cta ---------------------------------------------------- */}
      <section className="border-t border-neutral-900 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <AnimateComponent onScroll entry="fadeInUp">
            <h2 className="text-2xl font-semibold text-white">
              Try it. It&rsquo;s a real gate, not a slide.
            </h2>
            <p className="mt-3 text-neutral-400">
              The operator console runs the actual flow: stop the agent, page a witness, watch the
              decision settle on-chain.
            </p>
            <Link
              to="/operator"
              className="mt-6 inline-block rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-emerald-400"
            >
              Open the operator console
            </Link>
          </AnimateComponent>
        </div>
      </section>

      <footer className="border-t border-neutral-900 px-6 py-10 font-mono text-xs text-neutral-600">
        <div className="mx-auto max-w-3xl">
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
        </div>
      </footer>
    </main>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
      <span className="font-mono text-sm text-emerald-500">{n}</span>
      <p className="mt-2 font-medium text-white">{title}</p>
      <p className="mt-2 text-sm text-neutral-400">{children}</p>
    </div>
  );
}

function Proof({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
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
    <div className="h-full rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
      <p className="font-medium text-white">{title}</p>
      <p className="mt-2 text-sm text-neutral-300">{answer}</p>
      <p className="mt-2 text-sm text-neutral-500">{detail}</p>
      {live && (
        <p className={`mt-3 font-mono text-xs ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
          live: {live}
        </p>
      )}
    </div>
  );
}
