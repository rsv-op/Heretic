import { NextResponse } from "next/server";
import { getCurrentUser, publicUser, type PublicUser } from "@/lib/auth";
import type { User } from "@/db/schema";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function readJson<T extends Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const body = (await req.json()) as T;
    return body ?? ({} as T);
  } catch {
    return {} as T;
  }
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/** Guards Postgres uuid columns from malformed path segments. */
export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function num(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type AuthContext = { user: User; publicUser: PublicUser };

export async function requireUser(): Promise<AuthContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { user, publicUser: publicUser(user) };
}

/** Throws a sentinel the route can convert into a 401 response. */
export async function authed(req: Request): Promise<{ ctx: AuthContext } | { error: NextResponse }> {
  const ctx = await requireUser();
  if (!ctx) return { error: fail("Not authenticated", 401) };
  void req;
  return { ctx };
}
