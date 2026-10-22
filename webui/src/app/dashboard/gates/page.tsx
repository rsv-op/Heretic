"use client";

import { useMemo, useState } from "react";
import { api, cn, hashShort, timeAgo, useResource } from "@/lib/client";
import type { GateDecision, GateRow } from "@/lib/types";
import type { GateDefinition } from "@/lib/engines";
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
  Textarea,
  useToast,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { Alert, Check, Cross, Gate, Lock, Plus, Refresh, Terminal } from "@/components/Icons";

const DECISION_TONE: Record<GateDecision, "mint" | "rose" | "signal" | "neutral"> = {
  GRANTED: "mint",
  DENIED: "rose",
  REVOKED: "signal",
  PENDING: "neutral",
};

const RISK_TONE: Record<string, "rose" | "signal" | "mint"> = {
  high: "rose",
  medium: "signal",
  low: "mint",
};

interface GatesPayload {
  gates: GateRow[];
  catalog: GateDefinition[];
  audit: { intact: boolean; brokenAt: number; entries: number; head: string; granted: number; denied: number; pending: number };
}

export default function GatesPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useResource<GatesPayload>("/api/gates");
  const gates = data?.gates ?? [];
  const catalog = data?.catalog ?? [];

  const [deciding, setDeciding] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [draft, setDraft] = useState({ action: "", scope: "this-instance-only", risk: "medium", reason: "" });
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GateRow | null>(null);

  const decidedCount = useMemo(() => gates.filter((g) => g.decision !== "PENDING").length, [gates]);

  const decide = async (gate: GateRow, decision: GateDecision) => {
    const snapshot = gates;
    setDeciding(gate.id);
    setData((prev) =>
      prev
        ? {
            ...prev,
            gates: prev.gates.map((g) =>
              g.id === gate.id ? { ...g, decision, decidedBy: "you", decidedAt: new Date().toISOString() } : g,
            ),
          }
        : prev,
    );
    try {
      const result = await api<{ gate: GateRow; audit: GatesPayload["audit"] }>(`/api/gates/${gate.id}`, {
        method: "PATCH",
        json: { decision },
      });
      setData((prev) =>
        prev ? { ...prev, gates: prev.gates.map((g) => (g.id === result.gate.id ? result.gate : g)), audit: result.audit } : prev,
      );
      toast.push(
        decision === "GRANTED" ? "success" : decision === "DENIED" ? "error" : "info",
        `${gate.gateKey} → ${decision}`,
        decision === "GRANTED" ? `Consent recorded for ${gate.scope}. Ledger re-chained.` : `Refused. The native call is blocked until you allow it again.`,
      );
    } catch (err) {
      setData({ ...(data as GatesPayload), gates: snapshot });
      toast.push("error", "Could not record the decision", err instanceof Error ? err.message : undefined);
    } finally {
      setDeciding(null);
    }
  };

  const resetAll = async () => {
    setResetOpen(false);
    try {
      const result = await api<{ audit: GatesPayload["audit"] }>("/api/gates/reset", { method: "POST" });
      setData((prev) =>
        prev
          ? {
              ...prev,
              audit: result.audit,
              gates: prev.gates.map((g) => ({ ...g, decision: "PENDING", decidedBy: null, decidedAt: null })),
            }
          : prev,
      );
      toast.push("info", "All grants cleared", "Ledger re-chained from genesis — equivalent to AuthorizationGate.clearInstanceGrants().");
      void refetch();
    } catch (err) {
      toast.push("error", "Reset failed", err instanceof Error ? err.message : undefined);
    }
  };

  const requestGate = async () => {
    if (!draft.action.trim()) {
      toast.push("error", "Describe the action being requested");
      return;
    }
    try {
      const { gate } = await api<{ gate: GateRow }>("/api/gates", { method: "POST", json: draft });
      setData((prev) => (prev ? { ...prev, gates: [...prev.gates, gate] } : prev));
      setRequestOpen(false);
      setDraft({ action: "", scope: "this-instance-only", risk: "medium", reason: "" });
      toast.push("success", "Gate armed", `${gate.gateKey} is pending your decision.`);
      void refetch();
    } catch (err) {
      toast.push("error", "Could not arm the gate", err instanceof Error ? err.message : undefined);
    }
  };

  const removeGate = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const snapshot = gates;
    setData((prev) => (prev ? { ...prev, gates: prev.gates.filter((g) => g.id !== id) } : prev));
    setPendingDelete(null);
    try {
      const result = await api<{ audit: GatesPayload["audit"] }>(`/api/gates/${id}`, { method: "DELETE" });
      setData((prev) => (prev ? { ...prev, audit: result.audit } : prev));
      toast.push("success", "Gate removed", "Ledger re-chained after the removal.");
    } catch (err) {
      setData((prev) => (prev ? { ...prev, gates: snapshot } : prev));
      toast.push("error", "Delete failed", err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="workflow 05"
        title="Authorization gates"
        description="Per-instance consent for every sensitive capability. Each decision is appended to a hash-chained audit ledger — the offline equivalent of AuthorizationGate.verify()."
        right={
          <>
            <Badge tone={data?.audit.intact ? "mint" : "rose"} dot>
              {data?.audit.intact ? "chain intact" : `chain broken @${data?.audit.brokenAt}`}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => void refetch()} icon={<Refresh width={13} height={13} />}>
              Reload
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)} icon={<Plus width={13} height={13} />}>
              Arm a gate
            </Button>
            <Button size="sm" variant="danger" onClick={() => setResetOpen(true)} icon={<Lock width={13} height={13} />}>
              Clear grants
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "granted", value: data?.audit.granted ?? 0, tone: "mint" as const },
          { label: "denied", value: data?.audit.denied ?? 0, tone: "rose" as const },
          { label: "pending", value: data?.audit.pending ?? 0, tone: "signal" as const },
        ].map((cell) => (
          <Panel key={cell.label} className="flex items-center justify-between px-4 py-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">{cell.label}</span>
            <span className={cn("font-display text-2xl font-semibold", cell.tone === "mint" ? "text-mint" : cell.tone === "rose" ? "text-rose" : "text-signal")}>
              {loading ? "—" : cell.value}
            </span>
          </Panel>
        ))}
      </div>

      {error ? (
        <Panel>
          <EmptyState icon={<Alert width={20} height={20} />} title="Could not load the ledger" body={error} action={<Button onClick={() => void refetch()}>Retry</Button>} />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
          {/* gate cards */}
          <div className="space-y-3">
            {loading ? (
              <LoadingRows rows={4} />
            ) : gates.length ? (
              gates.map((gate, index) => {
                const definition = catalog.find((c) => c.key === gate.gateKey);
                return (
                  <Reveal key={gate.id} delay={Math.min(index * 45, 260)}>
                    <Panel className="p-4 transition-colors hover:border-line2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
                              gate.decision === "GRANTED"
                                ? "border-mint/40 bg-mint/10 text-mint"
                                : gate.decision === "DENIED" || gate.decision === "REVOKED"
                                  ? "border-rose/40 bg-rose/10 text-rose"
                                  : "border-line2 bg-panel2 text-ash",
                            )}
                          >
                            <Gate width={16} height={16} />
                          </span>
                          <div className="min-w-0">
                            <p className="font-display text-[14px] font-semibold leading-snug tracking-tight text-chalk">{gate.action}</p>
                            <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ash2">
                              {gate.gateKey} · {definition?.permission ?? gate.scope}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={RISK_TONE[gate.risk] ?? "neutral"}>{gate.risk} risk</Badge>
                          <Badge tone={DECISION_TONE[gate.decision]} dot={gate.decision === "GRANTED"}>
                            {gate.decision}
                          </Badge>
                        </div>
                      </div>

                      <p className="mt-3 text-[13px] leading-relaxed text-ash">{gate.reason}</p>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant={gate.decision === "GRANTED" ? "mint" : "outline"}
                          loading={deciding === gate.id}
                          onClick={() => void decide(gate, "GRANTED")}
                          icon={<Check width={13} height={13} />}
                        >
                          Allow once
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deciding === gate.id}
                          onClick={() => void decide(gate, "DENIED")}
                          icon={<Cross width={13} height={13} />}
                        >
                          Deny
                        </Button>
                        {gate.decision === "GRANTED" ? (
                          <Button size="sm" variant="ghost" disabled={deciding === gate.id} onClick={() => void decide(gate, "REVOKED")}>
                            Revoke
                          </Button>
                        ) : null}
                        <span className="ml-auto font-mono text-[10.5px] text-ash2">
                          scope {gate.scope}
                          {gate.decidedAt ? ` · ${timeAgo(gate.decidedAt)}` : ""}
                          {gate.decidedBy ? ` · ${gate.decidedBy}` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(gate)}
                          className="text-ash2 transition hover:text-rose"
                          aria-label="Remove gate"
                        >
                          <Trashish />
                        </button>
                      </div>
                    </Panel>
                  </Reveal>
                );
              })
            ) : (
              <Panel>
                <EmptyState
                  icon={<Gate width={22} height={22} />}
                  title="No gates armed"
                  body="Arm the five catalog gates (mic capture, SAF read, model load, TTS output, WebView bridge) or add a custom one."
                  action={
                    <Button variant="primary" size="sm" onClick={() => setRequestOpen(true)} icon={<Plus width={13} height={13} />}>
                      Arm a gate
                    </Button>
                  }
                />
              </Panel>
            )}
          </div>

          {/* ledger */}
          <Panel className="h-fit overflow-hidden xl:sticky xl:top-24">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">audit ledger</p>
              <Badge tone={data?.audit.intact ? "mint" : "rose"}>{decidedCount} decisions</Badge>
            </div>
            <div className="max-h-[34rem] overflow-y-auto">
              {loading ? (
                <LoadingRows rows={5} className="p-3" />
              ) : gates.length ? (
                <ol className="divide-y divide-line/60">
                  {gates.map((gate, index) => (
                    <li key={gate.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10.5px] text-ash2">#{String(index).padStart(2, "0")}</span>
                        <Badge tone={DECISION_TONE[gate.decision]}>{gate.decision}</Badge>
                      </div>
                      <p className="mt-1.5 truncate text-[12.5px] text-chalk">{gate.gateKey}</p>
                      <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-ash2">
                        prev <span className="text-ash">{hashShort(gate.prevHash)}</span>
                        <br />
                        hash <span className="text-embersoft">{hashShort(gate.auditHash)}</span>
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-ash2/80">{timeAgo(gate.createdAt)}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="px-4 py-8 text-center text-[13px] text-ash2">Ledger empty — head is genesis.</p>
              )}
            </div>
            <div className="border-t border-line bg-abyss/50 px-4 py-3">
              <p className="flex items-center gap-2 font-mono text-[10.5px] text-ash2">
                <Terminal width={12} height={12} /> head {hashShort(data?.audit.head ?? "genesis")}
              </p>
            </div>
          </Panel>
        </div>
      )}

      <Modal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        title="Arm a new authorization gate"
        subtitle="It starts PENDING and joins the ledger at the current head."
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRequestOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void requestGate()}>
              Arm gate
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Action" hint="what the app wants to do">
            <Input
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              placeholder="Install a Piper voice bank from a picked file"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Scope">
              <Input value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
            </Field>
            <Field label="Risk">
              <div className="flex gap-2">
                {(["low", "medium", "high"] as const).map((risk) => (
                  <button
                    key={risk}
                    type="button"
                    onClick={() => setDraft({ ...draft, risk })}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition",
                      draft.risk === risk ? "border-ember/50 bg-ember/12 text-embersoft" : "border-line2 text-ash2 hover:text-chalk",
                    )}
                  >
                    {risk}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <Field label="Reason" hint="shown in the consent dialog">
            <Textarea
              rows={3}
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="Voice bank installation writes to app-private storage and is required for offline TTS."
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={resetOpen}
        title="Clear every per-instance grant?"
        body="All gates return to PENDING and the ledger is re-chained from genesis. The Android equivalent is AuthorizationGate.clearInstanceGrants()."
        confirmLabel="Clear grants"
        onCancel={() => setResetOpen(false)}
        onConfirm={() => void resetAll()}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this gate?"
        body={`${pendingDelete?.gateKey ?? ""} will be dropped from the ledger and the chain re-linked.`}
        confirmLabel="Remove"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void removeGate()}
      />
    </div>
  );
}

function Trashish() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <path d="M4.8 7h14.4M9.5 7V5.2h5V7M6.6 7l.9 12h9l.9-12" />
    </svg>
  );
}
