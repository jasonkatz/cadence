import { describe, it, expect } from "bun:test";
import { encrypt, decrypt, maskToken } from "./encryption";

describe("encryption", () => {
  it("should encrypt and decrypt a string", () => {
    const plaintext = "ghp_abc123xyz";
    const { encrypted, iv, tag } = encrypt(plaintext);
    const result = decrypt(encrypted, iv, tag);
    expect(result).toBe(plaintext);
  });

  it("should produce different ciphertext for the same input", () => {
    const plaintext = "ghp_abc123xyz";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a.encrypted).not.toBe(b.encrypted);
    expect(a.iv).not.toBe(b.iv);
  });

  it("should fail to decrypt with wrong tag", () => {
    const { encrypted, iv } = encrypt("secret");
    const badTag = "00".repeat(16);
    expect(() => decrypt(encrypted, iv, badTag)).toThrow();
  });

  it("should fail to decrypt with wrong iv", () => {
    const { encrypted, tag } = encrypt("secret");
    const badIv = "00".repeat(16);
    expect(() => decrypt(encrypted, badIv, tag)).toThrow();
  });
});

describe("maskToken", () => {
  it("should mask a typical GitHub token", () => {
    expect(maskToken("ghp_abc123xyz456")).toBe("ghp_****z456");
  });

  it("should mask a short token", () => {
    expect(maskToken("abcdefgh")).toBe("****");
  });

  it("should mask a very short token", () => {
    expect(maskToken("abc")).toBe("****");
  });

  it("should show first 4 and last 4 for longer tokens", () => {
    const result = maskToken("ghp_abcdefghijk");
    expect(result.startsWith("ghp_")).toBe(true);
    expect(result.endsWith("hijk")).toBe(true);
    expect(result).toContain("****");
  });
});
