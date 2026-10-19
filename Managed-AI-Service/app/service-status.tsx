"use client";

import { useEffect, useState } from "react";

export function ServiceStatus() {
  const [state, setState] = useState<"checking" | "ready" | "unavailable">("checking");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Unavailable");
        const health = await response.json();
        setState(typeof health === "object" && health !== null && "status" in health && health.status === "ok" && "ai" in health && health.ai === true ? "ready" : "unavailable");
      })
      .catch(() => { if (!controller.signal.aborted) setState("unavailable"); });
    return () => controller.abort();
  }, []);
  return <div className="service-status" role="status" aria-live="polite">
    <span className={`status-dot ${state}`} aria-hidden="true" />
    <span>{state === "checking" ? "Checking service configuration…" : state === "ready" ? "Configured for app requests" : "AI is currently unavailable"}</span>
  </div>;
}
