import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { UserSettings } from "../dao/settings-dao";
import { encrypt } from "../utils/encryption";
import { createSettingsService, SettingsServiceDeps } from "./settings-service";

function makeDeps() {
  const mockFindByUserId = mock((_userId: string) =>
    Promise.resolve(null as UserSettings | null)
  );
  const mockUpsert = mock((_userId: string, _data: { encrypted: string; iv: string; tag: string }) =>
    Promise.resolve({
      id: "settings-1",
      user_id: "user-1",
      github_token_encrypted: null,
      github_token_iv: null,
      github_token_tag: null,
      created_at: new Date(),
      updated_at: new Date(),
    } as UserSettings)
  );

  const deps: SettingsServiceDeps = {
    settingsDao: { findByUserId: mockFindByUserId, upsert: mockUpsert },
  };

  return { deps, mocks: { findByUserId: mockFindByUserId, upsert: mockUpsert } };
}

describe("settingsService", () => {
  let service: ReturnType<typeof createSettingsService>;
  let mocks: ReturnType<typeof makeDeps>["mocks"];

  beforeEach(() => {
    const d = makeDeps();
    service = createSettingsService(d.deps);
    mocks = d.mocks;
  });

  describe("get", () => {
    it("should return null github_token when no settings exist", async () => {
      mocks.findByUserId.mockResolvedValue(null);
      const result = await service.get("user-1");
      expect(result).toEqual({ github_token: null });
    });

    it("should return null github_token when token fields are null", async () => {
      mocks.findByUserId.mockResolvedValue({
        id: "s1", user_id: "user-1",
        github_token_encrypted: null, github_token_iv: null, github_token_tag: null,
        created_at: new Date(), updated_at: new Date(),
      });
      const result = await service.get("user-1");
      expect(result).toEqual({ github_token: null });
    });

    it("should return masked token when settings exist", async () => {
      const { encrypted, iv, tag } = encrypt("ghp_testtoken1234");
      mocks.findByUserId.mockResolvedValue({
        id: "s1", user_id: "user-1",
        github_token_encrypted: encrypted, github_token_iv: iv, github_token_tag: tag,
        created_at: new Date(), updated_at: new Date(),
      });

      const result = await service.get("user-1");
      expect(result.github_token).not.toBeNull();
      expect(result.github_token).toContain("****");
      expect(result.github_token).not.toBe("ghp_testtoken1234");
    });
  });

  describe("update", () => {
    it("should call upsert with encrypted data and return masked token", async () => {
      mocks.upsert.mockResolvedValue({
        id: "s1", user_id: "user-1",
        github_token_encrypted: "enc", github_token_iv: "iv", github_token_tag: "tag",
        created_at: new Date(), updated_at: new Date(),
      });

      const result = await service.update("user-1", "ghp_mytoken5678");

      expect(mocks.upsert).toHaveBeenCalledTimes(1);
      const [userId, data] = mocks.upsert.mock.calls[0];
      expect(userId).toBe("user-1");
      expect(data.encrypted).toBeDefined();
      expect(data.iv).toBeDefined();
      expect(data.tag).toBeDefined();
      expect(result.github_token).toContain("****");
    });
  });

  describe("getDecryptedToken", () => {
    it("should return the raw decrypted token", async () => {
      const { encrypted, iv, tag } = encrypt("ghp_secrettoken99");
      mocks.findByUserId.mockResolvedValue({
        id: "s1", user_id: "user-1",
        github_token_encrypted: encrypted, github_token_iv: iv, github_token_tag: tag,
        created_at: new Date(), updated_at: new Date(),
      });

      const result = await service.getDecryptedToken("user-1");
      expect(result).toBe("ghp_secrettoken99");
    });

    it("should throw when no token is configured", async () => {
      mocks.findByUserId.mockResolvedValue(null);
      await expect(service.getDecryptedToken("user-1")).rejects.toThrow("GitHub token not configured");
    });
  });

  describe("hasGithubToken", () => {
    it("should return false when no settings exist", async () => {
      mocks.findByUserId.mockResolvedValue(null);
      expect(await service.hasGithubToken("user-1")).toBe(false);
    });

    it("should return false when token fields are null", async () => {
      mocks.findByUserId.mockResolvedValue({
        id: "s1", user_id: "user-1",
        github_token_encrypted: null, github_token_iv: null, github_token_tag: null,
        created_at: new Date(), updated_at: new Date(),
      });
      expect(await service.hasGithubToken("user-1")).toBe(false);
    });

    it("should return true when token is set", async () => {
      mocks.findByUserId.mockResolvedValue({
        id: "s1", user_id: "user-1",
        github_token_encrypted: "enc", github_token_iv: "iv", github_token_tag: "tag",
        created_at: new Date(), updated_at: new Date(),
      });
      expect(await service.hasGithubToken("user-1")).toBe(true);
    });
  });
});
