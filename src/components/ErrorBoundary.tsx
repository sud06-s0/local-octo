// src/components/ErrorBoundary.tsx
// Shows a friendly screen instead of a blank page if something crashes.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { isChunkError, reloadOnce } from '../lib/lazyPage'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App error:', error, info.componentStack)
    // Missing files after a deploy: reload once automatically
    if (isChunkError(error)) reloadOnce()
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Navigating to another page clears the error
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-sm rounded-xl border border-line bg-white p-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50">
            <TriangleAlert className="size-6 text-amber-600" />
          </span>
          <p className="mt-4 text-[17px] font-semibold">Something went wrong</p>
          <p className="mt-1 text-sm text-muted">This page didn't load properly. Reloading usually fixes it.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800"
          >
            <RefreshCw className="size-4" /> Reload
          </button>
        </div>
      </div>
    )
  }
}
