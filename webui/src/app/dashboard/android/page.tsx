"use client";

import { useEffect, useMemo, useState } from "react";
import { api, cn, downloadArtifact, formatBytes, formatDuration, timeAgo, useResource } from "@/lib/client";
import type { BuildRunRow, ProfileRow, SourceRow } from "@/lib/types";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingRows,
  Modal,
  Panel,
  SectionHeading,
  Select,
  StatTile,
  Textarea,
  useToast,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { Alert, Bolt, Check, Chevron, Cross, Download, Droid, Layers, Pencil, Play, Plus, Refresh, Search, Terminal, Trash } from "@/components/Icons";

const LANGUAGE_TONE: Record<string, "ember" | "mint" | "ice" | "signal" | "neutral"> = {
  kotlin: "ember",
  java: "signal",
  xml: "ice",
  yaml: "mint",
  markdown: "neutral",
  html: "signal",
  text: "neutral",
  json: "ice",
};

function groupByFolder(sources: SourceRow[]) {
  const groups = new Map<string, SourceRow[]>();
  for (const source of sources) {
    const parts = source.path.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
    const bucket = groups.get(folder) ?? [];
    bucket.push(source);
    groups.set(folder, bucket);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}


/** The .litertlm bundles this build understands, mirroring LiteRtLmModels.kt. */
const LITERTLM_CATALOG = [
  {
    id: "gemma-4-e2b",
    label: "Gemma 4 E2B",
    fileName: "gemma-4-e2b-it-int4.litertlm",
    size: "~2.58 GB",
    when: "default on 6 GB+ RAM",
    tone: "mint" as const,
  },
  {
    id: "gemma-3n-e2b",
    label: "Gemma 3n E2B",
    fileName: "gemma-3n-e2b-it-int4.litertlm",
    size: "~1.48 GB",
    when: "automatic fallback below 6 GB",
    tone: "ice" as const,
  },
];

type ModelStatus = {
  runtime?: string;
  arm64?: boolean;
  abis?: string[];
  totalRamMb?: number;
  freeMb?: number;
  defaultModel?: string | null;
  installedModel?: string | null;
  loadedModel?: string | null;
  catalog?: { id: string; label: string; fileName: string; sizeLabel: string; installed: boolean; isDefault: boolean }[];
};

/**
 * .litertlm loader for the Android build screen.
 *
 * Inside the APK this talks to LiteRtLmEngine through window.HereticNative: the
 * picker opens ACTION_OPEN_DOCUMENT and MainActivity streams the weights into
 * context.filesDir/models. In a plain browser it explains the same contract with
 * no device attached.
 */
function LitertlmImportPanel() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [progress, setProgress] = useState<{ file: string; percent: number; copiedMb: number; totalMb: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const native = typeof window !== "undefined" ? window.HereticNative : undefined;

  useEffect(() => {
    if (!native?.modelStatus) return;
    try {
      setStatus(JSON.parse(native.modelStatus()) as ModelStatus);
    } catch {
      setStatus(null);
    }
    const onModel = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      try {
        const parsed = JSON.parse(detail) as { state?: string; file?: string; status?: ModelStatus };
        if (parsed.status) setStatus(parsed.status);
        if (parsed.state) setMessage(`${parsed.file ?? "model"}: ${parsed.state}`);
        if (parsed.state === "ready") setProgress(null);
      } catch {
        setMessage(detail);
      }
    };
    const onProgress = (event: Event) => {
      try {
        setProgress(JSON.parse((event as CustomEvent<string>).detail));
      } catch {
        /* ignore malformed progress frames */
      }
    };
    const onError = (event: Event) => {
      setProgress(null);
      setMessage((event as CustomEvent<string>).detail);
    };
    window.addEventListener("heretic-model", onModel);
    window.addEventListener("heretic-model-progress", onProgress);
    window.addEventListener("heretic-model-error", onError);
    return () => {
      window.removeEventListener("heretic-model", onModel);
      window.removeEventListener("heretic-model-progress", onProgress);
      window.removeEventListener("heretic-model-error", onError);
    };
  }, [native]);

  const defaultId = status?.defaultModel ?? "gemma-4-e2b";
  const installedId = status?.installedModel ?? status?.loadedModel ?? null;

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">litert-lm 0.18.0</p>
          <h3 className="mt-1 font-display text-base font-semibold tracking-tight">.litertlm weights · streamed into filesDir/models</h3>
        </div>
        <Button
          size="sm"
          variant="primary"
          icon={<Layers width={13} height={13} />}
          onClick={() => {
            if (native?.triggerModelPicker) native.triggerModelPicker();
            else setMessage("Model import needs the APK: ACTION_OPEN_DOCUMENT and the filesDir copy live in MainActivity.");
          }}
        >
          Import .litertlm
        </Button>
      </div>

      <ul className="divide-y divide-line/70">
        {LITERTLM_CATALOG.map((model) => {
          const isDefault = model.id === defaultId;
          const isInstalled = model.id === installedId;
          return (
            <li key={model.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-[13rem] flex-1">
                <p className="font-display text-[13.5px] font-semibold text-chalk">{model.label}</p>
                <p className="truncate font-mono text-[11px] text-ash2">{model.fileName}</p>
              </div>
              <Badge tone={model.tone}>{model.size}</Badge>
              <span className="font-mono text-[11px] text-ash">{model.when}</span>
              {isDefault && <Badge tone="signal">default</Badge>}
              {isInstalled ? <Badge tone="mint">installed</Badge> : <Badge tone="neutral">not imported</Badge>}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-line px-5 py-4">
        {progress && (
          <div>
            <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.14em] text-ash2">
              <span>{progress.file}</span>
              <span>
                {progress.copiedMb} / {progress.totalMb} MB
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-ember transition-all" style={{ width: `${Math.min(100, progress.percent)}%` }} />
            </div>
          </div>
        )}
        {message && <p className="font-mono text-[11px] text-ash">{message}</p>}
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ash2">
          {status
            ? `${status.runtime ?? "litertlm-android:0.18.0"} · ${status.arm64 ? "arm64-v8a" : "unsupported ABI"} · ${status.totalRamMb ?? 0} MB RAM · ${status.freeMb ?? 0} MB free`
            : "Runtime report available inside the APK (HereticNative.modelStatus)."}
        </p>
      </div>
    </Panel>
  );
}

export default function AndroidPage() {
  const toast = useToast();
  const sources = useResource<{ sources: SourceRow[]; totals: { files: number; bytes: number; dirty: number } }>("/api/android/sources");
  const builds = useResource<{ runs: BuildRunRow[] }>("/api/android/builds");
  const profiles = useResource<{ profiles: ProfileRow[] }>("/api/profiles");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFile, setNewFile] = useState({ path: "", summary: "", content: "" });
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ name: "", model: "", runtime: "LiteRT 2.3.0", delegate: "GPU", threads: 4, latencyMs: 0, ramMb: 0 });
  const [pendingDelete, setPendingDelete] = useState<SourceRow | null>(null);

  const list = sources.data?.sources ?? [];
  const selected = list.find((s) => s.id === selectedId) ?? list[0] ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((s) => s.path.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q)) : list;
  }, [list, query]);

  const grouped = useMemo(() => groupByFolder(filtered), [filtered]);

  const startEdit = () => {
    if (!selected) return;
    setDraftContent(selected.content);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    const snapshot = sources.data;
    sources.setData((prev) =>
      prev
        ? {
            ...prev,
            sources: prev.sources.map((s) => (s.id === selected.id ? { ...s, content: draftContent, dirty: true } : s)),
            totals: { ...prev.totals, dirty: prev.totals.dirty + 1 },
          }
        : prev,
    );
    setEditing(false);
    try {
      const { source } = await api<{ source: SourceRow }>(`/api/android/sources/${selected.id}`, {
        method: "PATCH",
        json: { content: draftContent },
      });
      sources.setData((prev) =>
        prev ? { ...prev, sources: prev.sources.map((s) => (s.id === source.id ? source : s)) } : prev,
      );
      toast.push("success", "Source saved", `${source.path} flagged dirty until the next build run.`);
    } catch (err) {
      sources.setData(snapshot ?? null);
      toast.push("error", "Save failed", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    if (!selected) return;
    try {
      const { source } = await api<{ source: SourceRow }>(`/api/android/sources/${selected.id}/revert`, { method: "POST" });
      sources.setData((prev) =>
        prev ? { ...prev, sources: prev.sources.map((s) => (s.id === source.id ? source : s)) } : prev,
      );
      setEditing(false);
      toast.push("success", "Reverted to pristine", source.path);
    } catch (err) {
      toast.push("error", "Revert failed", err instanceof Error ? err.message : undefined);
    }
  };

  const createFile = async () => {
    if (!newFile.path.trim() || !newFile.content.trim()) {
      toast.push("error", "Path and content are required");
      return;
    }
    try {
      const { source } = await api<{ source: SourceRow }>("/api/android/sources", { method: "POST", json: newFile });
      sources.setData((prev) =>
        prev ? { sources: [...prev.sources, source], totals: { ...prev.totals, files: prev.totals.files + 1, dirty: prev.totals.dirty + 1 } } : prev,
      );
      setSelectedId(source.id);
      setNewFileOpen(false);
      setNewFile({ path: "", summary: "", content: "" });
      toast.push("success", "Source added", source.path);
      void sources.refetch();
    } catch (err) {
      toast.push("error", "Could not add the file", err instanceof Error ? err.message : undefined);
    }
  };

  const removeFile = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const snapshot = sources.data;
    sources.setData((prev) =>
      prev ? { sources: prev.sources.filter((s) => s.id !== id), totals: { ...prev.totals, files: prev.totals.files - 1 } } : prev,
    );
    if (selectedId === id) setSelectedId(null);
    setPendingDelete(null);
    try {
      await api(`/api/android/sources/${id}`, { method: "DELETE" });
      toast.push("success", "File removed", pendingDelete.path);
    } catch (err) {
      sources.setData(snapshot ?? null);
      toast.push("error", "Delete failed", err instanceof Error ? err.message : undefined);
    }
  };

  const runBuild = async () => {
    setBuilding(true);
    try {
      const result = await api<{ run: BuildRunRow; tests: { suite: string; name: string; passed: boolean; detail: string }[] }>(
        "/api/android/builds",
        { method: "POST", json: { trigger: "dashboard" } },
      );
      builds.setData((prev) => ({ runs: [result.run, ...(prev?.runs ?? [])] }));
      setExpandedRun(result.run.id);
      void sources.refetch();
      const failed = result.tests.filter((t) => !t.passed);
      toast.push(
        failed.length ? "error" : "success",
        `Run #${result.run.runNumber} → ${result.run.status}`,
        failed.length ? `${failed.length} core test(s) failed: ${failed[0].name}` : `${result.tests.length} core tests passed · artifact ready`,
      );
    } catch (err) {
      toast.push("error", "Build failed to start", err instanceof Error ? err.message : undefined);
    } finally {
      setBuilding(false);
    }
  };

  const download = async (run: BuildRunRow) => {
    try {
      await downloadArtifact(`/api/android/builds/${run.id}/artifact`, run.artifactName ?? "HeretIc-bundle.zip");
      toast.push("success", "Artifact downloaded", run.artifactName ?? undefined);
    } catch (err) {
      toast.push("error", "Download failed", err instanceof Error ? err.message : undefined);
    }
  };

  const downloadBundle = async () => {
    try {
      await downloadArtifact("/api/android/bundle", "HeretIc-android-sources.zip");
      toast.push("success", "Source bundle downloaded", `${list.length} files`);
    } catch (err) {
      toast.push("error", "Download failed", err instanceof Error ? err.message : undefined);
    }
  };

  const createProfile = async () => {
    if (!profileDraft.name.trim() || !profileDraft.model.trim()) {
      toast.push("error", "Name and model are required");
      return;
    }
    try {
      const { profile } = await api<{ profile: ProfileRow }>("/api/profiles", { method: "POST", json: profileDraft });
      profiles.setData((prev) => ({ profiles: [...(prev?.profiles ?? []), profile] }));
      setProfileOpen(false);
      setProfileDraft({ name: "", model: "", runtime: "LiteRT 2.3.0", delegate: "GPU", threads: 4, latencyMs: 0, ramMb: 0 });
      toast.push("success", "Profile registered", `${profile.name} · ${profile.delegate}`);
    } catch (err) {
      toast.push("error", "Could not register the profile", err instanceof Error ? err.message : undefined);
    }
  };

  const toggleProfile = async (profile: ProfileRow) => {
    const snapshot = profiles.data;
    profiles.setData((prev) =>
      prev ? { profiles: prev.profiles.map((p) => (p.id === profile.id ? { ...p, active: !p.active } : p)) } : prev,
    );
    try {
      const { profile: updated } = await api<{ profile: ProfileRow }>(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        json: { active: !profile.active },
      });
      profiles.setData((prev) =>
        prev ? { profiles: prev.profiles.map((p) => (p.id === updated.id ? updated : p)) } : prev,
      );
    } catch (err) {
      profiles.setData(snapshot ?? null);
      toast.push("error", "Could not update the profile", err instanceof Error ? err.message : undefined);
    }
  };

  const removeProfile = async (profile: ProfileRow) => {
    const snapshot = profiles.data;
    profiles.setData((prev) => (prev ? { profiles: prev.profiles.filter((p) => p.id !== profile.id) } : prev));
    try {
      await api(`/api/profiles/${profile.id}`, { method: "DELETE" });
      toast.push("success", "Profile removed", profile.name);
    } catch (err) {
      profiles.setData(snapshot ?? null);
      toast.push("error", "Delete failed", err instanceof Error ? err.message : undefined);
    }
  };

  const lines = (editing ? draftContent : (selected?.content ?? "")).split("\n");

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="embedded project"
        title="HeretIc — Android source & build pipeline"
        description="The complete Kotlin + Compose project that compiles into ai.heretic.app, including the WebView bridge, VoiceManager, LiteRT engine and the GitHub Actions workflow that bundles the single-file web UI."
        right={
          <>
            <Button size="sm" variant="outline" icon={<Download width={13} height={13} />} onClick={() => void downloadBundle()}>
              Source bundle
            </Button>
            <Button size="sm" variant="primary" loading={building} icon={<Play width={13} height={13} />} onClick={() => void runBuild()}>
              Run build
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="embedded sources"
          value={sources.data?.totals.files ?? 0}
          sub={`${formatBytes(sources.data?.totals.bytes ?? 0)} of Kotlin, Gradle, XML and YAML`}
          icon={<Layers width={16} height={16} />}
          tone="ember"
          pending={sources.loading}
        />
        <StatTile
          label="dirty files"
          value={sources.data?.totals.dirty ?? 0}
          sub="edited since the last successful build run"
          icon={<Pencil width={16} height={16} />}
          tone="signal"
          pending={sources.loading}
        />
        <StatTile
          label="build runs"
          value={builds.data?.runs.length ?? 0}
          sub={builds.data?.runs.length ? `latest #${builds.data.runs[0].runNumber} · ${builds.data.runs[0].status.toLowerCase()}` : "no runs yet"}
          icon={<Bolt width={16} height={16} />}
          tone="ice"
          pending={builds.loading}
        />
        <StatTile
          label="inference runtime"
          value="2.3.0 · 0.18.0"
          sub="litert + litert-gpu · litertlm-android"
          icon={<Droid width={16} height={16} />}
          tone="mint"
        />
      </div>

      {/* source browser -------------------------------------------------- */}
      <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
        <Panel className="h-fit overflow-hidden xl:sticky xl:top-24">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="relative flex-1">
              <Search width={13} height={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ash2" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter paths…" className="py-1.5 pl-8 text-[12px]" />
            </div>
            <Button size="sm" variant="outline" onClick={() => setNewFileOpen(true)} icon={<Plus width={13} height={13} />}>
              File
            </Button>
          </div>
          <div className="max-h-[36rem] overflow-y-auto p-2">
            {sources.loading ? (
              <LoadingRows rows={6} className="p-2" />
            ) : grouped.length ? (
              grouped.map(([folder, files]) => (
                <div key={folder} className="mb-3">
                  <p className="px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-ash2/80">{folder}</p>
                  <ul>
                    {files.map((source) => (
                      <li key={source.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(source.id);
                            setEditing(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition",
                            selected?.id === source.id ? "bg-ember/12 text-chalk" : "text-ash hover:bg-white/[0.04] hover:text-chalk",
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              source.dirty ? "bg-signal" : selected?.id === source.id ? "bg-ember" : "bg-line2",
                            )}
                          />
                          <span className="truncate font-mono text-[11.5px]">{source.path.split("/").pop()}</span>
                          <span className="ml-auto shrink-0 font-mono text-[9.5px] uppercase text-ash2/70">{source.language}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <EmptyState
                icon={<Layers width={20} height={20} />}
                title="No sources"
                body="Load the demo workspace from Settings to restore the full embedded Android project."
              />
            )}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          {selected ? (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-line bg-panel2/40 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px] text-chalk">{selected.path}</p>
                  <p className="mt-0.5 truncate text-[12px] text-ash2">{selected.summary}</p>
                </div>
                <Badge tone={LANGUAGE_TONE[selected.language] ?? "neutral"}>{selected.language}</Badge>
                {selected.dirty ? <Badge tone="signal" dot>dirty</Badge> : <Badge tone="mint">clean</Badge>}
                <span className="font-mono text-[10.5px] text-ash2">
                  {formatBytes(selected.sizeBytes)} · {timeAgo(selected.updatedAt)}
                </span>
                <div className="flex gap-2">
                  {editing ? (
                    <>
                      <Button size="sm" variant="primary" loading={saving} onClick={() => void saveEdit()} icon={<Check width={13} height={13} />}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} icon={<Cross width={13} height={13} />}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={startEdit} icon={<Pencil width={13} height={13} />}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void revert()}>
                        Revert
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(selected)} icon={<Trash width={13} height={13} />}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </header>

              {editing ? (
                <Textarea
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  rows={26}
                  className="m-3 rounded-lg"
                  spellCheck={false}
                />
              ) : (
                <div className="max-h-[38rem] overflow-auto">
                  <pre className="min-w-full font-mono text-[12px] leading-[1.62]">
                    <code className="grid grid-cols-[3.2rem_1fr]">
                      <span className="select-none border-r border-line bg-abyss/60 py-3 text-right text-ash2/60">
                        {lines.map((_, index) => (
                          <span key={index} className="block px-2">
                            {index + 1}
                          </span>
                        ))}
                      </span>
                      <span className="block whitespace-pre px-4 py-3 text-ash">{selected.content}</span>
                    </code>
                  </pre>
                </div>
              )}
            </>
          ) : (
            <EmptyState icon={<Terminal width={22} height={22} />} title="Select a source file" body="The embedded project tree is on the left." />
          )}
        </Panel>
      </div>

      {/* build runs ------------------------------------------------------ */}
      <Reveal>
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">build pipeline</p>
              <h3 className="mt-1 font-display text-base font-semibold tracking-tight">
                .github/workflows/android.yml · Gradle 8.7 · Temurin JDK 17
              </h3>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => void builds.refetch()} icon={<Refresh width={13} height={13} />}>
                Reload
              </Button>
              <Button size="sm" variant="primary" loading={building} onClick={() => void runBuild()} icon={<Play width={13} height={13} />}>
                Run assembleDebug
              </Button>
            </div>
          </div>

          {builds.loading ? (
            <LoadingRows rows={3} className="p-4" />
          ) : builds.data?.runs.length ? (
            <ul className="divide-y divide-line/70">
              {builds.data.runs.map((run) => {
                const open = expandedRun === run.id;
                return (
                  <li key={run.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedRun(open ? null : run.id)}
                      className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left transition hover:bg-white/[0.02]"
                    >
                      <span className="font-mono text-[12px] text-ember">#{run.runNumber}</span>
                      <Badge tone={run.status === "SUCCEEDED" ? "mint" : run.status === "FAILED" ? "rose" : "signal"} dot={run.status === "RUNNING"}>
                        {run.status.toLowerCase()}
                      </Badge>
                      <span className="font-mono text-[11px] text-ash2">
                        {run.ref} · {run.variant} · {run.trigger}
                      </span>
                      <span className="font-mono text-[11px] text-ash2">
                        {run.testsPassed} tests · {formatDuration(run.durationMs)} · {timeAgo(run.createdAt)}
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        {run.artifactName ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              void download(run);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.stopPropagation();
                                void download(run);
                              }
                            }}
                            className="flex items-center gap-1.5 rounded border border-line2 px-2 py-1 font-mono text-[10.5px] text-ash transition hover:border-ember/45 hover:text-embersoft"
                          >
                            <Download width={12} height={12} /> {formatBytes(run.artifactBytes)}
                          </span>
                        ) : null}
                        <Chevron width={14} height={14} className={cn("text-ash2 transition-transform", open && "rotate-90")} />
                      </span>
                    </button>
                    {open ? (
                      <div className="animate-rise border-t border-line bg-abyss/60 px-5 py-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">job log</p>
                        <ol className="mt-2 space-y-1">
                          {run.logs.map((log, index) => (
                            <li key={`${log.step}-${index}`} className="flex gap-3 font-mono text-[11.5px] leading-relaxed">
                              <span className="w-10 shrink-0 text-right text-ash2/60">+{log.t}s</span>
                              <span className="w-52 shrink-0 truncate text-embersoft/85">{log.step}</span>
                              <span className={cn("min-w-0 flex-1", log.line.startsWith("FAIL") || log.line.startsWith("BUILD FAILED") ? "text-rose" : log.line.startsWith("PASS") || log.line.startsWith("BUILD SUCCESSFUL") ? "text-mint" : "text-ash")}>
                                {log.line}
                              </span>
                            </li>
                          ))}
                        </ol>
                        <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ash2">
                          Compiling the APK itself requires the Android SDK, Gradle 8.7 and JDK 17 — the artifact above is the exact
                          source tree the workflow feeds to <span className="font-mono text-ash">:app:assembleDebug</span>, plus a
                          BUILD-INFO manifest.
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<Bolt width={22} height={22} />}
              title="No build runs yet"
              body="Run the pipeline to execute the core test suite, bundle the sources and produce a downloadable artifact."
              action={
                <Button variant="primary" size="sm" loading={building} onClick={() => void runBuild()} icon={<Play width={13} height={13} />}>
                  Run build
                </Button>
              }
            />
          )}
        </Panel>
      </Reveal>

      {/* .litertlm model loader ------------------------------------------- */}
      <Reveal>
        <LitertlmImportPanel />
      </Reveal>

      {/* inference profiles ---------------------------------------------- */}
      <Reveal>
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">inference profiles</p>
              <h3 className="mt-1 font-display text-base font-semibold tracking-tight">Models loaded through LiteRtEngine.kt</h3>
            </div>
            <Button size="sm" variant="outline" icon={<Plus width={13} height={13} />} onClick={() => setProfileOpen(true)}>
              Register profile
            </Button>
          </div>

          {profiles.loading ? (
            <LoadingRows rows={3} className="p-4" />
          ) : profiles.data?.profiles.length ? (
            <ul className="divide-y divide-line/70">
              {profiles.data.profiles.map((profile) => (
                <li key={profile.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-[12rem] flex-1">
                    <p className="font-display text-[13.5px] font-semibold text-chalk">{profile.name}</p>
                    <p className="truncate font-mono text-[11px] text-ash2">{profile.model}</p>
                  </div>
                  <Badge tone="neutral">{profile.runtime}</Badge>
                  <Badge tone={profile.delegate === "GPU" ? "mint" : "ice"}>{profile.delegate}</Badge>
                  <span className="font-mono text-[11.5px] text-ash">{profile.threads} threads</span>
                  <span className="font-mono text-[11.5px] text-ash">{profile.latencyMs} ms</span>
                  <span className="font-mono text-[11.5px] text-ash">{profile.ramMb} MB</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleProfile(profile)}
                      className={cn(
                        "rounded border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] transition",
                        profile.active ? "border-mint/45 bg-mint/12 text-mint" : "border-line2 text-ash2 hover:text-chalk",
                      )}
                    >
                      {profile.active ? "active" : "activate"}
                    </button>
                    <button type="button" onClick={() => void removeProfile(profile)} className="text-ash2 transition hover:text-rose" aria-label="Delete profile">
                      <Trash width={14} height={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Droid width={22} height={22} />}
              title="No inference profiles"
              body="Register a LiteRT or llama.cpp model so latency and memory stay visible as you tune the pipeline."
              action={
                <Button variant="primary" size="sm" onClick={() => setProfileOpen(true)} icon={<Plus width={13} height={13} />}>
                  Register profile
                </Button>
              }
            />
          )}
        </Panel>
      </Reveal>

      {/* modals ---------------------------------------------------------- */}
      <Modal
        open={newFileOpen}
        onClose={() => setNewFileOpen(false)}
        title="Add a source file"
        subtitle="Paths are relative to the repository root, e.g. public/android/HeretIc/app/src/main/java/…"
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewFileOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void createFile()} icon={<Plus width={14} height={14} />}>
              Add file
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Path">
            <Input
              value={newFile.path}
              onChange={(e) => setNewFile({ ...newFile, path: e.target.value })}
              placeholder="public/android/HeretIc/app/src/main/java/ai/heretic/app/core/IntentRules.kt"
            />
          </Field>
          <Field label="Summary">
            <Input value={newFile.summary} onChange={(e) => setNewFile({ ...newFile, summary: e.target.value })} placeholder="Extracted intent rule tables." />
          </Field>
          <Field label="Content">
            <Textarea rows={12} value={newFile.content} onChange={(e) => setNewFile({ ...newFile, content: e.target.value })} placeholder="package ai.heretic.app.core" spellCheck={false} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Register an inference profile"
        subtitle="Mirrors an Interpreter created by ml/LiteRtEngine.kt."
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setProfileOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void createProfile()}>
              Register
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={profileDraft.name} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} placeholder="Wake word · int8" />
            </Field>
            <Field label="Model file">
              <Input value={profileDraft.model} onChange={(e) => setProfileDraft({ ...profileDraft, model: e.target.value })} placeholder="heretic-wakeword-int8.tflite" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Runtime">
              <Select value={profileDraft.runtime} onChange={(e) => setProfileDraft({ ...profileDraft, runtime: e.target.value })}>
                {["LiteRT 2.3.0", "llama.cpp JNI", "whisper.cpp", "ONNX Runtime Android"].map((runtime) => (
                  <option key={runtime} value={runtime} className="bg-panel">{runtime}</option>
                ))}
              </Select>
            </Field>
            <Field label="Delegate">
              <Select value={profileDraft.delegate} onChange={(e) => setProfileDraft({ ...profileDraft, delegate: e.target.value })}>
                {["GPU", "CPU", "NNAPI", "CPU/mmap"].map((delegate) => (
                  <option key={delegate} value={delegate} className="bg-panel">{delegate}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Threads">
              <Input type="number" min={1} max={8} value={profileDraft.threads} onChange={(e) => setProfileDraft({ ...profileDraft, threads: Number(e.target.value) })} />
            </Field>
            <Field label="Latency (ms)">
              <Input type="number" min={0} value={profileDraft.latencyMs} onChange={(e) => setProfileDraft({ ...profileDraft, latencyMs: Number(e.target.value) })} />
            </Field>
            <Field label="RAM (MB)">
              <Input type="number" min={0} value={profileDraft.ramMb} onChange={(e) => setProfileDraft({ ...profileDraft, ramMb: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this source file?"
        body={`${pendingDelete?.path ?? ""} will be removed from the embedded project and from the next build bundle.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void removeFile()}
      />

      {!sources.loading && !list.length ? (
        <Panel className="flex items-center gap-3 p-4">
          <Alert width={16} height={16} className="text-signal" />
          <p className="text-[13px] text-ash">
            The embedded project is empty for this workspace. Load the demo dataset from Settings to restore all twenty sources.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
