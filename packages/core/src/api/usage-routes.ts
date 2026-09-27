import type { Hono } from "hono";

import type { UsageService } from "../usage/service.ts";

/** Días pedidos por `?days=`, acotados para no recorrer años de historial por error. */
function days(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 365) : fallback;
}

export function registerUsageRoutes(app: Hono, usage: UsageService): void {
  app.get("/v1/usage/summary", (c) => c.json(usage.summary()));
  app.get("/v1/usage/daily", (c) => c.json({ days: usage.daily(days(c.req.query("days"), 30)) }));
  app.get("/v1/usage/projects", (c) =>
    c.json({ projects: usage.projects(days(c.req.query("days"), 30)) }),
  );
  app.get("/v1/usage/windows", (c) =>
    c.json({ windows: usage.recentWindows(days(c.req.query("days"), 7)) }),
  );
  app.post("/v1/usage/limit-hit", (c) => c.json(usage.recordManualLimit(), 201));
}
