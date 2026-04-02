import type { ReactNode } from 'react';

export default function SiteFundRequisition2Layout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="relative w-full overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50" />
        <div className="absolute inset-0 aurora-noise opacity-70" />
        <div className="absolute inset-0 bg-aurora-grid opacity-40" />

        <div className="absolute -left-28 top-[-5rem] h-80 w-80 rounded-full bg-cyan-400/25 blur-[110px] animate-float" />
        <div
          className="absolute right-[-8rem] top-12 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-[140px] animate-pulse-glow"
          style={{ animationDelay: '-1.2s' }}
        />
        <div
          className="absolute bottom-[-9rem] left-1/3 h-[28rem] w-[28rem] rounded-full bg-amber-300/25 blur-[160px] animate-pulse-glow"
          style={{ animationDelay: '-2.6s' }}
        />
        <div
          className="absolute bottom-[-10rem] right-[-8rem] h-[26rem] w-[26rem] rounded-full bg-emerald-400/15 blur-[170px] animate-float"
          style={{ animationDelay: '-1.8s' }}
        />
      </div>

      <div className="relative">{children}</div>
    </div>
  );
}

