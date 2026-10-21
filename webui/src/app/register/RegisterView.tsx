"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { Scramble } from "@/components/motion";
import { Arrow, Bolt, Sigil, User } from "@/components/Icons";
import { AuthAside } from "@/components/AuthAside";

const DEVICES = [
  "Pixel 7 · Android 14",
  "Pixel 8 Pro · Android 15",
  "Galaxy S23 · Android 14",
  "OnePlus 12 · Android 14",
  "Fairphone 5 · Android 13",
  "Emulator arm64-v8a · API 34",
];

export function RegisterView() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", handle: "", password: "", deviceModel: DEVICES[0] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", { method: "POST", json: form });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    try {
      await api("/api/auth/demo", { method: "POST" });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo workspace unavailable");
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <AuthAside />

      <div className="flex items-center justify-center px-5 py-14 sm:px-10">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 inline-flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-ember/40 bg-ember/10 text-ember">
              <Sigil width={18} height={18} />
            </span>
            <span className="font-display text-[15px] font-bold tracking-tight text-chalk">
              HERETIC<span className="text-ember">.ai</span>
            </span>
          </Link>

          <Scramble
            as="h1"
            text="PROVISION OPERATOR"
            className="font-display text-2xl font-semibold uppercase tracking-tight text-chalk"
            speed={26}
          />
          <p className="mt-2 text-sm leading-relaxed text-ash">
            Your workspace is created with the Android source tree and the authorization gate catalog already armed.
            Load the full demo dataset any time from Settings.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Display name">
              <Input required value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Operator Vale" />
            </Field>
            <Field label="Email">
              <Input
                required
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="you@device.local"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Handle" hint="lowercase">
                <Input value={form.handle} onChange={(e) => update("handle", e.target.value)} placeholder="vale" />
              </Field>
              <Field label="Target device">
                <Select value={form.deviceModel} onChange={(e) => update("deviceModel", e.target.value)}>
                  {DEVICES.map((device) => (
                    <option key={device} value={device} className="bg-panel">
                      {device}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Password" hint="min 8 characters">
              <Input
                required
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                placeholder="••••••••••"
              />
            </Field>

            {error ? (
              <p className="rounded-md border border-rose/35 bg-rose/10 px-3 py-2 text-[13px] text-rose">{error}</p>
            ) : null}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} icon={<User width={15} height={15} />}>
              Create workspace
            </Button>
          </form>

          <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-line bg-panel/60 px-4 py-3">
            <div>
              <p className="font-display text-[13px] font-semibold text-chalk">Prefer the seeded dataset?</p>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ash2">4 conversations · 6 cases · 8 decisions</p>
            </div>
            <Button size="sm" variant="outline" onClick={demo} icon={<Bolt width={13} height={13} />}>
              Demo
            </Button>
          </div>

          <p className="mt-6 flex items-center gap-2 text-[13px] text-ash">
            <Badge tone="neutral">existing operator</Badge>
            <Link href="/login" className="text-embersoft underline-offset-4 transition hover:underline">
              Sign in <Arrow width={12} height={12} className="inline" />
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
