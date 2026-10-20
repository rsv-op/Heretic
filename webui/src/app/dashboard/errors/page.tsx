"use client";

import { useMemo, useState } from "react";
import { api, cn, timeAgo, useResource } from "@/lib/client";
import type { CaseStatus, ErrorCaseRow } from "@/lib/types";
import { analyzeError, confirmSolution, type ErrorAnalysis, type SolutionConfirmation } from "@/lib/engines";
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
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
import { Alert, Bug, Check, Cross, Pencil, Plus, Refresh, Terminal, Trash } from "@/components/Icons";

const FILTERS: { key: "ALL" | CaseStatus; label: string }[] = [
  { key: "ALL", label: "all" },
  { key: "AWAITING_PASTE_BACK", label: "awaiting paste-back" },
  { key: "CHECK_PASSED", label: "check passed" },
  { key: "CHECK_FAILED", label: "check failed" },
  { key: "OPEN", label: "open" },
];

const STATUS_TONE: Record<CaseStatus, "mint" | "signal" | "rose" | "neutral"> = {
  CHECK_PASSED: "mint",
  CHECK_FAILED: "rose",
  AWAITING_PASTE_BACK: "signal",
  OPEN: "neutral",
};

const SEVERITY_TONE: Record<string, "rose" | "signal" | "ember" | "neutral"> = {
  critical: "rose",
  high: "signal",
  medium: "ember",
  low: "neutral",
};

const SAMPLE_LOG = `FATAL EXCEPTION: main
Process: ai.heretic.app, PID: 14207
java.lang.UnsatisfiedLinkError: dlopen failed: library "libheretic_jni.so" not found
	at java.lang.Runtime.loadLibrary0(Runtime.java:1087)
	at ai.heretic.app.ml.LiteRtEngine.load(LiteRtEngine.kt:41)`;

export default function ErrorsPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useResource<{ cases: ErrorCaseRow[] }>("/api/errors");
  const cases = data?.cases ?? [];

  const [filter, setFilter] = useState<"ALL" | CaseStatus>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", rawLog: "" });
  const [pasteBack, setPasteBack] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ErrorCaseRow | null>(null);
  const [quickLog, setQuickLog] = useState(SAMPLE_LOG);
  const [busy, setBusy] = useState(false);

  const quickAnalysis: ErrorAnalysis | null = useMemo(
    () => (quickLog.trim().length > 12 ? analyzeError(quickLog) : null),
    [quickLog],
  );

  const filtered = useMemo(
    () => (filter === "ALL" ? cases : cases.filter((c) => c.status === filter)),
    [cases, filter],
  );

  const selected = cases.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  const createCase = async () => {
    if (draft.rawLog.trim().length < 12) {
      toast.push("error", "Log too short", "Paste the exception line and at least one stack frame.");
      return;
    }
    setBusy(true);
    try {
      const { case: created } = await api<{ case: ErrorCaseRow }>("/api/errors", {
        method: "POST",
        json: { title: draft.title, rawLog: draft.rawLog },
      });
      setData((prev) => ({ cases: [created, ...(prev?.cases ?? [])] }));
      setSelectedId(created.id);
      setCreateOpen(false);
      setDraft({ title: "", rawLog: "" });
      toast.push("success", `${created.ref} opened`, `${created.severity.toUpperCase()} · ${created.confidence}% confidence`);
      void refetch();
    } catch (err) {
      toast.push("error", "Analysis failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!selected || !pasteBack.trim()) return;
    setVerifying(true);
    const snapshot = selected;
    // Optimistic local verdict so the loop feels instant, then reconcile.
    const predicted = confirmSolution(pasteBack);
    setData((prev) => ({
      cases: (prev?.cases ?? []).map((c) =>
        c.id === selected.id
          ? {
              ...c,
              pasteBack,
              status:
                predicted.status === "CHECK PASSED"
                  ? "CHECK_PASSED"
                  : predicted.status === "CHECK FAILED"
                    ? "CHECK_FAILED"
                    : "AWAITING_PASTE_BACK",
            }
          : c,
      ),
    }));
    try {
      const result = await api<{ case: ErrorCaseRow; verdict: SolutionConfirmation }>(`/api/errors/${selected.id}/confirm`, {
        method: "POST",
        json: { pasteBack },
      });
      setData((prev) => ({ cases: (prev?.cases ?? []).map((c) => (c.id === result.case.id ? result.case : c)) }));
      toast.push(
        result.verdict.status === "CHECK PASSED" ? "success" : result.verdict.status === "CHECK FAILED" ? "error" : "info",
        result.verdict.status,
        result.verdict.nextAction,
      );
      setPasteBack("");
    } catch (err) {
      setData((prev) => ({ cases: (prev?.cases ?? []).map((c) => (c.id === snapshot.id ? snapshot : c)) }));
      toast.push("error", "Verification failed", err instanceof Error ? err.message : undefined);
    } finally {
      setVerifying(false);
    }
  };

  const updateCase = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      const { case: updated } = await api<{ case: ErrorCaseRow }>(`/api/errors/${editingId}`, {
        method: "PATCH",
        json: { title: draft.title, rawLog: draft.rawLog },
      });
      setData((prev) => ({ cases: (prev?.cases ?? []).map((c) => (c.id === updated.id ? updated : c)) }));
      setCreateOpen(false);
      toast.push("success", "Case re-analysed", `${updated.rules.join(", ")}`);
    } catch (err) {
      toast.push("error", "Update failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const removeCase = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const snapshot = cases;
    setData({ cases: cases.filter((c) => c.id !== id) });
    if (selectedId === id) setSelectedId(null);
    setPendingDelete(null);
    try {
      await api(`/api/errors/${id}`, { method: "DELETE" });
      toast.push("success", "Case closed and deleted", pendingDelete.ref);
    } catch (err) {
      setData({ cases: snapshot });
      toast.push("error", "Delete failed", err instanceof Error ? err.message : undefined);
    }
  };

  const openEdit = () => {
    if (!selected) return;
    setEditingId(selected.id);
    setDraft({ title: selected.title, rawLog: selected.rawLog });
    setCreateOpen(true);
  };

  const openCreate = () => {
    setEditingId(null);
    setDraft({ title: "", rawLog: "" });
    setCreateOpen(true);
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="workflow 02"
        title="Error identification loop"
        description="Paste a logcat. The engine returns WHAT broke, WHY it broke and a REQUEST SOLUTION block — then it waits for your paste-back before it will claim anything is fixed."
        right={
          <>
            <Button size="sm" variant="outline" icon={<Terminal width={13} height={13} />} onClick={() => setQuickOpen(true)}>
              Quick analyse
            </Button>
            <Button size="sm" variant="primary" icon={<Plus width={13} height={13} />} onClick={openCreate}>
              New case
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => {
          const count = item.key === "ALL" ? cases.length : cases.filter((c) => c.status === item.key).length;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition",
                filter === item.key
                  ? "border-ember/50 bg-ember/12 text-embersoft"
                  : "border-line2 text-ash2 hover:border-line2 hover:text-chalk",
              )}
            >
              {item.label} <span className="ml-1 text-ash2/70">{count}</span>
            </button>
          );
        })}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void refetch()} icon={<Refresh width={13} height={13} />}>
          Reload
        </Button>
      </div>

      {error ? (
        <Panel>
          <EmptyState icon={<Alert width={20} height={20} />} title="Could not load cases" body={error} action={<Button onClick={() => void refetch()}>Retry</Button>} />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
          {/* list */}
          <Panel className="h-fit overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">case ledger</p>
              <span className="font-mono text-[10.5px] text-ash2">{filtered.length}</span>
            </div>
            <div className="max-h-[38rem] overflow-y-auto p-2">
              {loading ? (
                <LoadingRows rows={5} className="p-2" />
              ) : filtered.length ? (
                filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      "mb-1 w-full rounded-lg border px-3 py-2.5 text-left transition-all",
                      selected?.id === item.id
                        ? "border-ember/40 bg-ember/[0.07]"
                        : "border-transparent hover:border-line2 hover:bg-white/[0.03]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10.5px] tracking-[0.12em] text-ember/85">{item.ref}</span>
                      <Badge tone={STATUS_TONE[item.status]}>{item.status.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-chalk">{item.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone={SEVERITY_TONE[item.severity] ?? "neutral"}>{item.severity}</Badge>
                      <span className="font-mono text-[10.5px] text-ash2">{item.confidence}% · {timeAgo(item.updatedAt)}</span>
                    </div>
                  </button>
                ))
              ) : (
                <EmptyState
                  icon={<Bug width={20} height={20} />}
                  title="No cases in this view"
                  body="Paste a stack trace and Heretic will classify it against fourteen Android failure families."
                  action={
                    <Button size="sm" variant="primary" onClick={openCreate} icon={<Plus width={13} height={13} />}>
                      New case
                    </Button>
                  }
                />
              )}
            </div>
          </Panel>

          {/* detail */}
          {selected ? (
            <Reveal>
              <Panel className="overflow-hidden">
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-panel2/40 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] tracking-[0.14em] text-ember">{selected.ref}</span>
                      <Badge tone={SEVERITY_TONE[selected.severity] ?? "neutral"}>{selected.severity}</Badge>
                      <Badge tone={STATUS_TONE[selected.status]} dot>
                        {selected.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <h3 className="mt-2 font-display text-lg font-semibold leading-tight tracking-tight text-chalk">{selected.title}</h3>
                    <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ash2">
                      rules {selected.rules.join(" · ")} · confidence {selected.confidence}%
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={openEdit} icon={<Pencil width={13} height={13} />}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPendingDelete(selected)} icon={<Trash width={13} height={13} />}>
                      Delete
                    </Button>
                  </div>
                </header>

                <div className="grid gap-5 p-5 lg:grid-cols-2">
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">raw log</p>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-abyss/70 p-3 font-mono text-[11.5px] leading-relaxed text-rose/85">
                      {selected.rawLog}
                    </pre>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-[10.5px] text-ash2">{selected.rawLog.length} chars</span>
                      <CopyButton value={selected.rawLog} label="copy log" />
                    </div>
                  </div>

                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">engine output</p>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-ember/20 bg-abyss/70 p-3 font-mono text-[11.5px] leading-relaxed text-ash">
                      {selected.formatted}
                    </pre>
                    <div className="mt-3 space-y-2">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ember/80">what</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-chalk">{selected.what}</p>
                      </div>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal/80">why</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-ash">{selected.why}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* paste-back loop */}
                <div className="border-t border-line bg-abyss/40 px-5 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">paste-back verification</p>
                    {selected.verdictNote ? (
                      <Badge tone={STATUS_TONE[selected.status]} dot>
                        {selected.verdictNote.split(" — ")[0]}
                      </Badge>
                    ) : null}
                  </div>

                  {selected.pasteBack ? (
                    <div className="mt-3 rounded-lg border border-line bg-panel/60 p-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">last paste-back</p>
                      <p className="mt-1.5 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ash">{selected.pasteBack}</p>
                      {selected.verdictNote ? <p className="mt-2 text-[12.5px] text-chalk">{selected.verdictNote}</p> : null}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Textarea
                      rows={3}
                      value={pasteBack}
                      onChange={(event) => setPasteBack(event.target.value)}
                      placeholder="Paste the new logcat, or say plainly: “check passed, the .so is packaged now”."
                      className="flex-1"
                    />
                    <div className="flex gap-2 sm:flex-col">
                      <Button variant="primary" onClick={() => void verify()} loading={verifying} disabled={!pasteBack.trim()} icon={<Check width={14} height={14} />}>
                        Verify
                      </Button>
                      <Button variant="ghost" onClick={() => setPasteBack("")} disabled={!pasteBack} icon={<Cross width={14} height={14} />}>
                        Clear
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 font-mono text-[10.5px] text-ash2">
                    Heretic never self-closes a loop: the verdict comes from your evidence.
                  </p>
                </div>
              </Panel>
            </Reveal>
          ) : (
            <Panel>
              <EmptyState
                icon={<Bug width={22} height={22} />}
                title="No case selected"
                body="Select a case from the ledger, or paste a fresh logcat to open one. The engine grades fourteen Android failure families offline."
                action={
                  <Button variant="primary" onClick={openCreate} icon={<Plus width={14} height={14} />}>
                    New case
                  </Button>
                }
              />
            </Panel>
          )}
        </div>
      )}

      {/* create / edit */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={editingId ? "Edit case and re-analyse" : "Open an error case"}
        subtitle="WHAT / WHY / REQUEST SOLUTION is generated the moment you save."
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void (editingId ? updateCase() : createCase())}>
              {editingId ? "Re-analyse" : "Analyse & save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title" hint="optional — derived from the first log line">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="GpuDelegate init throws on Mali-G710" />
          </Field>
          <Field label="Raw logcat" hint="include the Caused by chain">
            <Textarea
              rows={12}
              value={draft.rawLog}
              onChange={(e) => setDraft({ ...draft, rawLog: e.target.value })}
              placeholder={SAMPLE_LOG}
            />
          </Field>
          {draft.rawLog.trim().length > 12 ? (
            <div className="rounded-lg border border-line bg-abyss/60 p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">live preview</p>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ash">
                {analyzeError(draft.rawLog).formatted}
              </pre>
              <ProgressBar className="mt-3" value={analyzeError(draft.rawLog).confidence} label="confidence" />
            </div>
          ) : null}
        </div>
      </Modal>

      {/* quick analyse */}
      <Modal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Quick analyse — nothing is stored"
        subtitle="Same rule tables as the APK's ErrorEngine.kt."
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setQuickOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setEditingId(null);
                setDraft({ title: "", rawLog: quickLog });
                setQuickOpen(false);
                setCreateOpen(true);
              }}
              icon={<Plus width={14} height={14} />}
            >
              Save as case
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Textarea rows={8} value={quickLog} onChange={(e) => setQuickLog(e.target.value)} />
          {quickAnalysis ? (
            <div className="rounded-lg border border-line bg-abyss/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEVERITY_TONE[quickAnalysis.severity] ?? "neutral"}>{quickAnalysis.severity}</Badge>
                <Badge tone="ember">{quickAnalysis.confidence}% confidence</Badge>
                <Badge tone="signal">{quickAnalysis.status}</Badge>
                <span className="ml-auto font-mono text-[10.5px] text-ash2">{quickAnalysis.rules.join(" · ")}</span>
              </div>
              <pre className="mt-3 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ash">{quickAnalysis.formatted}</pre>
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this case?"
        body={`${pendingDelete?.ref ?? ""} and its paste-back history will be removed from the ledger.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void removeCase()}
      />
    </div>
  );
}
