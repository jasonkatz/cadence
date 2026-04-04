import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { UserSettings } from "../dao/settings-dao";

const mockFindByUserId = mock<(userId: string) => Promise<UserSettings | null>>(
  () => Promise.resolve(null)
);
const mockUpsert = mock<
  (
    userId: string,
    data: { encrypted: string; iv: string; tag: string }
  ) => Promise<UserSettings>
>(() =>
  Promise.resolve({
    id: "settings-1",
    user_id: "user-1",
    github_token_encrypted: null,
    github_token_iv: null,
    github_token_tag: null,
    created_at: new Date(),
    updated_at: new Date(),
  })
);

mock.module("../dao/settings-dao", () => ({
  settingsDao: {
    findByUserId: mockFindByUserId,
    upsert: mockUpsert,
  },
}));

const { settingsService } = await import("./settings-service");

describe("settingsService", () => {
  beforeEach(() => {
    mockFindByUserId.mockReset();
    mockUpsert.mockReset();
  });

  describe("get", () => {
    it("should return null github_token when no settings exist", async () => {
      mockFindByUserId.mockResolvedValue(null);
      const result = await settingsService.get("user-1");
      expect(result).toEqual({ github_token: null });
    });

    it("should return null github_token when token fields are null", async () => {
      mockFindByUserId.mockResolvedValue({
        id: "s1",
        user_id: "user-1",
        github_token_encrypted: null,
        github_token_iv: null,
        github_token_tag: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const result = await settingsService.get("user-1");
      expect(result).toEqual({ github_token: null });
    });

    it("should return masked token when settings exist", async () => {
      // We need real encrypted data, so use the encryption module
      const { encrypt } = await import("../utils/encryption");
      const { encrypted, iv, tag } = encrypt("ghp_testtoken1234");

      mockFindByUserId.mockResolvedValue({
        id: "s1",
        user_id: "user-1",
        github_token_encrypted: encrypted,
        github_token_iv: iv,
        github_token_tag: tag,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await settingsService.get("user-1");
      expect(result.github_token).not.toBeNull();
      expect(result.github_token).toContain("****");
      expect(result.github_token).not.toBe("ghp_testtoken1234");
    });
  });

  describe("update", () => {
    it("should call upsert with encrypted data and return masked token", async () => {
      mockUpsert.mockResolvedValue({
        id: "s1",
        user_id: "user-1",
        github_token_encrypted: "enc",
        github_token_iv: "iv",
        github_token_tag: "tag",
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await settingsService.update("user-1", "ghp_mytoken5678");

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const [userId, data] = mockUpsert.mock.calls[0];
      expect(userId).toBe("user-1");
      expect(data.encrypted).toBeDefined();
      expect(data.iv).toBeDefined();
      expect(data.tag).toBeDefined();

      expect(result.github_token).toContain("****");
    });
  });

  describe("hasGithubToken", () => {
    it("should return false when no settings exist", async () => {
      mockFindByUserId.mockResolvedValue(null);
      const result = await settingsService.hasGithubToken("user-1");
      expect(result).toBe(false);
    });

    it("should return false when token fields are null", async () => {
      mockFindByUserId.mockResolvedValue({
        id: "s1",
        user_id: "user-1",
        github_token_encrypted: null,
        github_token_iv: null,
        github_token_tag: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const result = await settingsService.hasGithubToken("user-1");
      expect(result).toBe(false);
    });

    it("should return true when token is set", async () => {
      mockFindByUserId.mockResolvedValue({
        id: "s1",
        user_id: "user-1",
        github_token_encrypted: "enc",
        github_token_iv: "iv",
        github_token_tag: "tag",
        created_at: new Date(),
        updated_at: new Date(),
      });
      const result = await settingsService.hasGithubToken("user-1");
      expect(result).toBe(true);
    });
  });
});
