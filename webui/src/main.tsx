// Entry point. Loads the shims first, then boots the backend (PGlite + demo seed)
// and renders the same pages the Next.js app serves.
import "./shims/polyfills";
import "./app/globals.css";
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { installApiRouter } from "./offline/router";
import { navigate, usePathname } from "./shims/next-navigation";
import { ensureDemoSeed } from "@/lib/seed";
import LandingPage from "./app/page";
import { LoginView } from "./app/login/LoginView";
import { RegisterView } from "./app/register/RegisterView";
import { Shell } from "./components/Shell";
import OverviewPage from "./app/dashboard/page";
import AndroidPage from "./app/dashboard/android/page";
import ChatPage from "./app/dashboard/chat/page";
import DecisionsPage from "./app/dashboard/decisions/page";
import ErrorsPage from "./app/dashboard/errors/page";
import FilesPage from "./app/dashboard/files/page";
import GatesPage from "./app/dashboard/gates/page";
import ReposPage from "./app/dashboard/repos/page";
import SettingsPage from "./app/dashboard/settings/page";
import type { PublicUser } from "@/lib/auth";

installApiRouter();

try {
  await ensureDemoSeed();
} catch (error) {
  console.error("[heretic] demo seed failed", error);
}

const dashboardPages: Record<string, () => ReactNode> = {
  "/dashboard": () => <OverviewPage />,
  "/dashboard/android": () => <AndroidPage />,
  "/dashboard/chat": () => <ChatPage />,
  "/dashboard/decisions": () => <DecisionsPage />,
  "/dashboard/errors": () => <ErrorsPage />,
  "/dashboard/files": () => <FilesPage />,
  "/dashboard/gates": () => <GatesPage />,
  "/dashboard/repos": () => <ReposPage />,
  "/dashboard/settings": () => <SettingsPage />,
};

/** Dashboard routes require a session; anonymous visitors go to /login. */
function DashboardGate({ path }: { path: string }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { user?: PublicUser } | null) => {
        if (!alive) return;
        if (data?.user) {
          setUser(data.user);
        } else {
          navigate("/login");
        }
        setChecked(true);
      })
      .catch(() => alive && navigate("/login"));
    return () => {
      alive = false;
    };
  }, []);

  if (!checked || !user) {
    return <div className="grid min-h-screen place-items-center font-mono text-sm text-ash">Loading command center…</div>;
  }
  const render = dashboardPages[path] ?? (() => <div className="p-8 text-ash">Page not found.</div>);
  return <Shell user={user}>{render()}</Shell>;
}

function App() {
  const path = usePathname();
  if (path.startsWith("/dashboard")) return <DashboardGate path={path.replace(/\/$/, "") || "/dashboard"} />;
  if (path === "/login") return <LoginView />;
  if (path === "/register") return <RegisterView />;
  return <LandingPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
