import { describe, it, expect, mock } from "bun:test";
import versionRouter from "./version";

function makeFakeRes() {
  let statusCode = 200;
  let body: unknown = null;

  return {
    get statusCode() { return statusCode; },
    get body() { return body; },
    status(code: number) { statusCode = code; return this; },
    json(data: unknown) { body = data; return this; },
  };
}

describe("GET /v1/version", () => {
  it("returns version 0.4.0", () => {
    // Extract the route handler from the router
    const layer = versionRouter.stack.find(
      (l: { route?: { path: string; methods: { get?: boolean } } }) =>
        l.route?.path === "/" && l.route?.methods?.get
    );
    const handler = layer!.route!.stack[0].handle;

    const req = {} as unknown as Parameters<typeof handler>[0];
    const res = makeFakeRes();

    handler(req, res, mock(() => {}));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ version: "0.4.0" });
  });
});
