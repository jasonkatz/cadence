import { describe, it, expect, mock } from "bun:test";
import router from "./uptime";

describe("GET /uptime", () => {
  it("returns uptime_secs as a number", () => {
    const layer = router.stack.find(
      (l: any) => l.route?.path === "/uptime" && l.route?.methods?.get,
    );
    const handler = layer!.route!.stack[0].handle;

    const json = mock(() => {});
    const res = { json } as any;

    handler({} as any, res, () => {});

    expect(json).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0][0];
    expect(body).toHaveProperty("uptime_secs");
    expect(typeof body.uptime_secs).toBe("number");
    expect(body.uptime_secs).toBeGreaterThan(0);
  });
});
