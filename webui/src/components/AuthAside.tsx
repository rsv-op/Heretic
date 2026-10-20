"use client";

import { KenBurns } from "@/components/motion";
import { Badge } from "@/components/ui";
import { Gate, Layers, Lock, Mic, Terminal } from "@/components/Icons";

const POINTS = [
  { icon: <Lock width={15} height={15} />, label: "No INTERNET permission", note: "declared absent in AndroidManifest.xml" },
  { icon: <Mic width={15} height={15} />, label: "Runtime-only microphone", note: "requested the instant you tap" },
  { icon: <Gate width={15} height={15} />, label: "Hash-chained consent ledger", note: "tampering is detectable offline" },
  { icon: <Layers width={15} height={15} />, label: "Zero background drain", note: "no services, receivers or jobs" },
];

export function AuthAside() {
  return (
    <aside className="relative hidden overflow-hidden border-r border-line bg-abyss lg:block">
      <div className="absolute inset-0 opacity-45">
        <KenBurns src="/images/hero-device.jpg" alt="HeretIc on an Android device" duration={30} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-br from-void via-void/85 to-void/40" />
      <div className="absolute inset-0 grid-etch opacity-40" />

      <div className="relative flex h-full flex-col justify-between p-10">
        <div>
          <Badge tone="ember" dot>
            offline core 2.3.0
          </Badge>
          <h2 className="mt-6 max-w-sm font-display text-[2.1rem] font-semibold leading-[1.06] tracking-tight text-chalk">
            An assistant that cannot phone home — because the permission was never declared.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ash">
            Heretic.ai pairs a single-file React command center with a native Kotlin core: real speech recognition, real
            text-to-speech, real Storage Access Framework picks, LiteRT inference and a deterministic rule brain.
          </p>
        </div>

        <ul className="max-w-sm space-y-3">
          {POINTS.map((point) => (
            <li key={point.label} className="flex items-start gap-3 rounded-lg border border-line bg-panel/60 px-3.5 py-3 backdrop-blur-sm">
              <span className="mt-0.5 text-ember">{point.icon}</span>
              <span>
                <span className="block font-display text-[13px] font-semibold text-chalk">{point.label}</span>
                <span className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-ash2">{point.note}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">
          <Terminal width={13} height={13} /> ai.heretic.app · gradle 8.7 · jdk 17
        </p>
      </div>
    </aside>
  );
}
