import { Component, type ReactNode } from 'react'

// Shows a readable error instead of a blank page if rendering crashes.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty-state">
        <h2>Something went wrong</h2>
        <p>Please reload the page. If it keeps happening, this is the error:</p>
        <pre style={{ whiteSpace: 'pre-wrap', textAlign: 'left', fontSize: 12, background: '#fff0f0', padding: 12, borderRadius: 8 }}>
          {String(this.state.error?.stack || this.state.error)}
        </pre>
        <button className="new-button" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}
