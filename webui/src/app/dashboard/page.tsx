"use client";

import Link from "next/link";
import { useState } from "react";
import { cn, formatBytes, hashShort, timeAgo, useResource } from "@/lib/client";
import type { DashboardPayload, ProfileRow } from "@/lib/types";
import {
  Badge,
  Button,
  EmptyState,
  KeyValue,
  Panel,
  ProgressBar,
  SectionHeading,
  Skeleton,
  StatTile,
  useToast,
} from "@/components/ui";
import { CountUp, Reveal } from "@/components/motion";
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
  Lock,
  Refresh,
  Terminal,
  Waveform,
} from "@/components/Icons";

const HEALTH_TONE: Record<string, "mint" | "signal" | "rose" | "ember" | "neutral"> = {
  SHIPPED: "mint",
  ON_TRACK: "mint",
  AT_RISK: "signal",
  BLOCKED: "rose",
  EMPTY: "neutral",
};

export default function OverviewPage() {
  const { data: payload, loading, error, refetch } = useResource<DashboardPayload>("/api/dashboard");
  const { data: profileData } = useResource<{ profiles: ProfileRow[] }>("/api/profiles");
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const counters = payload?.counters;

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    toast.push("info", "Telemetry refreshed", "Counters re-read from the workspace.");
  };

  if (error) {
    return (
      <Panel>
        <EmptyState
          icon={<Bolt width={22} height={22} />}
          title="Command center could not reach the core"
          body={error}
          action={<Button onClick={() => void refetch()} icon={<Refresh width={14} height={14} />}>Retry</Button>}
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="command center"
        title="Offline status board"
        description="Every counter below is read from your workspace in Postgres — the same store the Android core mirrors on-device. No telemetry leaves the process."
        right={
          <>
            <Badge tone="mint" dot>
              core resident
            </Badge>
            <Button size="sm" onClick={refresh} loading={refreshing} icon={<Refresh width={13} height={13} />}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "voice sessions",
            value: counters?.conversations ?? 0,
            sub: `${counters?.messages ?? 0} messages through HereticCore`,
            icon: <Waveform width={16} height={16} />,
            tone: "ember" as const,
            href: "/dashboard/chat",
          },
          {
            label: "open error cases",
            value: counters?.openErrors ?? 0,
            sub: `${counters?.passedErrors ?? 0} passed · ${counters?.failedErrors ?? 0} failed`,
            icon: <Bug width={16} height={16} />,
            tone: "signal" as const,
            href: "/dashboard/errors",
          },
          {
            label: "files assessed",
            value: counters?.files ?? 0,
            sub: `${counters?.filesWorks ?? 0} works · ${counters?.filesRejected ?? 0} not relevant`,
            icon: <FolderScan width={16} height={16} />,
            tone: "ice" as const,
            href: "/dashboard/files",
          },
          {
            label: "decisions logged",
            value: counters?.decisions ?? 0,
            sub: "each with its mandatory reasoning sentence",
            icon: <Ledger width={16} height={16} />,
            tone: "mint" as const,
            href: "/dashboard/decisions",
          },
        ].map((tile, index) => (
          <Reveal key={tile.label} delay={index * 55}>
            <Link href={tile.href} className="block">
              {loading ? (
                <Skeleton className="h-[7.6rem] w-full" />
              ) : (
                <StatTile {...tile} value={tile.value} pending={false} />
              )}
            </Link>
          </Reveal>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* repository health */}
        <Reveal className="xl:col-span-2">
          <Panel className="h-full p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">repository progress</p>
                <h3 className="mt-1 font-display text-base font-semibold tracking-tight">Weighted milestone tracking</h3>
              </div>
              <Link href="/dashboard/repos">
                <Button size="sm" variant="ghost" icon={<Branch width={13} height={13} />}>
                  Open tracker
                </Button>
              </Link>
            </div>

            <div className="mt-5 space-y-4">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
              ) : payload?.repos.length ? (
                payload.repos.map((repo) => (
                  <div key={repo.id} className="rounded-lg border border-line bg-abyss/40 p-4 transition-colors hover:border-line2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-display text-[14px] font-semibold text-chalk">{repo.name}</p>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10.5px] text-ash2">{repo.branch}</span>
                        <Badge tone={HEALTH_TONE[repo.health] ?? "neutral"}>{repo.health.replace(/_/g, " ")}</Badge>
                      </div>
                    </div>
                    <ProgressBar
                      className="mt-3"
                      value={repo.progress}
                      tone={repo.health === "BLOCKED" ? "rose" : repo.health === "AT_RISK" ? "signal" : "ember"}
                      label="weighted progress"
                    />
                    <p className="mt-2.5 text-[12.5px] text-ash">→ {repo.nextAction}</p>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={<Branch width={20} height={20} />}
                  title="No repositories tracked yet"
                  body="Add a repository and grade its milestones IMPLEMENT NOW, DEFER or CHANGES NEEDED to see weighted progress here."
                  action={
                    <Link href="/dashboard/repos">
                      <Button variant="primary" size="sm">Open repo tracker</Button>
                    </Link>
                  }
                />
              )}
            </div>
          </Panel>
        </Reveal>

        {/* telemetry */}
        <Reveal delay={70}>
          <Panel className="h-full p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">core telemetry</p>
              <Badge tone={payload?.audit.chainIntact ? "mint" : "rose"} dot>
                {payload?.audit.chainIntact ? "ledger intact" : "ledger broken"}
              </Badge>
            </div>

            {loading || !payload ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <KeyValue
                rows={[
                  ["core", <span className="font-mono text-[12px] text-embersoft">HereticCore 2.3.0-offline</span>],
                  ["runtime", <span className="font-mono text-[12px]">LiteRT 2.3.0 · litert-gpu 2.3.0</span>],
                  [
                    "authorization",
                    <span className="font-mono text-[12px]">
                      {payload.audit.entries} entries · head {hashShort(payload.audit.head)}
                    </span>,
                  ],
                  [
                    "gates",
                    <span className="font-mono text-[12px]">
                      {counters?.gatesGranted ?? 0} granted / {counters?.gatesDenied ?? 0} denied / {counters?.gatesPending ?? 0} pending
                    </span>,
                  ],
                  ["embedded sources", <span className="font-mono text-[12px]">{counters?.androidSources ?? 0} files</span>],
                  [
                    "background",
                    <span className="font-mono text-[12px] text-mint">0 services · 0 receivers</span>,
                  ],
                ]}
              />
            )}

            <div className="mt-4 rounded-lg border border-line bg-abyss/50 p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">latest build</p>
              {payload?.latestBuild ? (
                <div className="mt-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-display text-[13.5px] font-semibold text-chalk">
                      run #{payload.latestBuild.runNumber}
                    </p>
                    <Badge tone={payload.latestBuild.status === "SUCCEEDED" ? "mint" : "rose"}>
                      {payload.latestBuild.status}
                    </Badge>
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-ash2">
                    {payload.latestBuild.testsPassed} tests · {timeAgo(payload.latestBuild.createdAt)}
                    {payload.latestBuild.artifactName ? ` · ${payload.latestBuild.artifactName}` : ""}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[12.5px] text-ash">No build has been run from this workspace yet.</p>
              )}
              <Link href="/dashboard/android" className="mt-3 block">
                <Button size="sm" variant="outline" className="w-full" icon={<Droid width={13} height={13} />}>
                  Build pipeline <Chevron width={13} height={13} />
                </Button>
              </Link>
            </div>
          </Panel>
        </Reveal>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* inference profiles */}
        <Reveal className="xl:col-span-2">
          <Panel className="h-full overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">inference profiles</p>
                <h3 className="mt-1 font-display text-base font-semibold tracking-tight">On-device runtimes</h3>
              </div>
              <Badge tone="ember">litert 2.3.0</Badge>
            </div>

            {loading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : profileData?.profiles.length ? (
              <div className="divide-y divide-line/70">
                {profileData.profiles.map((profile) => (
                  <div key={profile.id} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[1.4fr_1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-display text-[13.5px] font-semibold text-chalk">{profile.name}</p>
                      <p className="truncate font-mono text-[11px] text-ash2">{profile.model}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{profile.runtime}</Badge>
                      <Badge tone={profile.delegate === "GPU" ? "mint" : "ice"}>{profile.delegate}</Badge>
                    </div>
                    <div className="flex items-center gap-4 font-mono text-[11.5px] text-ash">
                      <span>{profile.latencyMs} ms</span>
                      <span>{profile.ramMb} MB</span>
                      <span className={cn(profile.active ? "text-mint" : "text-ash2")}>
                        {profile.active ? "● active" : "○ idle"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Layers width={20} height={20} />}
                title="No inference profiles"
                body="Register a LiteRT or llama.cpp profile to track latency and memory for each model you load on-device."
                action={
                  <Link href="/dashboard/android">
                    <Button size="sm" variant="primary">Manage profiles</Button>
                  </Link>
                }
              />
            )}
          </Panel>
        </Reveal>

        {/* activity */}
        <Reveal delay={70}>
          <Panel className="h-full p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">recent activity</p>
              <Terminal width={14} height={14} className="text-ash2" />
            </div>

            {loading ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : payload?.activity.length ? (
              <ol className="mt-4 space-y-3">
                {payload.activity.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <Link href={item.href} className="group flex gap-3 rounded-md p-1.5 transition hover:bg-white/[0.03]">
                      <span
                        className={cn(
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border",
                          item.kind === "chat" && "border-ember/35 bg-ember/10 text-ember",
                          item.kind === "error" && "border-signal/35 bg-signal/10 text-signal",
                          item.kind === "decision" && "border-mint/35 bg-mint/10 text-mint",
                        )}
                      >
                        {item.kind === "chat" ? (
                          <Waveform width={12} height={12} />
                        ) : item.kind === "error" ? (
                          <Bug width={12} height={12} />
                        ) : (
                          <Ledger width={12} height={12} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-chalk group-hover:text-embersoft">{item.title}</span>
                        <span className="block truncate font-mono text-[11px] text-ash2">{item.detail}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10.5px] text-ash2">{timeAgo(item.at)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                icon={<Gauge width={20} height={20} />}
                title="Nothing logged yet"
                body="Send a message, analyse a stack trace or record a decision and the timeline fills in here."
              />
            )}

            <div className="mt-5 grid grid-cols-2 gap-2 border-t border-line pt-4">
              <Link href="/dashboard/gates">
                <Button size="sm" variant="ghost" className="w-full justify-start" icon={<Gate width={13} height={13} />}>
                  Gates {counters ? <span className="text-ash2">· {counters.gates}</span> : null}
                </Button>
              </Link>
              <Link href="/dashboard/settings">
                <Button size="sm" variant="ghost" className="w-full justify-start" icon={<Lock width={13} height={13} />}>
                  Privacy
                </Button>
              </Link>
            </div>
          </Panel>
        </Reveal>
      </div>

      <Reveal>
        <Panel className="grid gap-6 p-6 md:grid-cols-4">
          {[
            { k: "milestones complete", v: counters?.milestonesDone ?? 0, total: counters?.milestones ?? 0 },
            { k: "error rules matched", v: counters?.errorCases ?? 0, total: 14 },
            { k: "files graded WORKS", v: counters?.filesWorks ?? 0, total: counters?.files ?? 0 },
            { k: "gates pending", v: counters?.gatesPending ?? 0, total: counters?.gates ?? 0 },
          ].map((cell) => (
            <div key={cell.k}>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">{cell.k}</p>
              <p className="mt-1.5 font-display text-3xl font-semibold tracking-tight text-chalk">
                <CountUp value={cell.v} />
                <span className="ml-1 text-base text-ash2">/ {cell.total}</span>
              </p>
            </div>
          ))}
        </Panel>
      </Reveal>
    </div>
  );
}
