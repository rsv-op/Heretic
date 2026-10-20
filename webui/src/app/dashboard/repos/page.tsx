"use client";

import { useState } from "react";
import { api, cn, timeAgo, useResource } from "@/lib/client";
import type { MilestoneKind, MilestoneRow, RepoRow } from "@/lib/types";
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
import { Alert, Branch, Check, Plus, Refresh, Terminal, Trash } from "@/components/Icons";

const KINDS: { key: MilestoneKind; label: string; tone: "ember" | "signal" | "ice" }[] = [
  { key: "IMPLEMENT_NOW", label: "implement now", tone: "ember" },
  { key: "CHANGES_NEEDED", label: "changes needed", tone: "signal" },
  { key: "DEFER", label: "defer", tone: "ice" },
];

const HEALTH_TONE: Record<string, "mint" | "signal" | "rose" | "neutral"> = {
  SHIPPED: "mint",
  ON_TRACK: "mint",
  AT_RISK: "signal",
  BLOCKED: "rose",
  EMPTY: "neutral",
};

export default function ReposPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useResource<{ repos: RepoRow[] }>("/api/repos");
  const repos = data?.repos ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", remote: "", branch: "main", summary: "" });
  const [milestoneDraft, setMilestoneDraft] = useState<Record<string, { title: string; kind: MilestoneKind }>>({});
  const [pendingDelete, setPendingDelete] = useState<RepoRow | null>(null);
  const [busy, setBusy] = useState(false);

  const createRepo = async () => {
    if (!draft.name.trim()) {
      toast.push("error", "Repository name is required");
      return;
    }
    setBusy(true);
    try {
      const { repo } = await api<{ repo: RepoRow }>("/api/repos", {
        method: "POST",
        json: {
          ...draft,
          milestones: [
            { title: "Bundle dist/index.html into assets", detail: "cp dist/index.html app/src/main/assets/index.html", kind: "IMPLEMENT_NOW", done: false },
          ],
        },
      });
      setData((prev) => ({ repos: [{ ...repo, milestones: [], evaluation: emptyEvaluation() }, ...(prev?.repos ?? [])] }));
      setCreateOpen(false);
      setDraft({ name: "", remote: "", branch: "main", summary: "" });
      toast.push("success", "Repository tracked", repo.name);
      void refetch();
    } catch (err) {
      toast.push("error", "Could not create the repository", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const removeRepo = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const snapshot = repos;
    setData({ repos: repos.filter((r) => r.id !== id) });
    setPendingDelete(null);
    try {
      await api(`/api/repos/${id}`, { method: "DELETE" });
      toast.push("success", "Repository removed", pendingDelete.name);
    } catch (err) {
      setData({ repos: snapshot });
      toast.push("error", "Delete failed", err instanceof Error ? err.message : undefined);
    }
  };

  const patchRepo = (id: string, patch: Partial<RepoRow>) => {
    setData((prev) => ({ repos: (prev?.repos ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  };

  const toggleMilestone = async (repo: RepoRow, milestone: MilestoneRow) => {
    const snapshot = repos;
    const nextMilestones = repo.milestones.map((m) => (m.id === milestone.id ? { ...m, done: !m.done } : m));
    patchRepo(repo.id, { milestones: nextMilestones });
    try {
      const result = await api<{ milestone: MilestoneRow; evaluation: RepoRow["evaluation"] }>(`/api/milestones/${milestone.id}`, {
        method: "PATCH",
        json: { done: !milestone.done },
      });
      setData((prev) => ({
        repos: (prev?.repos ?? []).map((r) =>
          r.id === repo.id
            ? {
                ...r,
                milestones: r.milestones.map((m) => (m.id === milestone.id ? result.milestone : m)),
                evaluation: result.evaluation,
                health: result.evaluation.health,
              }
            : r,
        ),
      }));
    } catch (err) {
      setData({ repos: snapshot });
      toast.push("error", "Could not update the milestone", err instanceof Error ? err.message : undefined);
    }
  };

  const changeKind = async (repo: RepoRow, milestone: MilestoneRow, kind: MilestoneKind) => {
    const snapshot = repos;
    patchRepo(repo.id, { milestones: repo.milestones.map((m) => (m.id === milestone.id ? { ...m, kind } : m)) });
    try {
      const result = await api<{ milestone: MilestoneRow; evaluation: RepoRow["evaluation"] }>(`/api/milestones/${milestone.id}`, {
        method: "PATCH",
        json: { kind },
      });
      setData((prev) => ({
        repos: (prev?.repos ?? []).map((r) =>
          r.id === repo.id
            ? { ...r, milestones: r.milestones.map((m) => (m.id === milestone.id ? result.milestone : m)), evaluation: result.evaluation, health: result.evaluation.health }
            : r,
        ),
      }));
      toast.push("info", "Milestone re-graded", `${milestone.title} → ${kind.replace(/_/g, " ")}`);
    } catch (err) {
      setData({ repos: snapshot });
      toast.push("error", "Could not re-grade the milestone", err instanceof Error ? err.message : undefined);
    }
  };

  const addMilestone = async (repo: RepoRow) => {
    const draftItem = milestoneDraft[repo.id];
    if (!draftItem?.title.trim()) {
      toast.push("error", "Give the milestone a title");
      return;
    }
    try {
      const result = await api<{ milestone: MilestoneRow; evaluation: RepoRow["evaluation"] }>(`/api/repos/${repo.id}/milestones`, {
        method: "POST",
        json: draftItem,
      });
      setData((prev) => ({
        repos: (prev?.repos ?? []).map((r) =>
          r.id === repo.id
            ? { ...r, milestones: [...r.milestones, result.milestone], evaluation: result.evaluation, health: result.evaluation.health }
            : r,
        ),
      }));
      setMilestoneDraft((prev) => ({ ...prev, [repo.id]: { title: "", kind: draftItem.kind } }));
      toast.push("success", "Milestone added", result.milestone.title);
    } catch (err) {
      toast.push("error", "Could not add the milestone", err instanceof Error ? err.message : undefined);
    }
  };

  const removeMilestone = async (repo: RepoRow, milestone: MilestoneRow) => {
    const snapshot = repos;
    patchRepo(repo.id, { milestones: repo.milestones.filter((m) => m.id !== milestone.id) });
    try {
      const result = await api<{ evaluation: RepoRow["evaluation"] }>(`/api/milestones/${milestone.id}`, { method: "DELETE" });
      setData((prev) => ({
        repos: (prev?.repos ?? []).map((r) => (r.id === repo.id ? { ...r, evaluation: result.evaluation, health: result.evaluation.health } : r)),
      }));
    } catch (err) {
      setData({ repos: snapshot });
      toast.push("error", "Could not delete the milestone", err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="workflow 04"
        title="Repository progress tracker"
        description="Every milestone is graded IMPLEMENT NOW, DEFER or CHANGES NEEDED. Progress is weighted 3/2/1, so deferring work can never inflate the number."
        right={
          <>
            <Button size="sm" variant="ghost" onClick={() => void refetch()} icon={<Refresh width={13} height={13} />}>
              Reload
            </Button>
            <Button size="sm" variant="primary" icon={<Plus width={13} height={13} />} onClick={() => setCreateOpen(true)}>
              Track a repository
            </Button>
          </>
        }
      />

      {error ? (
        <Panel>
          <EmptyState icon={<Alert width={20} height={20} />} title="Could not load repositories" body={error} action={<Button onClick={() => void refetch()}>Retry</Button>} />
        </Panel>
      ) : loading ? (
        <LoadingRows rows={3} />
      ) : repos.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {repos.map((repo, index) => {
            const draftItem = milestoneDraft[repo.id] ?? { title: "", kind: "IMPLEMENT_NOW" as MilestoneKind };
            return (
              <Reveal key={repo.id} delay={index * 60}>
                <Panel className="h-full overflow-hidden">
                  <header className="border-b border-line bg-panel2/40 px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Branch width={15} height={15} className="text-ember" />
                          <h3 className="truncate font-display text-[15px] font-semibold tracking-tight text-chalk">{repo.name}</h3>
                          <Badge tone={HEALTH_TONE[repo.health] ?? "neutral"} dot>
                            {repo.health.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate font-mono text-[10.5px] text-ash2">
                          {repo.remote} · {repo.branch}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" icon={<Trash width={13} height={13} />} onClick={() => setPendingDelete(repo)}>
                        Delete
                      </Button>
                    </div>

                    {repo.summary ? <p className="mt-2.5 text-[13px] leading-relaxed text-ash">{repo.summary}</p> : null}

                    <ProgressBar
                      className="mt-4"
                      value={repo.evaluation.progress}
                      tone={repo.health === "BLOCKED" ? "rose" : repo.health === "AT_RISK" ? "signal" : repo.health === "SHIPPED" ? "mint" : "ember"}
                      label={`weighted progress · ${repo.evaluation.done}/${repo.evaluation.total} done`}
                    />

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {KINDS.map((kind) => (
                        <Badge key={kind.key} tone={kind.tone}>
                          {kind.label} {repo.evaluation.counts[kind.key] ?? 0}
                        </Badge>
                      ))}
                      <span className="ml-auto font-mono text-[10.5px] text-ash2">{timeAgo(repo.updatedAt)}</span>
                    </div>
                    <p className="mt-2 text-[12.5px] text-ash">→ {repo.evaluation.nextAction}</p>
                  </header>

                  <ul className="divide-y divide-line/60">
                    {repo.milestones.length ? (
                      repo.milestones.map((milestone) => (
                        <li key={milestone.id} className="group flex items-start gap-3 px-5 py-3">
                          <button
                            type="button"
                            onClick={() => void toggleMilestone(repo, milestone)}
                            aria-label={milestone.done ? "Mark as not done" : "Mark as done"}
                            className={cn(
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition",
                              milestone.done ? "border-mint/60 bg-mint/20 text-mint" : "border-line2 text-transparent hover:border-ember/50",
                            )}
                          >
                            <Check width={12} height={12} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-[13px] leading-snug", milestone.done ? "text-ash2 line-through" : "text-chalk")}>
                              {milestone.title}
                            </p>
                            {milestone.detail ? (
                              <p className="mt-0.5 font-mono text-[10.5px] leading-relaxed text-ash2">{milestone.detail}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {KINDS.map((kind) => (
                              <button
                                key={kind.key}
                                type="button"
                                onClick={() => void changeKind(repo, milestone, kind.key)}
                                title={kind.label}
                                className={cn(
                                  "rounded border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] transition",
                                  milestone.kind === kind.key
                                    ? kind.tone === "ember"
                                      ? "border-ember/50 bg-ember/15 text-embersoft"
                                      : kind.tone === "signal"
                                        ? "border-signal/50 bg-signal/15 text-signal"
                                        : "border-ice/50 bg-ice/15 text-ice"
                                    : "border-line2 text-ash2/70 opacity-0 group-hover:opacity-100 hover:text-chalk",
                                )}
                              >
                                {kind.key === "IMPLEMENT_NOW" ? "now" : kind.key === "CHANGES_NEEDED" ? "chg" : "defer"}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => void removeMilestone(repo, milestone)}
                              className="ml-1 text-ash2 opacity-0 transition group-hover:opacity-100 hover:text-rose"
                              aria-label="Delete milestone"
                            >
                              <Trash width={13} height={13} />
                            </button>
                          </div>
                        </li>
                      ))
                    ) : (
                      <li className="px-5 py-6 text-center text-[13px] text-ash2">
                        No milestones yet — grade the work below.
                      </li>
                    )}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2 border-t border-line bg-abyss/40 px-5 py-3">
                    <Input
                      value={draftItem.title}
                      onChange={(event) => setMilestoneDraft((prev) => ({ ...prev, [repo.id]: { ...draftItem, title: event.target.value } }))}
                      onKeyDown={(event) => event.key === "Enter" && void addMilestone(repo)}
                      placeholder="Add a milestone…"
                      className="min-w-[10rem] flex-1"
                    />
                    <div className="flex gap-1">
                      {KINDS.map((kind) => (
                        <button
                          key={kind.key}
                          type="button"
                          onClick={() => setMilestoneDraft((prev) => ({ ...prev, [repo.id]: { ...draftItem, kind: kind.key } }))}
                          className={cn(
                            "rounded border px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition",
                            draftItem.kind === kind.key ? "border-ember/50 bg-ember/12 text-embersoft" : "border-line2 text-ash2 hover:text-chalk",
                          )}
                        >
                          {kind.key === "IMPLEMENT_NOW" ? "now" : kind.key === "CHANGES_NEEDED" ? "chg" : "defer"}
                        </button>
                      ))}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void addMilestone(repo)} icon={<Plus width={13} height={13} />}>
                      Add
                    </Button>
                  </div>

                  {repo.evaluation.blockers.length ? (
                    <div className="border-t border-line px-5 py-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">open blockers</p>
                      <ul className="mt-2 space-y-1">
                        {repo.evaluation.blockers.map((blocker) => (
                          <li key={blocker} className="flex items-center gap-2 text-[12.5px] text-signal">
                            <Alert width={12} height={12} /> {blocker}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <p className="border-t border-line px-5 py-3 font-mono text-[10.5px] leading-relaxed text-ash2">
                    <Terminal width={11} height={11} className="mr-1 inline" />
                    {repo.lastCommit}
                  </p>
                </Panel>
              </Reveal>
            );
          })}
        </div>
      ) : (
        <Panel>
          <EmptyState
            icon={<Branch width={22} height={22} />}
            title="No repositories tracked"
            body="Track HeretIc-android, the voice pack or the command center itself. Milestones are graded, weighted and rolled into a single honest progress number."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)} icon={<Plus width={14} height={14} />}>
                Track a repository
              </Button>
            }
          />
        </Panel>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Track a repository"
        subtitle="A first IMPLEMENT NOW milestone is created for the asset copy step."
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void createRepo()}>
              Start tracking
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="HeretIc-android" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Remote">
              <Input value={draft.remote} onChange={(e) => setDraft({ ...draft, remote: e.target.value })} placeholder="github.com/heretic-ai/HeretIc" />
            </Field>
            <Field label="Branch">
              <Input value={draft.branch} onChange={(e) => setDraft({ ...draft, branch: e.target.value })} />
            </Field>
          </div>
          <Field label="Summary">
            <Textarea rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder="Unified APK: bundled single-file web UI + native Kotlin core." />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Stop tracking this repository?"
        body={`${pendingDelete?.name ?? ""} and every graded milestone under it will be deleted.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void removeRepo()}
      />
    </div>
  );
}

function emptyEvaluation(): RepoRow["evaluation"] {
  return {
    progress: 0,
    health: "EMPTY",
    counts: { IMPLEMENT_NOW: 0, DEFER: 0, CHANGES_NEEDED: 0 },
    done: 0,
    total: 0,
    blockers: [],
    nextAction: "Add the first milestone to start tracking.",
    verdict: "No milestones recorded.",
  };
}
