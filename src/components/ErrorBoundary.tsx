import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Optional label used in the recovery UI / log line (e.g. "TimerStage"). */
  scope?: string;
  /** Optional custom fallback. If omitted, the default recovery card renders. */
  fallback?: ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Generic React error boundary.
 *
 * Wraps a subtree so an exception in one component (bad data, render crash,
 * undefined deref) cannot unmount the whole app — a single broken pane is
 * far better UX than a blank window. The default fallback offers "try again"
 * (resets the boundary) and surfaces the error message + stack for support.
 *
 * Use at every load-bearing boundary: each sidebar panel, the timer stage,
 * the notes panel, the habits pane, every popout root.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to devtools and the persistent console; in a release build the
    // user can also copy the text from the fallback card.
    console.error(
      `[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    const msg = this.state.error.message || String(this.state.error);
    return (
      <div
        role="alert"
        className="m-3 rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-ink-200"
      >
        <div className="font-medium text-rose-300">
          Something went wrong{this.props.scope ? ` in ${this.props.scope}` : ""}.
        </div>
        <div className="mt-2 font-mono text-xs text-ink-300 break-all">{msg}</div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-md border border-ink-700 px-3 py-1 text-xs hover:bg-ink-800"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => location.reload()}
            className="rounded-md border border-ink-700 px-3 py-1 text-xs hover:bg-ink-800"
          >
            Reload window
          </button>
        </div>
      </div>
    );
  }
}
