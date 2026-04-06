import { describe, it, expect } from "bun:test";
import type { Request, Response } from "express";
import helloRoutes from "./hello";

describe("GET /hello", () => {
  it("returns 200 with greeting message", () => {
    let body: unknown;
    const req = {} as Request;
    const res = {
      json(data: unknown) {
        body = data;
        return res;
      },
    } as unknown as Response;

    // Extract the GET /hello handler from the router stack
    const layer = helloRoutes.stack.find(
      (l: any) => l.route?.path === "/hello" && l.route?.methods?.get,
    );
    const handler = layer!.route!.stack[0].handle;

    handler(req, res, () => {});

    expect(body).toEqual({ message: "Hello, world!" });
  });
});
