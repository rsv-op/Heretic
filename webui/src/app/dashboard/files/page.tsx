"use client";

import { useMemo, useRef, useState } from "react";
import { api, cn, formatBytes, timeAgo, useResource } from "@/lib/client";
import type { FileAssetRow, RelevanceEnum } from "@/lib/types";
import { assessFile, type FileAssessment } from "@/lib/engines";
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
  ProgressBar,
  SectionHeading,
  Textarea,
  useToast,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { Alert, Check, Chevron, FolderScan, Pencil, Plus, Search, Trash } from "@/components/Icons";

const RELEVANCE_TONE: Record<RelevanceEnum, "mint" | "signal" | "rose"> = {
  WORKS: "mint",
  PARTIALLY_MATCHES: "signal",
  NOT_RELEVANT: "rose",
};

const label = (value: RelevanceEnum) => value.replace(/_/g, " ");

const PRESETS = [
  "heretic-wakeword-int8.tflite",
  "heretic-7b-q4_k_m.gguf",
  "emotion-classifier.onnx",
  "piper-en_GB-alba-medium.onnx",
  "stt-fixture-16k.wav",
  "VoiceManager.kt",
  "heretic-7b-f16.safetensors",
  "architecture-overview.pdf",
];

export default function FilesPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useResource<{ files: FileAssetRow[] }>("/api/files");
  const files = data?.files ?? [];

  const [name, setName] = useState("");
  const [sizeBytes, setSizeBytes] = useState(0);
  const [assessment, setAssessment] = useState<FileAssessment | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | RelevanceEnum>("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<FileAssetRow | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [pendingDelete, setPendingDelete] = useState<FileAssetRow | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const nativeBridge = typeof window !== "undefined" ? window.HereticNative : undefined;

  const run = (fileName: string, bytes = 0) => {
    if (!fileName.trim()) return;
    const result = assessFile(fileName.trim(), bytes);
    setAssessment(result);
    if (nativeBridge) {
      toast.push("info", "Assessed on-device", "window.HereticNative.assessFile() would answer identically inside the APK.");
    }
  };

  const onPicked = (file: File) => {
    setName(file.name);
    setSizeBytes(file.size);
    run(file.name, file.size);
    toast.push("info", "File picked", `${file.name} · ${formatBytes(file.size)} — SAF grants exactly this one URI.`);
  };

  const save = async () => {
    if (!assessment) return;
    setSaving(true);
    try {
      const { file } = await api<{ file: FileAssetRow }>("/api/files", {
        method: "POST",
        json: { fileName: assessment.fileName, sizeBytes, origin: nativeBridge ? "native-saf-pick" : "browser-file-input" },
      });
      setData((prev) => ({ files: [file, ...(prev?.files ?? [])] }));
      toast.push("success", `${label(file.relevance)} · ${file.usefulness}%`, file.fileName);
      setName("");
      setSizeBytes(0);
      setAssessment(null);
      void refetch();
    } catch (err) {
      toast.push("error", "Could not save the assessment", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter(
      (file) =>
        (filter === "ALL" || file.relevance === filter) &&
        (!q || file.fileName.toLowerCase().includes(q) || file.rationale.toLowerCase().includes(q)),
    );
  }, [files, filter, query]);

  const saveEdit = async () => {
    if (!editing) return;
    const snapshot = files;
    setData({ files: files.map((f) => (f.id === editing.id ? { ...f, notes: editNotes } : f)) });
    setEditing(null);
    try {
      const { file } = await api<{ file: FileAssetRow }>(`/api/files/${editing.id}`, {
        method: "PATCH",
        json: { notes: editNotes },
      });
      setData((prev) => ({ files: (prev?.files ?? []).map((f) => (f.id === file.id ? file : f)) }));
      toast.push("success", "Notes updated", file.fileName);
    } catch (err) {
      setData({ files: snapshot });
      setEditing(editing);
      toast.push("error", "Update failed", err instanceof Error ? err.message : undefined);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const snapshot = files;
    setData({ files: files.filter((f) => f.id !== id) });
    setPendingDelete(null);
    try {
      await api(`/api/files/${id}`, { method: "DELETE" });
      toast.push("success", "Assessment removed", pendingDelete.fileName);
    } catch (err) {
      setData({ files: snapshot });
      toast.push("error", "Delete failed", err instanceof Error ? err.message : undefined);
    }
  };

  const counts = {
    works: files.filter((f) => f.relevance === "WORKS").length,
    partial: files.filter((f) => f.relevance === "PARTIALLY_MATCHES").length,
    rejected: files.filter((f) => f.relevance === "NOT_RELEVANT").length,
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="workflow 03"
        title="File relevance assessor"
        description="One pick through the Storage Access Framework, one verdict: WORKS, PARTIALLY MATCHES or NOT RELEVANT — with a usefulness score, the reason it fails, and integration steps down to the Gradle line."
        right={
          <div className="flex items-center gap-2">
            <Badge tone="mint">{counts.works} works</Badge>
            <Badge tone="signal">{counts.partial} partial</Badge>
            <Badge tone="rose">{counts.rejected} rejected</Badge>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[24rem_1fr]">
        {/* console */}
        <Reveal>
          <Panel className="h-fit p-5">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">assessment console</p>

            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPicked(file);
                event.target.value = "";
              }}
            />

            <div className="mt-4 space-y-3">
              <Field label="File name" hint="extension drives the verdict">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && run(name, sizeBytes)}
                  placeholder="heretic-wakeword-int8.tflite"
                />
              </Field>
              <Field label="Size (bytes)" hint="optional">
                <Input
                  type="number"
                  min={0}
                  value={sizeBytes || ""}
                  onChange={(event) => setSizeBytes(Number(event.target.value) || 0)}
                  placeholder="2411724"
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => (nativeBridge ? nativeBridge.triggerFilePicker() : inputRef.current?.click())}
                  icon={<FolderScan width={14} height={14} />}
                >
                  {nativeBridge ? "SAF pick" : "Pick a file"}
                </Button>
                <Button variant="outline" onClick={() => run(name, sizeBytes)} disabled={!name.trim()}>
                  Assess
                </Button>
              </div>
            </div>

            <div className="mt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">presets</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setName(preset);
                      run(preset, 0);
                    }}
                    className="rounded border border-line2 px-2 py-1 font-mono text-[10.5px] text-ash2 transition hover:border-ember/45 hover:text-embersoft"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {assessment ? (
              <div className="mt-5 rounded-lg border border-line bg-abyss/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={RELEVANCE_TONE[assessment.relevance.replace(/ /g, "_") as RelevanceEnum]} dot>
                    {assessment.relevance}
                  </Badge>
                  <span className="font-mono text-[11px] text-ash2">{assessment.kind}</span>
                </div>
                <ProgressBar
                  className="mt-3"
                  value={assessment.usefulness}
                  tone={assessment.relevance === "WORKS" ? "mint" : assessment.relevance === "PARTIALLY MATCHES" ? "signal" : "rose"}
                  label="usefulness"
                />
                <p className="mt-3 text-[13px] leading-relaxed text-ash">{assessment.rationale}</p>
                {assessment.whyNotUseful ? (
                  <p className="mt-2 border-l-2 border-rose/50 pl-3 text-[12.5px] leading-relaxed text-rose/90">
                    {assessment.whyNotUseful}
                  </p>
                ) : null}
                <ol className="mt-3 space-y-1.5">
                  {assessment.integrationSteps.map((step, index) => (
                    <li key={step} className="flex gap-2 text-[12.5px] leading-relaxed text-ash">
                      <span className="font-mono text-[11px] text-ember">{index + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 font-mono text-[10.5px] text-ash2">target → {assessment.targetModule}</p>
                <Button variant="primary" size="sm" className="mt-3 w-full" loading={saving} onClick={() => void save()} icon={<Check width={13} height={13} />}>
                  Save to workspace
                </Button>
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-dashed border-line2 p-4 text-center">
                <p className="text-[12.5px] text-ash2">
                  No assessment yet. Pick a file or type a name — the verdict is computed locally by the same rule table the APK ships.
                </p>
              </div>
            )}
          </Panel>
        </Reveal>

        {/* ledger */}
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <div className="relative flex-1 min-w-[12rem]">
              <Search width={14} height={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ash2" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search assessed files…"
                className="pl-9"
              />
            </div>
            {(["ALL", "WORKS", "PARTIALLY_MATCHES", "NOT_RELEVANT"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] transition",
                  filter === key ? "border-ember/50 bg-ember/12 text-embersoft" : "border-line2 text-ash2 hover:text-chalk",
                )}
              >
                {key === "ALL" ? "all" : label(key)}
              </button>
            ))}
          </div>

          {error ? (
            <EmptyState icon={<Alert width={20} height={20} />} title="Could not load assessments" body={error} action={<Button onClick={() => void refetch()}>Retry</Button>} />
          ) : loading ? (
            <LoadingRows rows={5} className="p-4" />
          ) : filtered.length ? (
            <ul className="divide-y divide-line/70">
              {filtered.map((file) => {
                const open = expanded === file.id;
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : file.id)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.025]"
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
                          file.relevance === "WORKS" && "border-mint/35 bg-mint/10 text-mint",
                          file.relevance === "PARTIALLY_MATCHES" && "border-signal/35 bg-signal/10 text-signal",
                          file.relevance === "NOT_RELEVANT" && "border-rose/35 bg-rose/10 text-rose",
                        )}
                      >
                        <FolderScan width={16} height={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[13.5px] font-semibold text-chalk">{file.fileName}</span>
                        <span className="block truncate font-mono text-[10.5px] text-ash2">
                          {formatBytes(file.sizeBytes)} · {file.origin} · {timeAgo(file.createdAt)}
                        </span>
                      </span>
                      <span className="hidden w-28 shrink-0 sm:block">
                        <ProgressBar
                          value={file.usefulness}
                          tone={file.relevance === "WORKS" ? "mint" : file.relevance === "PARTIALLY_MATCHES" ? "signal" : "rose"}
                        />
                      </span>
                      <Badge tone={RELEVANCE_TONE[file.relevance]}>{label(file.relevance)}</Badge>
                      <Chevron width={14} height={14} className={cn("shrink-0 text-ash2 transition-transform", open && "rotate-90")} />
                    </button>

                    {open ? (
                      <div className="animate-rise border-t border-line bg-abyss/40 px-4 py-4">
                        <p className="text-[13px] leading-relaxed text-ash">{file.rationale}</p>
                        {file.whyNotUseful ? (
                          <p className="mt-2 border-l-2 border-rose/50 pl-3 text-[12.5px] leading-relaxed text-rose/90">{file.whyNotUseful}</p>
                        ) : null}
                        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">integration steps</p>
                        <ol className="mt-2 space-y-1.5">
                          {file.integrationSteps.map((step, index) => (
                            <li key={step} className="flex gap-2 text-[12.5px] leading-relaxed text-ash">
                              <span className="font-mono text-[11px] text-ember">{index + 1}.</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                          <span className="font-mono text-[10.5px] text-ash2">target → {file.targetModule}</span>
                          {file.notes ? <span className="font-mono text-[10.5px] text-ash">note: {file.notes}</span> : null}
                          <div className="ml-auto flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<Pencil width={13} height={13} />}
                              onClick={() => {
                                setEditing(file);
                                setEditNotes(file.notes ?? "");
                              }}
                            >
                              Note
                            </Button>
                            <Button size="sm" variant="ghost" icon={<Trash width={13} height={13} />} onClick={() => setPendingDelete(file)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<FolderScan width={22} height={22} />}
              title={files.length ? "No files match this filter" : "Nothing assessed yet"}
              body={
                files.length
                  ? "Clear the search or switch the relevance filter to see the rest of the ledger."
                  : "Pick a model, an audio fixture or a Kotlin file. Heretic grades it against the integration paths it actually supports — and says why when it does not."
              }
              action={
                files.length ? (
                  <Button size="sm" onClick={() => { setFilter("ALL"); setQuery(""); }}>Clear filters</Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => inputRef.current?.click()} icon={<Plus width={13} height={13} />}>
                    Assess a file
                  </Button>
                )
              }
            />
          )}
        </Panel>
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Operator note"
        subtitle={editing?.fileName}
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveEdit()}>
              Save note
            </Button>
          </>
        }
      >
        <Field label="Note" hint="kept next to the verdict">
          <Textarea rows={4} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} placeholder="Loaded at first run into filesDir/models." />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this assessment?"
        body={`${pendingDelete?.fileName ?? ""} will be dropped from the ledger. The file itself is never touched — Heretic only ever reads the URI you granted.`}
        confirmLabel="Remove"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
