// Serves the backend's /api/* route handlers inside the page.
//
// Every file under src/app/api/**/route.ts is the same handler the Next.js server
// runs. Here they are imported directly and invoked for each request that the
// client sends to /api/..., so the UI code does not change.

type Params = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Params) => Response | Promise<Response>;
type RouteModule = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Handler>>;

const modules = import.meta.glob("../app/api/**/route.ts", { eager: true }) as Record<string, RouteModule>;

interface CompiledRoute {
  pattern: RegExp;
  names: string[];
  dynamicCount: number;
  mod: RouteModule;
}

const routes: CompiledRoute[] = Object.entries(modules)
  .map(([file, mod]) => {
    const relative = file.replace("../app", "").replace(/\/route\.ts$/, "");
    const names: string[] = [];
    const segments = relative.split("/").filter(Boolean);
    const source = segments
      .map((segment) => {
        const match = segment.match(/^\[(.+)\]$/);
        if (match) {
          names.push(match[1]);
          return "([^/]+)";
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return {
      pattern: new RegExp(`^/${source}/?$`),
      names,
      dynamicCount: names.length,
      mod,
    };
  })
  // Static segments win over dynamic ones: /gates/reset before /gates/[id].
  .sort((a, b) => a.dynamicCount - b.dynamicCount);

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export async function dispatch(method: string, path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, "http://heretic.local");
  const verb = method.toUpperCase() as keyof RouteModule;

  for (const route of routes) {
    const match = url.pathname.match(route.pattern);
    if (!match) continue;

    const handler = route.mod[verb];
    if (!handler) {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: JSON_HEADERS });
    }

    const params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
    const req = new Request(url.toString(), { ...init, method: verb });
    try {
      return await handler(req, { params: Promise.resolve(params) });
    } catch (error) {
      console.error("[heretic] route failed", verb, url.pathname, error);
      return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: JSON_HEADERS });
    }
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: JSON_HEADERS });
}

/** Replaces window.fetch for /api/* so the existing client code works unchanged. */
export function installApiRouter() {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (raw.startsWith("/api/")) {
      const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
      return dispatch(method, raw, init ?? {});
    }
    return realFetch(input, init);
  };
}
