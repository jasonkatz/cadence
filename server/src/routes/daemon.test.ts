import { describe, it, expect, mock } from "bun:test";
import express from "express";
import { createDaemonRoutes, type DaemonRouteDeps } from "./daemon";

function makeApp(deps: DaemonRouteDeps) {
  const app = express();
  app.use(express.json());
  app.use("/v1", createDaemonRoutes(deps));
  return app;
}

function makeDeps(): DaemonRouteDeps {
  return {
    getState: mock(() => ({
      pid: 12345,
      uptime: 3600,
      socketPath: "/tmp/test.sock",
      tcpPort: null,
      activeWorkflows: 2,
    })),
    enableTcp: mock((_port: number) => ({ success: true })),
    shutdown: mock(() => {}),
  };
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0);
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  try {
    const url = `http://127.0.0.1:${port}${path}`;
    const opts: RequestInit = { method };
    if (body) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const json = await res.json();
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

describe("daemon routes", () => {
  it("GET /v1/daemon/status returns daemon state", async () => {
    const deps = makeDeps();
    const app = makeApp(deps);

    const res = await request(app, "GET", "/v1/daemon/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pid: 12345,
      uptime: 3600,
      socketPath: "/tmp/test.sock",
      tcpPort: null,
      activeWorkflows: 2,
    });
  });

  it("POST /v1/daemon/stop returns ok and calls shutdown", async () => {
    const deps = makeDeps();
    const app = makeApp(deps);

    const res = await request(app, "POST", "/v1/daemon/stop");
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    // shutdown is called via setImmediate, give it a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(deps.shutdown).toHaveBeenCalled();
  });

  it("POST /v1/daemon/enable-tcp activates TCP listener", async () => {
    const deps = makeDeps();
    const app = makeApp(deps);

    const res = await request(app, "POST", "/v1/daemon/enable-tcp", { port: 7070 });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect((res.body as Record<string, unknown>).port).toBe(7070);
    expect(deps.enableTcp).toHaveBeenCalledWith(7070);
  });

  it("POST /v1/daemon/enable-tcp rejects invalid port", async () => {
    const deps = makeDeps();
    const app = makeApp(deps);

    const res = await request(app, "POST", "/v1/daemon/enable-tcp", {
      port: "not-a-number",
    });
    expect(res.status).toBe(400);
  });

  it("POST /v1/daemon/enable-tcp returns 409 on conflict", async () => {
    const deps = makeDeps();
    deps.enableTcp = mock(() => ({
      success: false,
      error: "TCP already active on port 8080",
    }));
    const app = makeApp(deps);

    const res = await request(app, "POST", "/v1/daemon/enable-tcp", { port: 7070 });
    expect(res.status).toBe(409);
  });
});
