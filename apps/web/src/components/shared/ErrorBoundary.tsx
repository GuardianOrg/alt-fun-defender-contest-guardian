import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--txt-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <div>Something went wrong.</div>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              color: "var(--mint)",
              padding: "0.5rem 1rem",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
