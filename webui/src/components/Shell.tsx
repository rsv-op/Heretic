"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { cn, api } from "@/lib/client";
import type { PublicUser } from "@/lib/auth";
import { ToastProvider, useToast, Badge, Button } from "@/components/ui";
import { Scramble } from "@/components/motion";
import {
  Bolt,
  Branch,
  Bug,
  Chevron,
  Droid,
  FolderScan,
  Gate,
  Gauge,
  Layers,
  Ledger,
  Logout,
  Menu,
  Search,
  Settings,
  Sigil,
  User,
  Waveform,
} from "@/components/Icons";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  hint: string;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Command",
    items: [
      { href: "/dashboard", label: "Overview", icon: <Gauge width={17} height={17} />, hint: "Live counters" },
      { href: "/dashboard/chat", label: "Chat & Voice", icon: <Waveform width={17} height={17} />, hint: "STT → core → TTS" },
    ],
  },
  {
    label: "Loop",
    items: [
      { href: "/dashboard/errors", label: "Error Loop", icon: <Bug width={17} height={17} />, hint: "WHAT / WHY / SOLUTION" },
      { href: "/dashboard/files", label: "File Assessor", icon: <FolderScan width={17} height={17} />, hint: "WORKS / PARTIAL / NO" },
      { href: "/dashboard/repos", label: "Repo Tracker", icon: <Branch width={17} height={17} />, hint: "Weighted milestones" },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/dashboard/gates", label: "Auth Gates", icon: <Gate width={17} height={17} />, hint: "Hash-chained ledger" },
      { href: "/dashboard/decisions", label: "Decision Log", icon: <Ledger width={17} height={17} />, hint: "Reasoning required" },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/dashboard/android", label: "Android Project", icon: <Droid width={17} height={17} />, hint: "Kotlin sources + CI" },
      { href: "/dashboard/settings", label: "Settings", icon: <Settings width={17} height={17} />, hint: "Operator + workspace" },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export function Shell({ user, children }: { user: PublicUser; children: ReactNode }) {
  return (
    <ToastProvider>
      <ShellInner user={user}>{children}</ShellInner>
    </ToastProvider>
  );
}

function ShellInner({ user, children }: { user: PublicUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [drawer, setDrawer] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => setDrawer(false), [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = useMemo(
    () => ALL_ITEMS.find((item) => (item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href))),
    [pathname],
  );

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }, [router]);

  const nativeBridge = typeof window !== "undefined" && Boolean(window.HereticNative);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16.5rem_1fr]">
      {/* sidebar -------------------------------------------------------- */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[16.5rem] flex-col border-r border-line bg-abyss/95 backdrop-blur-xl transition-transform duration-300 lg:translate-x-0",
          drawer ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-md border border-ember/40 bg-ember/10 text-ember">
            <Sigil width={20} height={20} />
            <span className="absolute inset-0 rounded-md border border-ember/25 animate-pulse-ring" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold leading-none tracking-tight text-chalk">
              HERETIC<span className="text-ember">.ai</span>
            </p>
            <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-ash2">offline core 2.3.0</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="mb-2 px-2 font-mono text-[9.5px] uppercase tracking-[0.24em] text-ash2/80">{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = active?.href === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-all duration-200",
                          isActive ? "bg-ember/10 text-chalk" : "text-ash hover:bg-white/[0.04] hover:text-chalk",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-ember transition-all duration-300",
                            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40",
                          )}
                        />
                        <span className={cn("transition-colors", isActive ? "text-ember" : "text-ash2 group-hover:text-ash")}>
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.label}</span>
                          <span className="block truncate font-mono text-[9.5px] uppercase tracking-[0.14em] text-ash2/70">
                            {item.hint}
                          </span>
                        </span>
                        {isActive ? <Chevron width={13} height={13} className="text-ember/70" /> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-3 py-3">
          <div className="rounded-lg border border-line bg-panel/70 p-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line2 bg-panel2 text-embersoft">
                <User width={16} height={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-chalk">{user.name}</p>
                <p className="truncate font-mono text-[10px] text-ash2">@{user.handle}</p>
              </div>
            </div>
            <p className="mt-2.5 truncate font-mono text-[10px] text-ash2">{user.deviceModel}</p>
            <div className="mt-3 flex items-center gap-2">
              <Link href="/dashboard/settings" className="flex-1">
                <Button size="sm" variant="ghost" className="w-full justify-start">
                  <Settings width={13} height={13} /> Settings
                </Button>
              </Link>
              <Button size="sm" variant="ghost" onClick={logout} title="Sign out">
                <Logout width={14} height={14} />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-40 bg-void/70 backdrop-blur-sm lg:hidden" onClick={() => setDrawer(false)} role="presentation" />
      ) : null}

      {/* main ------------------------------------------------------------ */}
      <div className="min-w-0 lg:col-start-2">
        <header className="sticky top-0 z-30 border-b border-line bg-void/85 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              className="rounded-md border border-line2 p-2 text-ash transition hover:text-chalk lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
            >
              <Menu width={17} height={17} />
            </button>

            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ash2">
                {active ? active.hint : "command center"}
              </p>
              <Scramble
                key={pathname}
                text={(active?.label ?? "Overview").toUpperCase()}
                className="truncate font-display text-lg font-semibold tracking-tight text-chalk"
                speed={22}
              />
            </div>

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-md border border-line2 bg-panel/70 px-3 py-1.5 text-[12px] text-ash transition hover:border-ember/40 hover:text-chalk md:flex"
            >
              <Search width={14} height={14} />
              <span>Jump to…</span>
              <kbd className="rounded border border-line2 bg-abyss px-1.5 py-0.5 font-mono text-[10px] text-ash2">⌘K</kbd>
            </button>

            <div className="hidden items-center gap-2 lg:flex">
              <Badge tone={nativeBridge ? "mint" : "ember"} dot>
                {nativeBridge ? "native bridge" : "browser fallback"}
              </Badge>
              <span className="font-mono text-[11px] tabular-nums text-ash2">
                {clock.toLocaleTimeString(undefined, { hour12: false })}
              </span>
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>

      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onAction={async (action) => {
            setPaletteOpen(false);
            if (action.href) router.push(action.href);
            if (action.run) {
              try {
                const message = await action.run();
                toast.push("success", action.label, message);
                router.refresh();
              } catch (error) {
                toast.push("error", action.label, error instanceof Error ? error.message : "failed");
              }
            }
          }}
        />
      ) : null}
    </div>
  );
}

interface PaletteAction {
  label: string;
  group: string;
  href?: string;
  run?: () => Promise<string>;
}

function CommandPalette({
  onClose,
  onAction,
}: {
  onClose: () => void;
  onAction: (action: PaletteAction) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const actions: PaletteAction[] = useMemo(
    () => [
      ...ALL_ITEMS.map((item) => ({ label: item.label, group: "Navigate", href: item.href })),
      {
        label: "Run APK build pipeline",
        group: "Actions",
        href: "/dashboard/android",
        run: async () => {
          const result = await api<{ run: { runNumber: number; status: string } }>("/api/android/builds", {
            method: "POST",
            json: { trigger: "command-palette" },
          });
          return `run #${result.run.runNumber} → ${result.run.status}`;
        },
      },
      {
        label: "Download Android source bundle",
        group: "Actions",
        href: "/api/android/bundle",
      },
      {
        label: "Reset every authorization gate",
        group: "Actions",
        href: "/dashboard/gates",
        run: async () => {
          await api("/api/gates/reset", { method: "POST" });
          return "all grants cleared, ledger re-chained from genesis";
        },
      },
      {
        label: "Reload demo workspace data",
        group: "Actions",
        href: "/dashboard/settings",
        run: async () => {
          await api("/api/seed", { method: "POST" });
          return "demo workspace re-seeded";
        },
      },
    ],
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q) || a.group.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((i) => Math.min(filtered.length - 1, i + 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
      if (event.key === "Enter" && filtered[index]) onAction(filtered[index]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, index, onClose, onAction]);

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-void/85 backdrop-blur-sm" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line2 bg-panel shadow-[0_40px_120px_-40px_rgba(0,0,0,0.95)]">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search width={16} height={16} className="text-ember" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workflows, run builds, reset gates…"
            className="flex-1 bg-transparent text-sm text-chalk placeholder:text-ash2 focus:outline-none"
          />
          <kbd className="rounded border border-line2 px-1.5 py-0.5 font-mono text-[10px] text-ash2">ESC</kbd>
        </div>
        <ul className="max-h-[52vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-ash">No matching command.</li>
          ) : (
            filtered.map((action, i) => (
              <li key={`${action.group}-${action.label}`}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => onAction(action)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left transition",
                    i === index ? "bg-ember/10" : "hover:bg-white/[0.03]",
                  )}
                >
                  <span className={cn(i === index ? "text-ember" : "text-ash2")}>
                    {action.group === "Navigate" ? <Chevron width={14} height={14} /> : <Bolt width={14} height={14} />}
                  </span>
                  <span className="flex-1 text-sm text-chalk">{action.label}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ash2">{action.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center gap-4 border-t border-line bg-panel2/40 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ash2">
          <span className="flex items-center gap-1.5">
            <Layers width={12} height={12} /> six workflows resident
          </span>
          <span className="ml-auto">↑↓ navigate · ↵ run</span>
        </div>
      </div>
    </div>
  );
}
