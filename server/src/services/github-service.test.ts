import { describe, it, expect, mock } from "bun:test";
import { createGithubService, type GithubServiceDeps } from "./github-service";

function makeDeps() {
  let callCount = 0;
  const mockFetch = mock<(url: string, opts: RequestInit) => Promise<Response>>(
    () => {
      callCount++;
      if (callCount % 2 === 1) {
        // First call: get repo info
        return Promise.resolve(
          new Response(JSON.stringify({ default_branch: "main" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      // Second call: create PR
      return Promise.resolve(
        new Response(JSON.stringify({ number: 42, html_url: "https://github.com/acme/webapp/pull/42" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  );

  const deps: GithubServiceDeps = {
    fetch: mockFetch as unknown as typeof fetch,
  };

  return { deps, mocks: { fetch: mockFetch } };
}

describe("githubService", () => {
  describe("createPullRequest", () => {
    it("should call GitHub API with correct parameters", async () => {
      const { deps, mocks } = makeDeps();
      const service = createGithubService(deps);

      await service.createPullRequest({
        token: "ghp_test123",
        repo: "acme/webapp",
        head: "cadence/abc123",
        title: "Add login page",
        body: "## Summary\nImplement login page.",
      });

      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      const [url, opts] = mocks.fetch.mock.calls[1];
      expect(url).toBe("https://api.github.com/repos/acme/webapp/pulls");
      expect(opts.method).toBe("POST");

      const headers = opts.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer ghp_test123");

      const body = JSON.parse(opts.body as string);
      expect(body.head).toBe("cadence/abc123");
      expect(body.title).toBe("Add login page");
      expect(body.body).toBe("## Summary\nImplement login page.");
    });

    it("should return the PR number and URL", async () => {
      const { deps } = makeDeps();
      const service = createGithubService(deps);

      const result = await service.createPullRequest({
        token: "ghp_test123",
        repo: "acme/webapp",
        head: "cadence/abc123",
        title: "Add login page",
        body: "body text",
      });

      expect(result.number).toBe(42);
      expect(result.url).toBe("https://github.com/acme/webapp/pull/42");
    });

    it("should throw on non-2xx response", async () => {
      const { deps, mocks } = makeDeps();
      let callIdx = 0;
      mocks.fetch.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ default_branch: "main" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ message: "Validation Failed" }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          })
        );
      });
      const service = createGithubService(deps);

      await expect(
        service.createPullRequest({
          token: "ghp_test123",
          repo: "acme/webapp",
          head: "cadence/abc123",
          title: "test",
          body: "body",
        })
      ).rejects.toThrow();
    });

    it("should derive title from task (first 72 chars)", async () => {
      const { deps, mocks } = makeDeps();
      const service = createGithubService(deps);

      const longTask =
        "Implement a comprehensive authentication system with OAuth2 support, multi-factor authentication, and session management";

      await service.createPullRequest({
        token: "ghp_test123",
        repo: "acme/webapp",
        head: "cadence/abc123",
        title: longTask.substring(0, 72),
        body: "body",
      });

      const body = JSON.parse(mocks.fetch.mock.calls[1][1].body as string);
      expect(body.title.length).toBeLessThanOrEqual(72);
    });

    it("should fetch default branch from GitHub API", async () => {
      const { deps, mocks } = makeDeps();

      // First call: get repo info (for default branch)
      // Second call: create PR
      let callCount = 0;
      mocks.fetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ default_branch: "develop" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ number: 10, html_url: "https://github.com/acme/webapp/pull/10" }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          )
        );
      });

      const service = createGithubService(deps);

      const result = await service.createPullRequest({
        token: "ghp_test123",
        repo: "acme/webapp",
        head: "cadence/abc123",
        title: "test",
        body: "body",
      });

      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      // First call gets default branch
      expect(mocks.fetch.mock.calls[0][0]).toBe(
        "https://api.github.com/repos/acme/webapp"
      );
      // Second call creates PR with base = "develop"
      const prBody = JSON.parse(mocks.fetch.mock.calls[1][1].body as string);
      expect(prBody.base).toBe("develop");
      expect(result.number).toBe(10);
    });
  });
});
