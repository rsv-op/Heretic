"use client";

import { useMemo, useState } from "react";
import { api, cn, timeAgo, useResource } from "@/lib/client";
import type { DecisionRow } from "@/lib/types";
import { validateDecision } from "@/lib/engines";
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
import { Alert, Check, Chevron, Cross, Ledger, Pencil, Plus, Search, Trash } from "@/components/Icons";

interface Draft {
  title: string;
  context: string;
  options: string;
  choice: string;
  reasoning: string;
  impact: string;
  tags: string;
}

const EMPTY: Draft = { title: "", context: "", options: "", choice: "", reasoning: "", impact: "", tags: "" };

export default function DecisionsPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useResource<{ decisions: DecisionRow[] }>("/api/decisions");
  const decisions = data?.decisions ?? [];

  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DecisionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const validation = useMemo(
    () => validateDecision({ title: draft.title, choice: draft.choice, reasoning: draft.reasoning }),
    [draft.title, draft.choice, draft.reasoning],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return decisions;
    return decisions.filter((decision) =>
      [decision.title, decision.choice, decision.reasoning, decision.ref, ...decision.tags].join(" ").toLowerCase().includes(q),
    );
  }, [decisions, query]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY);
    setEditorOpen(true);
  };

  const openEdit = (decision: DecisionRow) => {
    setEditingId(decision.id);
    setDraft({
      title: decision.title,
      context: decision.context,
      options: decision.options.join("\n"),
      choice: decision.choice,
      reasoning: decision.reasoning,
      impact: decision.impact,
      tags: decision.tags.join(", "),
    });
    setEditorOpen(true);
  };

  const submit = async () => {
    if (!validation.valid) {
      toast.push("error", "Decision rejected", validation.errors[0]);
      return;
    }
    setBusy(true);
    const payload = {
      title: draft.title,
      context: draft.context,
      options: draft.options.split("\n").map((o) => o.trim()).filter(Boolean),
      choice: draft.choice,
      reasoning: draft.reasoning,
      impact: draft.impact,
      tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    try {
      if (editingId) {
        const { decision } = await api<{ decision: DecisionRow }>(`/api/decisions/${editingId}`, { method: "PATCH", json: payload });
        setData((prev) => ({ decisions: (prev?.decisions ?? []).map((d) => (d.id === decision.id ? decision : d)) }));
        toast.push("success", "Decision updated", decision.ref);
      } else {
        const { decision } = await api<{ decision: DecisionRow }>("/api/decisions", { method: "POST", json: payload });
        setData((prev) => ({ decisions: [decision, ...(prev?.decisions ?? [])] }));
        toast.push("success", "Decision logged", `${decision.ref} · ${validation.wordCount} words of reasoning`);
      }
      setEditorOpen(false);
      void refetch();
    } catch (err) {
      const detail = (err as { details?: { errors?: string[] } }).details?.errors;
      toast.push("error", "DecisionLogger rejected the entry", detail?.join(" ") ?? (err instanceof Error ? err.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const snapshot = decisions;
    setData({ decisions: decisions.filter((d) => d.id !== id) });
    setPendingDelete(null);
    try {
      await api(`/api/decisions/${id}`, { method: "DELETE" });
      toast.push("success", "Decision removed", pendingDelete.ref);
    } catch (err) {
      setData({ decisions: snapshot });
      toast.push("error", "Delete failed", err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="workflow 06"
        title="Decision transparency log"
        description="No entry is stored without its mandatory reasoning sentence: it must contain “because” and run to at least twelve words. Stubs are rejected with a 422 before they reach the database."
        right={
          <>
            <Badge tone="ember">{decisions.length} logged</Badge>
            <Button size="sm" variant="primary" icon={<Plus width={13} height={13} />} onClick={openCreate}>
              Record a decision
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search width={14} height={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ash2" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search decisions, tags, choices…" className="pl-9" />
        </div>
        <Panel className="flex items-center gap-3 px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">rule</span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-ash">
            <Check width={12} height={12} className="text-mint" /> ≥ 12 words
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-ash">
            <Check width={12} height={12} className="text-mint" /> contains “because”
          </span>
        </Panel>
      </div>

      {error ? (
        <Panel>
          <EmptyState icon={<Alert width={20} height={20} />} title="Could not load the log" body={error} action={<Button onClick={() => void refetch()}>Retry</Button>} />
        </Panel>
      ) : loading ? (
        <LoadingRows rows={4} />
      ) : filtered.length ? (
        <div className="space-y-3">
          {filtered.map((decision, index) => {
            const open = expanded === decision.id;
            return (
              <Reveal key={decision.id} delay={Math.min(index * 45, 240)}>
                <Panel className={cn("overflow-hidden transition-colors", open && "border-ember/30")}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : decision.id)}
                    className="flex w-full items-start gap-4 px-5 py-4 text-left transition hover:bg-white/[0.02]"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line2 bg-panel2 text-ember">
                      <Ledger width={16} height={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10.5px] tracking-[0.14em] text-ember/85">{decision.ref}</span>
                        <Badge tone={decision.status === "ACCEPTED" ? "mint" : decision.status === "SUPERSEDED" ? "neutral" : "signal"}>
                          {decision.status.toLowerCase()}
                        </Badge>
                        <span className="font-mono text-[10.5px] text-ash2">{timeAgo(decision.createdAt)}</span>
                      </span>
                      <span className="mt-1.5 block font-display text-[15px] font-semibold leading-snug tracking-tight text-chalk">
                        {decision.title}
                      </span>
                      <span className="mt-1 block text-[13px] text-ash">
                        chose <span className="text-chalk">{decision.choice}</span>
                      </span>
                    </span>
                    <Chevron width={15} height={15} className={cn("mt-2 shrink-0 text-ash2 transition-transform", open && "rotate-90")} />
                  </button>

                  {open ? (
                    <div className="animate-rise grid gap-5 border-t border-line bg-abyss/40 px-5 py-5 lg:grid-cols-2">
                      <div className="space-y-4">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">context</p>
                          <p className="mt-1.5 text-[13px] leading-relaxed text-ash">{decision.context || "—"}</p>
                        </div>
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">options considered</p>
                          <ul className="mt-1.5 space-y-1">
                            {decision.options.length ? (
                              decision.options.map((option) => (
                                <li
                                  key={option}
                                  className={cn(
                                    "flex items-start gap-2 text-[12.5px] leading-relaxed",
                                    option === decision.choice ? "text-mint" : "text-ash2",
                                  )}
                                >
                                  {option === decision.choice ? <Check width={12} height={12} className="mt-1 shrink-0" /> : <Cross width={12} height={12} className="mt-1 shrink-0" />}
                                  {option}
                                </li>
                              ))
                            ) : (
                              <li className="text-[12.5px] text-ash2">—</li>
                            )}
                          </ul>
                        </div>
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">impact</p>
                          <p className="mt-1.5 text-[13px] leading-relaxed text-ash">{decision.impact || "—"}</p>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between">
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">mandatory reasoning sentence</p>
                          <span className="font-mono text-[10.5px] text-mint">
                            {decision.reasoning.trim().split(/\s+/).filter(Boolean).length} words
                          </span>
                        </div>
                        <p className="mt-2 rounded-lg border border-ember/25 bg-panel/60 p-3.5 text-[13.5px] leading-relaxed text-chalk">
                          {decision.reasoning}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {decision.tags.map((tag) => (
                            <span key={tag} className="rounded border border-line2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ash2">
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                          <CopyButton value={`${decision.ref} — ${decision.title}\n\nChoice: ${decision.choice}\nReasoning: ${decision.reasoning}`} label="copy entry" />
                          <Button size="sm" variant="ghost" icon={<Pencil width={13} height={13} />} onClick={() => openEdit(decision)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" icon={<Trash width={13} height={13} />} onClick={() => setPendingDelete(decision)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </Panel>
              </Reveal>
            );
          })}
        </div>
      ) : (
        <Panel>
          <EmptyState
            icon={<Ledger width={22} height={22} />}
            title={decisions.length ? "No decisions match that search" : "The log is empty"}
            body={
              decisions.length
                ? "Try a different term — titles, choices, reasoning and tags are all searched."
                : "Record why LiteRT won over ONNX, or why the INTERNET permission was dropped. The DecisionLogger will refuse anything without a real reason."
            }
            action={
              decisions.length ? (
                <Button size="sm" onClick={() => setQuery("")}>Clear search</Button>
              ) : (
                <Button variant="primary" size="sm" onClick={openCreate} icon={<Plus width={13} height={13} />}>
                  Record a decision
                </Button>
              )
            }
          />
        </Panel>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingId ? "Edit decision" : "Record an architectural decision"}
        subtitle="Validated client-side and again by the API before anything is written."
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!validation.valid} onClick={() => void submit()}>
              {editingId ? "Save changes" : "Log decision"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="LiteRT 2.3.0 with optional GPU delegate" />
          </Field>
          <Field label="Context">
            <Textarea rows={2} value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} placeholder="Wake-word inference needs sub-100 ms on a mid-range handset." />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Options considered" hint="one per line">
              <Textarea rows={4} value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} placeholder={"LiteRT + litert-gpu\nONNX Runtime Android\nNNAPI directly"} />
            </Field>
            <Field label="Choice">
              <Input value={draft.choice} onChange={(e) => setDraft({ ...draft, choice: e.target.value })} placeholder="LiteRT 2.3.0 + litert-gpu 2.3.0" />
            </Field>
          </div>

          <Field
            label="Mandatory reasoning sentence"
            hint={`${validation.wordCount}/12 words · ${validation.hasBecause ? "“because” found" : "“because” missing"}`}
          >
            <Textarea
              rows={4}
              value={draft.reasoning}
              onChange={(e) => setDraft({ ...draft, reasoning: e.target.value })}
              placeholder="We chose LiteRT with the GPU delegate because it loads int8 flatbuffers without adding a second inference stack to a 150 MB APK."
            />
          </Field>

          <ProgressBar
            value={Math.min(100, (validation.wordCount / 12) * 100)}
            tone={validation.valid ? "mint" : "signal"}
            label="reasoning completeness"
          />

          {validation.errors.length ? (
            <ul className="space-y-1 rounded-md border border-signal/30 bg-signal/[0.07] p-3">
              {validation.errors.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[12.5px] text-signal">
                  <Alert width={13} height={13} className="mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-md border border-mint/30 bg-mint/[0.07] p-3 text-[12.5px] text-mint">
              <Check width={13} height={13} /> Passes the DecisionLogger rule — the entry will be accepted.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Impact">
              <Textarea rows={2} value={draft.impact} onChange={(e) => setDraft({ ...draft, impact: e.target.value })} placeholder="APK grows 6 MB; wake-word latency 38 ms on Tensor G2." />
            </Field>
            <Field label="Tags" hint="comma separated">
              <Input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="inference, litert, performance" />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this decision?"
        body={`${pendingDelete?.ref ?? ""} — “${pendingDelete?.title ?? ""}” will be removed from the transparency log.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
