import { describe, it, expect } from "bun:test";
import express from "express";
import pingRoutes from "./ping";

function createApp() {
  const app = express();
  app.use(pingRoutes);
  return app;
}

describe("GET /v1/ping", () => {
  it("should return 200 with { pong: true }", async () => {
    const app = createApp();

    const res = await new Promise<{ status: number; body: unknown }>((resolve) => {
      const server = app.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        fetch(`http://localhost:${port}/v1/ping`)
          .then(async (r) => {
            const body = await r.json();
            resolve({ status: r.status, body });
          })
          .finally(() => server.close());
      });
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });
});
