import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    SERVER_URL: z.string().url().optional(),
  },

  /**
   * The prefix that client-side variables must have. This is enforced both at
   * a type-level and at runtime.
   */
  clientPrefix: 'VITE_',

  client: {
    VITE_APP_TITLE: z.string().min(1).optional(),
    /** Proctor API. The witness PWA and console both talk to this. */
    /**
     * Proctor API base.
     *
     * A PHONE CANNOT USE localhost. The witness flow ends on a phone, so for any
     * real test this must be an address that phone can reach: the LAN IP over
     * http, or a tunnel over https. Mixing schemes fails — an https page cannot
     * call an http API.
     */
    VITE_API_URL: z.string().url().default('http://localhost:3700'),
    /** World ID app id. PUBLIC. The RP *signing key* never leaves the server. */
    VITE_WORLD_APP_ID: z.string().optional(),
    /**
     * DEVICE until the Selfie Check beta flag is granted, then SELFIE.
     * The verification path is identical; this is the one-line swap.
     */
    VITE_WORLD_MODE: z.enum(['DEVICE', 'SELFIE']).default('DEVICE'),
  },

  /**
   * What object holds the environment variables at runtime. This is usually
   * `process.env` or `import.meta.env`.
   */
  runtimeEnv: import.meta.env,

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   *
   * This means that if you have an empty string for a value that is supposed
   * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
   * it as a type mismatch violation. Additionally, if you have an empty string
   * for a value that is supposed to be a string with a default value (e.g.
   * `DOMAIN=` in an ".env" file), the default value will never be applied.
   *
   * In order to solve these issues, we recommend that all new projects
   * explicitly specify this option as true.
   */
  emptyStringAsUndefined: true,
})
