import { settingsDao } from "../dao/settings-dao";
import { encrypt, decrypt, maskToken } from "../utils/encryption";

export interface SettingsResponse {
  github_token: string | null;
}

export const settingsService = {
  async get(userId: string): Promise<SettingsResponse> {
    const settings = await settingsDao.findByUserId(userId);

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
    await settingsDao.upsert(userId, { encrypted, iv, tag });
    return { github_token: maskToken(githubToken) };
  },

  async hasGithubToken(userId: string): Promise<boolean> {
    const settings = await settingsDao.findByUserId(userId);
    return !!(
      settings?.github_token_encrypted &&
      settings?.github_token_iv &&
      settings?.github_token_tag
    );
  },
};
