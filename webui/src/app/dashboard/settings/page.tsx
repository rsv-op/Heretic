"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, cn, timeAgo, useResource } from "@/lib/client";
import type { DashboardPayload } from "@/lib/types";
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  KeyValue,
  Panel,
  SectionHeading,
  Select,
  useToast,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { Bolt, Check, Droid, Gate, Lock, Logout, Refresh, Terminal, Trash } from "@/components/Icons";

const BRIDGE_MODES = [
  { key: "browser", label: "browser · Web Speech API", note: "Web Speech recognition + speechSynthesis" },
  { key: "native-webview", label: "native webview · HereticNative", note: "window.HereticNative bridge attached" },
  { key: "compose", label: "compose · HereticApp()", note: "native Jetpack Compose UI" },
];

const MANIFEST_FACTS = [
  { label: "INTERNET permission", value: "not declared", tone: "mint" as const, detail: "No code path can reach a network." },
  { label: "RECORD_AUDIO", value: "runtime, on tap", tone: "signal" as const, detail: "Requested inside the mic button launcher only." },
  { label: "Background services", value: "0", tone: "mint" as const, detail: "No <service>, <receiver> or WorkManager job." },
  { label: "Storage access", value: "SAF single URI", tone: "signal" as const, detail: "ACTION_OPEN_DOCUMENT; allowFileAccess = false." },
  { label: "allowBackup", value: "false", tone: "ice" as const, detail: "Transcripts and ledgers never leave via cloud backup." },
];

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const { data: me, refetch: refetchMe } = useResource<{ user: ProfileUser }>("/api/me");
  const { data: dashboard } = useResource<DashboardPayload>("/api/dashboard");

  const [form, setForm] = useState({ name: "", handle: "", deviceModel: "", bridgeMode: "browser" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [bridge, setBridge] = useState(false);

  useEffect(() => {
    setBridge(typeof window !== "undefined" && Boolean(window.HereticNative));
  }, []);

  useEffect(() => {
    if (me?.user) {
      setForm({
        name: me.user.name,
        handle: me.user.handle,
        deviceModel: me.user.deviceModel,
        bridgeMode: me.user.bridgeMode,
      });
    }
  }, [me]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await api("/api/me", { method: "PATCH", json: form });
      await refetchMe();
      toast.push("success", "Profile updated", `${form.name} · @${form.handle}`);
      router.refresh();
    } catch (err) {
      toast.push("error", "Could not save the profile", err instanceof Error ? err.message : undefined);
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (passwords.newPassword.length < 8) {
      toast.push("error", "New password must be at least 8 characters");
      return;
    }
    setSavingPassword(true);
    try {
      await api("/api/me/password", { method: "POST", json: passwords });
      setPasswords({ currentPassword: "", newPassword: "" });
      toast.push("success", "Password changed", "Existing sessions stay valid until they expire.");
    } catch (err) {
      toast.push("error", "Password change failed", err instanceof Error ? err.message : undefined);
    } finally {
      setSavingPassword(false);
    }
  };

  const loadDemo = async () => {
    setSeeding(true);
    try {
      await api("/api/seed", { method: "POST" });
      toast.push("success", "Demo workspace loaded", "Conversations, cases, files, repos, gates and decisions re-seeded.");
      router.refresh();
      window.location.href = "/dashboard";
    } catch (err) {
      toast.push("error", "Seeding failed", err instanceof Error ? err.message : undefined);
    } finally {
      setSeeding(false);
    }
  };

  const wipe = async () => {
    setWipeOpen(false);
    try {
      await api("/api/workspace", { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.push("error", "Wipe failed", err instanceof Error ? err.message : undefined);
    }
  };

  const user = me?.user;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="operator"
        title="Settings & safeguards"
        description="Your profile, credentials and the workspace data controls — plus a read-out of the Android manifest guarantees this build ships with."
        right={
          <Badge tone={bridge ? "mint" : "ember"} dot>
            {bridge ? "HereticNative attached" : "browser runtime"}
          </Badge>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {/* profile */}
        <Reveal>
          <Panel className="p-5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">operator profile</p>
              <Badge tone="neutral">{user?.role ?? "operator"}</Badge>
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Display name">
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="Handle">
                  <Input value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
                </Field>
              </div>
              <Field label="Target device" hint="shown in the sidebar">
                <Input value={form.deviceModel} onChange={(e) => setForm({ ...form, deviceModel: e.target.value })} />
              </Field>
              <Field label="Frontend mode" hint="which UI the APK renders">
                <Select value={form.bridgeMode} onChange={(e) => setForm({ ...form, bridgeMode: e.target.value })}>
                  {BRIDGE_MODES.map((mode) => (
                    <option key={mode.key} value={mode.key} className="bg-panel">
                      {mode.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="font-mono text-[11px] text-ash2">
                {BRIDGE_MODES.find((m) => m.key === form.bridgeMode)?.note}
              </p>
              <Button variant="primary" loading={savingProfile} onClick={() => void saveProfile()} icon={<Check width={14} height={14} />}>
                Save profile
              </Button>
            </div>

            <div className="mt-6 border-t border-line pt-4">
              <KeyValue
                rows={[
                  ["email", <span className="font-mono text-[12px]">{user?.email ?? "—"}</span>],
                  ["workspace id", <span className="font-mono text-[12px] text-ash2">{user?.id.slice(0, 8) ?? "—"}</span>],
                  ["member since", user ? timeAgo(user.createdAt) : "—"],
                  ["audit entries", dashboard?.audit.entries ?? 0],
                  ["embedded sources", dashboard?.counters.androidSources ?? 0],
                ]}
              />
            </div>
          </Panel>
        </Reveal>

        {/* security + data */}
        <div className="space-y-4">
          <Reveal delay={60}>
            <Panel className="p-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">credentials</p>
              <p className="mt-2 text-[13px] leading-relaxed text-ash">
                Passwords are hashed with scrypt (64-byte key, per-user salt) and sessions are stored as SHA-256 token
                hashes — never the token itself.
              </p>
              <div className="mt-4 space-y-4">
                <Field label="Current password">
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={passwords.currentPassword}
                    onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
                  />
                </Field>
                <Field label="New password" hint="min 8 characters">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={passwords.newPassword}
                    onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                  />
                </Field>
                <Button variant="outline" loading={savingPassword} onClick={() => void changePassword()} icon={<Lock width={14} height={14} />}>
                  Change password
                </Button>
              </div>
            </Panel>
          </Reveal>

          <Reveal delay={110}>
            <Panel className="p-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">workspace data</p>
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-abyss/50 px-4 py-3">
                  <div>
                    <p className="font-display text-[13.5px] font-semibold text-chalk">Load the demo dataset</p>
                    <p className="mt-0.5 text-[12.5px] text-ash">
                      Replaces workspace rows with the seeded operator data: 4 sessions, 6 error cases, 10 assessed files,
                      3 repositories, 5 gates, 8 decisions, 3 build runs and the full Android tree.
                    </p>
                  </div>
                  <Button size="sm" variant="primary" loading={seeding} onClick={() => void loadDemo()} icon={<Bolt width={13} height={13} />}>
                    Load
                  </Button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose/25 bg-rose/[0.05] px-4 py-3">
                  <div>
                    <p className="font-display text-[13.5px] font-semibold text-chalk">Wipe and sign out</p>
                    <p className="mt-0.5 text-[12.5px] text-ash">
                      Deletes every workspace row, re-arms the skeleton (Android sources + gate catalog) and ends this
                      session.
                    </p>
                  </div>
                  <Button size="sm" variant="danger" onClick={() => setWipeOpen(true)} icon={<Trash width={13} height={13} />}>
                    Wipe
                  </Button>
                </div>

                <div className="flex items-center gap-2 rounded-lg border border-line bg-abyss/50 px-4 py-3">
                  <Terminal width={14} height={14} className="text-ash2" />
                  <p className="font-mono text-[11.5px] text-ash2">
                    demo credentials · operator@heretic.ai / heretic-offline
                  </p>
                  <Button size="sm" variant="ghost" className="ml-auto" icon={<Logout width={13} height={13} />} onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.push("/"); router.refresh(); }}>
                    Sign out
                  </Button>
                </div>
              </div>
            </Panel>
          </Reveal>
        </div>
      </div>

      {/* manifest read-out */}
      <Reveal>
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ash2">android manifest guarantees</p>
              <h3 className="mt-1 font-display text-base font-semibold tracking-tight">What the APK is not allowed to do</h3>
            </div>
            <Badge tone="mint" dot>
              enforced at build time
            </Badge>
          </div>
          <ul className="divide-y divide-line/70">
            {MANIFEST_FACTS.map((fact) => (
              <li key={fact.label} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[14rem_12rem_1fr] sm:items-center">
                <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-ash">{fact.label}</span>
                <Badge tone={fact.tone}>{fact.value}</Badge>
                <span className="text-[12.5px] text-ash2">{fact.detail}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-4 border-t border-line bg-abyss/50 px-5 py-4">
            <span className="flex items-center gap-2 font-mono text-[11px] text-ash2">
              <Droid width={13} height={13} /> ai.heretic.app · versionName 2.3.0-offline · minSdk 26 · targetSdk 35
            </span>
            <span className="flex items-center gap-2 font-mono text-[11px] text-ash2">
              <Gate width={13} height={13} /> audit head {dashboard?.audit.head.slice(0, 10) ?? "genesis"}
            </span>
            <span className={cn("ml-auto flex items-center gap-2 font-mono text-[11px]", dashboard?.audit.chainIntact ? "text-mint" : "text-rose")}>
              <Refresh width={13} height={13} /> chain {dashboard?.audit.chainIntact ? "verified" : "broken"}
            </span>
          </div>
        </Panel>
      </Reveal>

      <ConfirmDialog
        open={wipeOpen}
        title="Wipe this workspace?"
        body="Every conversation, case, assessment, milestone, gate entry and decision will be deleted, the skeleton re-armed, and you will be signed out."
        confirmLabel="Wipe and sign out"
        onCancel={() => setWipeOpen(false)}
        onConfirm={() => void wipe()}
      />
    </div>
  );
}

interface ProfileUser {
  id: string;
  email: string;
  handle: string;
  name: string;
  role: string;
  deviceModel: string;
  bridgeMode: string;
  createdAt: string;
}
