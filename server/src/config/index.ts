import { z } from "zod";

const isE2E = process.env.E2E === "true";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  AUTH0_AUDIENCE: isE2E ? z.string().default("test") : z.string(),
  AUTH0_ISSUER_BASE_URL: isE2E ? z.string().default("http://localhost") : z.string(),
  PORT: z.string().default("8080"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  E2E: z.string().optional(),
  ENCRYPTION_KEY: z
    .string()
    .default("dev-encryption-key-32-bytes-long!"),
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
