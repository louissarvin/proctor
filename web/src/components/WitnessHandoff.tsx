import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Hand a decision to a phone by showing a QR code.
 *
 * WHY THIS EXISTS RATHER THAN PUSH. Web Push needs a service worker, which needs
 * a secure context, which needs HTTPS — and it needs the witness to have granted
 * notification permission on that exact origin beforehand. Every one of those is
 * a way for the handoff to fail silently in front of a camera.
 *
 * A QR code is World's own documented desktop flow: the challenge is displayed
 * on the desktop and the phone scans it. It has no prerequisites, it fails
 * visibly rather than silently, and the witness's phone needs nothing installed
 * except the World ID App they will use anyway.
 *
 * THE URL MUST NOT BE localhost. A phone cannot resolve the operator's
 * localhost, so the link has to be an address the phone can actually reach.
 * That is checked below and said out loud rather than rendering a QR code that
 * leads nowhere.
 */
export function WitnessHandoff({ url, humanLine }: { url: string; humanLine: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unreachable = /localhost|127\.0\.0\.1/.test(url);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: 320,
      margin: 1,
      // High contrast and generous quiet zone: this gets scanned off a screen,
      // sometimes at an angle, sometimes on camera.
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then((d) => { if (!cancelled) setDataUrl(d); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'QR failed'); });
    return () => { cancelled = true; };
  }, [url]);

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
      <p className="text-xs uppercase tracking-widest text-neutral-500">Hand this decision to a witness</p>
      <p className="mt-3 text-lg font-medium text-white">{humanLine}</p>

      {unreachable && (
        <p className="mt-4 rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          This link points at <code>localhost</code>, which a phone cannot reach. Set{' '}
          <code>WITNESS_APP_URL</code> to an address the phone can open — a tunnel or a
          deployment. The QR below will scan, and then fail to load.
        </p>
      )}

      <div className="mt-5 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {dataUrl ? (
          // White plate behind the code: scanners struggle with an inverted QR
          // on a dark background, and this console is dark.
          <div className="rounded-lg bg-white p-3">
            <img src={dataUrl} alt="Scan to open this decision on a phone" width={320} height={320} />
          </div>
        ) : (
          <div className="flex h-[344px] w-[344px] items-center justify-center rounded-lg border border-neutral-800 text-sm text-neutral-600">
            {error ?? 'rendering…'}
          </div>
        )}

        <ol className="space-y-2 text-sm text-neutral-400">
          <li>1. The witness scans this with their phone camera.</li>
          <li>2. The decision opens, showing one line and a countdown.</li>
          <li>3. They prove liveness with World ID, bound to this decision.</li>
          <li>4. Approve or refuse. No answer inside the deadline is a refusal.</li>
        </ol>
      </div>

      <p className="mt-4 break-all font-mono text-xs text-neutral-600">{url}</p>
    </section>
  );
}
