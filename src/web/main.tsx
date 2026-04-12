import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";

import "@/i18n";
import { ErrorBoundary } from "@/web/components/error-boundary";
import { Toaster } from "@/web/components/ui/sonner";

import { App } from "./app";
import "./globals.css";
import { ThemeProvider } from "./providers/theme-provider";
import { reportWebVitals } from "./shared/report-vitals";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <BrowserRouter>
            <NuqsAdapter>
              <App />
              <Toaster position="top-right" richColors />
            </NuqsAdapter>
          </BrowserRouter>
        </ErrorBoundary>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

reportWebVitals();
