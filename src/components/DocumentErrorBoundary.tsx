import { Component, type ReactNode } from 'react';

export function DocumentDisplayFailure({ label = 'This document', onRetry }: { label?: string; onRetry: () => void }) {
  return <section role="alert" className="rounded border border-amber-600 bg-amber-50 p-4 space-y-2">
    <p>{label} could not be displayed. Original work and saved records have not been changed.</p>
    <p>Retry the display, or return to another submission. Keep a full backup before repairing a saved record.</p>
    <button type="button" className="rounded border bg-white px-3 py-2" onClick={onRetry}>Retry display</button>
  </section>;
}

/** Isolate a failed view without editing, clearing or migrating its saved records. */
export class DocumentErrorBoundary extends Component<{
  children: ReactNode;
  resetKey: string;
  label?: string;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return <DocumentDisplayFailure label={this.props.label} onRetry={() => this.setState({ failed: false })}/>;
    return this.props.children;
  }
}
