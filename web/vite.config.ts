import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  plugins: [
    devtools(),
    nitro(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

// Bind to every interface, not just localhost.
//
// The witness flow ends on a PHONE, and a phone cannot resolve the operator's
// localhost. Vite's default binding silently makes the whole handoff
// untestable on real hardware: the QR scans, then the page fails to load.
config.server = {
  ...(config.server ?? {}),
  host: true,
  // Allow tunnel hostnames in development.
  //
  // Vite rejects unknown Host headers to prevent DNS-rebinding attacks, which
  // is correct — but it also blocks the tunnel the witness phone must come
  // through, with a 403 that reads like a broken tunnel rather than a policy.
  // Scoped to tunnel providers rather than `true`, so the protection still
  // applies to everything else.
  allowedHosts: ['.ngrok-free.app', '.ngrok.io', '.trycloudflare.com'],

};

// NOT proxied, deliberately. TanStack Start's router answers `/api/v1/...` with
// the SPA shell before Vite's proxy middleware ever runs — `/.well-known` only
// falls through because a dot-prefixed segment is excluded from routing, which
// makes the failure look intermittent rather than structural. Point
// VITE_API_URL at the backend directly instead; see web/.env.example for the
// two configurations that actually work on a phone.

// IDKit ships a wasm-bindgen binary. Vite's dependency optimiser rewrites the
// package's JS into .vite/deps but does NOT copy `idkit_wasm_bg.wasm` next to
// it, so the runtime fetch 404s and the SDK dies with
//
//   Failed to initialize IDKit WASM: HTTP status code is not ok
//
// which surfaces to the app as an EMPTY `Flow error: {}` and `generic_error`.
// Excluding the packages leaves them unbundled, so the .wasm resolves from
// node_modules and loads. This is the difference between the World flow
// working and failing identically for every credential.
config.optimizeDeps = {
  ...(config.optimizeDeps ?? {}),
  exclude: [
    ...(config.optimizeDeps?.exclude ?? []),
    // ONLY idkit-core. It owns idkit_wasm_bg.wasm, and excluding it is what
    // makes the binary resolve from node_modules instead of 404ing in
    // .vite/deps. Excluding the React wrapper too would leave ITS imports
    // unrewritten, and its CJS dependency `qrcode` then fails with "does not
    // provide an export named 'default'".
    '@worldcoin/idkit-core',
  ],
  // Excluding IDKit also stops Vite pre-bundling its CommonJS dependencies.
  // `qrcode` is CJS and has no ESM default export, so the widget then dies
  // with "does not provide an export named 'default'". Force these through
  // the CJS->ESM conversion while leaving IDKit itself unbundled.
  include: [
    ...(config.optimizeDeps?.include ?? []),
    'qrcode',
  ],
};

export default config
