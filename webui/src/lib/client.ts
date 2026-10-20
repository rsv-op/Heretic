"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });

  const text = await res.text();
  const payload = (text ? JSON.parse(text) : {}) as Record<string, unknown>;

  if (!res.ok) {
    const errors = payload.errors;
    const detail = Array.isArray(errors) && errors.length ? errors.map(String).join(" ") : undefined;
    throw new ApiError(
      detail || (typeof payload.error === "string" ? payload.error : `Request failed (${res.status})`),
      res.status,
      payload,
    );
  }
  return payload as T;
}

export async function downloadArtifact(path: string, fallbackName: string) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError("Download failed", res.status);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = match?.[1] ?? fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Tiny data hook with loading/error state and an optimistic setter. */
export function useResource<T>(path: string | null, deps: unknown[] = []) {
  const [state, setState] = useState<ResourceState<T>>({ data: null, loading: Boolean(path), error: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api<T>(path);
      if (mounted.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (mounted.current)
        setState({ data: null, loading: false, error: error instanceof Error ? error.message : "Request failed" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  const setData = useCallback((updater: T | null | ((prev: T | null) => T | null)) => {
    setState((s) => ({
      ...s,
      data: typeof updater === "function" ? (updater as (prev: T | null) => T | null)(s.data) : updater,
    }));
  }, []);

  return { ...state, refetch: load, setData };
}

/** Optimistic helper: apply a patch, run the request, roll back on failure. */
export async function optimistic<T>(
  apply: () => void,
  request: () => Promise<T>,
  rollback: () => void,
  onError?: (message: string) => void,
): Promise<T | null> {
  apply();
  try {
    return await request();
  } catch (error) {
    rollback();
    onError?.(error instanceof Error ? error.message : "Request failed");
    return null;
  }
}

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function timeAgo(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function hashShort(hash: string) {
  return hash === "genesis" ? "genesis" : `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

export function useNativeBridge() {
  const [state, setState] = useState<{ detected: boolean; version: string | null }>({ detected: false, version: null });
  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.HereticNative : undefined;
    setState({ detected: Boolean(bridge), version: bridge?.coreVersion ? bridge.coreVersion() : null });
  }, []);
  return state;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", handler);
    return () => list.removeEventListener("change", handler);
  }, [query]);
  return matches;
}
