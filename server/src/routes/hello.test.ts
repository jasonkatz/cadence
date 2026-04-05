import { describe, it, expect } from "bun:test";
import express from "express";
import helloRoutes from "./hello";

function createApp() {
  const app = express();
  app.use(helloRoutes);
  return app;
}

describe("GET /hello", () => {
  it("should return 200 with hello world message", async () => {
    const app = createApp();
    const server = app.listen(0);
    const { port } = server.address() as { port: number };

    try {
      const res = await fetch(`http://localhost:${port}/hello`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ message: "hello world" });
    } finally {
      server.close();
    }
  });
});
