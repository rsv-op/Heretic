"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Badge, Button, Field, Input, Panel } from "@/components/ui";
import { KenBurns, Scramble } from "@/components/motion";
import { Arrow, Bolt, Lock, Sigil, Terminal } from "@/components/Icons";
import { AuthAside } from "@/components/AuthAside";

export function LoginView() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"login" | "demo" | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("login");
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password } });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setBusy(null);
    }
  };

  const demo = async () => {
    setBusy("demo");
    setError(null);
    try {
      await api("/api/auth/demo", { method: "POST" });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo workspace unavailable");
      setBusy(null);
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
            text="AUTHENTICATE OPERATOR"
            className="font-display text-2xl font-semibold uppercase tracking-tight text-chalk"
            speed={26}
          />
          <p className="mt-2 text-sm leading-relaxed text-ash">
            Sessions are stored as hashed tokens in Postgres. No third-party auth, no network dependency at runtime.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Email">
              <Input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="operator@heretic.ai"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••"
              />
            </Field>

            {error ? (
              <p className="rounded-md border border-rose/35 bg-rose/10 px-3 py-2 text-[13px] text-rose">{error}</p>
            ) : null}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === "login"} icon={<Lock width={15} height={15} />}>
              Sign in
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ash2">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <Panel className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-[13.5px] font-semibold text-chalk">Seeded operator workspace</p>
                <p className="mt-1 font-mono text-[11px] text-ash2">operator@heretic.ai · heretic-offline</p>
              </div>
              <Badge tone="mint" dot>
                live data
              </Badge>
            </div>
            <Button variant="outline" size="sm" className="mt-3 w-full" loading={busy === "demo"} onClick={demo} icon={<Bolt width={13} height={13} />}>
              Enter the demo workspace
            </Button>
          </Panel>

          <p className="mt-6 flex items-center gap-2 text-[13px] text-ash">
            <Terminal width={14} height={14} className="text-ash2" />
            No account?{" "}
            <Link href="/register" className="text-embersoft underline-offset-4 transition hover:underline">
              Create an operator profile <Arrow width={12} height={12} className="inline" />
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export { KenBurns };
