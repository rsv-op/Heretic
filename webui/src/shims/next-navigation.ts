// Hash-based routing for the single-file app: "#/dashboard/chat" <-> "/dashboard/chat".
import { useSyncExternalStore } from "react";

export function currentPath(): string {
  const path = window.location.hash.replace(/^#/, "");
  return path.startsWith("/") ? path : "/";
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function navigate(path: string) {
  if (currentPath() === path) return;
  window.location.hash = path;
}

export function usePathname() {
  return useSyncExternalStore(subscribe, currentPath, () => "/");
}

export function useRouter() {
  return {
    push: navigate,
    replace: navigate,
    refresh() {},
    back() {
      window.history.back();
    },
    prefetch() {},
  };
}

export function redirect(path: string): never {
  navigate(path);
  throw new Error(`redirect:${path}`);
}

export function notFound(): never {
  throw new Error("not-found");
}
