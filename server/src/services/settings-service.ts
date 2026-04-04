import { settingsDao as defaultSettingsDao } from "../dao/settings-dao";
import { encrypt, decrypt, maskToken } from "../utils/encryption";

export interface SettingsResponse {
  github_token: string | null;
}

export interface SettingsServiceDeps {
  settingsDao: Pick<typeof defaultSettingsDao, "findByUserId" | "upsert">;
}

const defaultDeps: SettingsServiceDeps = { settingsDao: defaultSettingsDao };

export function createSettingsService(deps: SettingsServiceDeps = defaultDeps) {
  return {
    async get(userId: string): Promise<SettingsResponse> {
      const settings = await deps.settingsDao.findByUserId(userId);

      if (
        !settings ||
        !settings.github_token_encrypted ||
        !settings.github_token_iv ||
        !settings.github_token_tag
      ) {
        return { github_token: null };
      }

      const raw = decrypt(
        settings.github_token_encrypted,
        settings.github_token_iv,
        settings.github_token_tag
      );

      return { github_token: maskToken(raw) };
    },

    async update(
      userId: string,
      githubToken: string
    ): Promise<SettingsResponse> {
      const { encrypted, iv, tag } = encrypt(githubToken);
      await deps.settingsDao.upsert(userId, { encrypted, iv, tag });
      return { github_token: maskToken(githubToken) };
    },

    async getDecryptedToken(userId: string): Promise<string> {
      const settings = await deps.settingsDao.findByUserId(userId);

      if (
        !settings ||
        !settings.github_token_encrypted ||
        !settings.github_token_iv ||
        !settings.github_token_tag
      ) {
        throw new Error("GitHub token not configured");
      }

      return decrypt(
        settings.github_token_encrypted,
        settings.github_token_iv,
        settings.github_token_tag
      );
    },

    async hasGithubToken(userId: string): Promise<boolean> {
      const settings = await deps.settingsDao.findByUserId(userId);
      return !!(
        settings?.github_token_encrypted &&
        settings?.github_token_iv &&
        settings?.github_token_tag
      );
    },
  };
}

export const settingsService = createSettingsService();
