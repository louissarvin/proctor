import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { WitnessHandoff } from '@/components/WitnessHandoff';
import { getWitnessDecision } from '@/lib/proctor/api';

export const Route = createFileRoute('/handoff/$token')({ component: Handoff });

/**
 * Operator-side screen: show a QR that hands one decision to a phone.
 *
 * THE TOKEN COMES FROM THE URL, NEVER FROM AN API.
 *
 * A witness token is a bearer credential — whoever holds it can resolve the
 * decision. The evidence API is unauthenticated by design, because it serves
 * auditors, so adding "give me the token for the live decision" there would let
 * any reader of the console approve a EUR 41,200 payment. Instead the operator
 * already has the token (the CLI prints it) and pastes it here. No new endpoint,
 * no new way to leak it.
 *
 * The QR is built from THIS PAGE'S ORIGIN, not from configuration. If you opened
 * this page through a tunnel, the phone gets the tunnel; if you opened it on
 * localhost, the warning fires. The link a phone receives is therefore correct
 * by construction rather than by remembering to set a variable.
 */
function Handoff() {
  const { token } = Route.useParams();
  const [humanLine, setHumanLine] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/w/${token}`;

  useEffect(() => {
    getWitnessDecision(token)
      .then((d) => setHumanLine(d.humanLine))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the decision'));
  }, [token]);

  return (
    <main className="min-h-dvh bg-neutral-950 px-6 py-10 text-neutral-200">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-500">Proctor</p>
        <h1 className="mt-3 text-xl font-semibold text-white">Witness handoff</h1>

        {error ? (
          <p className="mt-6 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}. A decision link is single-use and short-lived; open a new one with{' '}
            <code>bun run open</code>.
          </p>
        ) : (
          <div className="mt-6">
            <WitnessHandoff url={url} humanLine={humanLine || 'Loading the decision…'} />
          </div>
        )}

        <p className="mt-6 text-sm text-neutral-500">
          Web Push would need a service worker, a secure context, and permission granted on
          this exact origin beforehand — three ways for a handoff to fail silently on camera.
          A QR code is World&rsquo;s own documented desktop flow and fails visibly instead.
        </p>
      </div>
    </main>
  );
}
