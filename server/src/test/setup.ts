// Bun automatically loads .env files, but we set test-specific values here
process.env.DATABASE_URL =
  "postgres://postgres:postgres@localhost:5432/template_test";
process.env.NODE_ENV = "test";

export {};
