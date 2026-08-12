import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * React error boundaries must be class components — there is no hook
 * equivalent as of React 18. A crash anywhere in the tree (a bad API
 * response shape, a null-pointer in a component) would otherwise unmount
 * the whole app and leave a blank white screen, which on an installed PWA
 * looks indistinguishable from the app simply failing to launch.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error in the component tree', error, info.componentStack)
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div>
          <p>Something went wrong. Reloading usually fixes it.</p>
          <button type="button" onClick={() => globalThis.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
