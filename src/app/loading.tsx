/**
 * Root loading.tsx — shown by Next.js while any page is loading.
 * Uses the app's dark electric brand aesthetic with animated dots.
 */
export default function RootLoading() {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#020617]">

      {/* Ambient glow orbs */}
      <div
        className="pointer-events-none absolute left-1/4 top-1/4 h-[40vw] w-[40vw] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.18) 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute bottom-1/4 right-1/4 h-[35vw] w-[35vw] translate-x-1/2 translate-y-1/2 rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)' }}
      />

      {/* Subtle dot-grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: 'radial-gradient(circle, rgba(99,179,237,0.6) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
      />

      {/* Centre content */}
      <div className="relative z-10 flex flex-col items-center gap-8">

        {/* Logo mark */}
        <div className="relative">
          {/* Pulsing ring */}
          <div
            className="absolute inset-0 rounded-2xl"
            style={{ animation: 'ping-slow 2s cubic-bezier(0,0,0.2,1) infinite', background: 'rgba(6,182,212,0.2)' }}
          />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/30 bg-gradient-to-br from-cyan-500 to-blue-600 shadow-[0_0_40px_rgba(6,182,212,0.5)]">
            {/* SEL text logo */}
            <span className="text-lg font-black tracking-widest text-white">SEL</span>
          </div>
        </div>

        {/* Brand name */}
        <div className="text-center">
          <p className="text-base font-semibold tracking-[0.2em] text-cyan-100">SIDDHARTHA</p>
          <p className="text-xs tracking-[0.35em] text-cyan-400/70">ENGINEERING LIMITED</p>
        </div>

        {/* Animated loading bar */}
        <div className="relative h-0.5 w-48 overflow-hidden rounded-full bg-white/10">
          <div
            className="absolute inset-y-0 left-0 w-1/3 rounded-full"
            style={{
              background: 'linear-gradient(90deg, transparent, #06b6d4, #3b82f6, transparent)',
              animation: 'loading-sweep 1.6s ease-in-out infinite',
            }}
          />
        </div>

        {/* Loading dots */}
        <div className="flex items-center gap-2">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-cyan-400"
              style={{ animation: `dot-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
            />
          ))}
        </div>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes ping-slow {
          0%   { transform: scale(1);   opacity: 0.6; }
          80%  { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes loading-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes dot-bounce {
          0%, 60%, 100% { transform: translateY(0);    opacity: 0.4; }
          30%            { transform: translateY(-6px); opacity: 1;   }
        }
      `}</style>
    </div>
  );
}
