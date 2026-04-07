import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  PORT: z.string().default("8080"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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
