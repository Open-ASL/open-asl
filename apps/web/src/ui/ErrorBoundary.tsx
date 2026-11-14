import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordError } from '../diagnostics/errorLog';

interface Props {
  /** What broke, for the notice: "the game screen", "the top bar". */
  what: string;
  children: ReactNode;
  /** A smaller notice for a part of the screen rather than a whole page. */
  inline?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * A render error in `children` shows a notice with Try again and Reload instead of unmounting the whole app (React
 * removes everything above an uncaught render error). The error is recorded for bug reports.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    recordError('boundary', `${this.props.what}:`, error, info.componentStack?.split('\n').slice(1, 4).join('\n') ?? '');
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={`error-boundary ${this.props.inline ? 'inline' : ''}`} role="alert">
        <b>Something went wrong in {this.props.what}.</b>
        <p className="muted small">{error.message}</p>
        <p className="muted small">If it happens again, please use Report a bug after reloading: the report includes this error.</p>
        <div className="buttons">
          <button onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
