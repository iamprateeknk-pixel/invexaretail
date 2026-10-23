import { Component } from 'react';

// Root error boundary (System P1-15): a render crash in any section must not
// white-screen the whole app. Shows a calm fallback with a reload action and
// logs the error to the console for support. Mounted once in main.jsx around
// <App />, so it covers both the workspace and the control-plane routes.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            fontFamily: 'system-ui, sans-serif',
            background: '#f8fafc',
            color: '#0f172a',
          }}
        >
          <div
            style={{
              maxWidth: '420px',
              textAlign: 'center',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '32px 28px',
            }}
          >
            <h1 style={{ fontSize: '20px', margin: '0 0 8px' }}>Something went wrong</h1>
            <p style={{ margin: '0 0 20px', color: '#475569', lineHeight: 1.5 }}>
              The app hit an unexpected error. Your data is saved on the server — reloading usually fixes this.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: '#0f172a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Reload the app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
