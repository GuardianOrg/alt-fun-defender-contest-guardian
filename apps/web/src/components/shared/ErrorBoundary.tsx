import { Component, type ErrorInfo, type ReactNode } from "react";

import Button from "./Button";
import Fallback from "./Fallback";
import { HOME_ROUTE } from "../../app/routes";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught error:", {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleGoHome = () => {
    // Hard navigation guarantees the broken subtree fully unmounts and any
    // module-level state (websockets, query cache entries, etc.) is reset.
    window.location.assign(HOME_ROUTE);
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      const error = this.state.error;
      const details = error
        ? [error.message, error.stack].filter(Boolean).join("\n\n")
        : undefined;
      return (
        <Fallback
          code="ERR"
          title="Something went wrong"
          message="An unexpected error broke this view. You can try again or head back to the homepage."
          details={details}
          actions={
            <>
              <Button variant="primary" size="md" onClick={this.handleGoHome}>
                Return to home
              </Button>
              <Button variant="secondary" size="md" onClick={this.handleRetry}>
                Try again
              </Button>
            </>
          }
        />
      );
    }
    return this.props.children;
  }
}
