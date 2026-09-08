import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import HeroUIProvider from '../providers/HeroUIProvider'
import LenisSmoothScrollProvider from '../providers/LenisSmoothScrollProvider'
import { ThemeProvider } from '../providers/ThemeProvider'
import ErrorPage from '../components/ErrorPage'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  errorComponent: ({ error, reset }) => <ErrorPage error={error} reset={reset} />,

  /**
   * Without this, TanStack renders a bare unstyled `<p>Not Found</p>` on a dark
   * app. The realistic way a human meets it is a witness link that has expired
   * or been mistyped, so it answers that rather than saying "404": an expired
   * decision is already refused, and the person needs to know they have not
   * accidentally approved anything.
   */
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-start justify-center px-6 py-10">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">Proctor</p>
      <h1 className="mt-4 text-2xl font-semibold text-white">This link is not valid</h1>
      <p className="mt-4 text-neutral-400">
        It may have expired, already been used, or been typed incorrectly. Decision links are
        single-use and short-lived by design.
      </p>
      <p className="mt-4 text-sm text-neutral-500">
        Nothing was approved. A decision that reaches its deadline without an answer is refused
        automatically, so no action was taken on your behalf.
      </p>
    </main>
  ),
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Proctor — human oversight for AI agents, with evidence',
      },
      {
        name: 'description',
        content: 'An AI agent stops mid-payment and pays a live, verified human for permission to continue. The product is the evidence, not the approval.',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme) {
                    theme = JSON.parse(theme);
                  }
                  document.documentElement.classList.add(theme || 'dark');
                } catch (e) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className="bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 antialiased transition-colors duration-300">
        <ThemeProvider>
          <HeroUIProvider>
            <LenisSmoothScrollProvider />
            {children}
            <TanStackDevtools
              config={{
                position: 'bottom-right',
              }}
              plugins={[
                {
                  name: 'Tanstack Router',
                  render: <TanStackRouterDevtoolsPanel />,
                },
                TanStackQueryDevtools,
              ]}
            />
          </HeroUIProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
