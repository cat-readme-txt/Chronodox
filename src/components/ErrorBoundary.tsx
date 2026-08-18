import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Chronodox render failure', error);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        className="min-h-screen flex items-center justify-center px-6 py-12 text-white"
        style={{
          background: 'linear-gradient(180deg, #02040a 0%, #07101c 48%, #04050c 100%)',
        }}
      >
        <div className="w-full max-w-2xl rounded-[28px] border border-[#ff6b3566] bg-[#0a1019ee] p-8 shadow-[0_30px_120px_rgba(0,0,0,0.42)]">
          <div className="font-['Orbitron'] text-2xl tracking-[0.18em] text-[#ffd1c1]">MISSION CONSOLE FAULT</div>
          <div className="mt-4 font-['Share_Tech_Mono'] text-[12px] leading-relaxed text-[#dbe9ff99]">
            Chronodox hit a startup fault instead of rendering the command screen. Refresh once. If the fault keeps returning,
            open the browser console and send the top error line.
          </div>
          <div className="mt-5 rounded border border-[#ffffff18] bg-[#050b12cc] px-4 py-3 font-['Share_Tech_Mono'] text-[11px] text-[#ffcf8a]">
            {this.state.error.message}
          </div>
        </div>
      </div>
    );
  }
}
