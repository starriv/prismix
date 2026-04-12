import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/web/components/ui/button";
import { reportError } from "@/web/shared/error-reporting";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Root-level React error boundary.
 *
 * Catches unhandled render errors and displays a recovery UI
 * instead of a blank white screen.
 */
class ErrorBoundaryInner extends Component<Props & { fallback: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function ErrorFallback() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold text-foreground">{t("common.error-boundary.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("common.error-boundary.desc")}</p>
        <Button onClick={() => window.location.reload()}>
          {t("common.error-boundary.reload")}
        </Button>
      </div>
    </div>
  );
}

export function ErrorBoundary({ children }: Props) {
  return <ErrorBoundaryInner fallback={<ErrorFallback />}>{children}</ErrorBoundaryInner>;
}
