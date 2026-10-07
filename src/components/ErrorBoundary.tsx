import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-white">
        <h1 className="mb-4 text-3xl font-bold text-red-500">Algo deu errado.</h1>
        <p className="mb-4 text-slate-300">Ocorreu um erro inesperado na aplicação.</p>
        <pre className="max-w-full overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-red-300">
          {this.state.error.message}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 rounded-full bg-purple-600 px-6 py-3 font-bold transition-colors hover:bg-purple-500"
        >
          Recarregar página
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
