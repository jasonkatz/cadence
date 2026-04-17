import cors from "cors";
import { config } from "../config";

function getAllowedOrigins(): string[] {
  // "null" is the Origin string browsers send for file:// pages, which is
  // how the CLI-embedded web UI reaches the daemon's TCP listener.
  const base = ["null"];

  if (config.ALLOWED_ORIGINS) {
    return [...base, ...config.ALLOWED_ORIGINS.split(",").map((o) => o.trim())];
  }

  if (config.NODE_ENV === "development") {
    return [...base, "http://localhost:5173", "http://localhost:3000"];
  }

  // In production with no ALLOWED_ORIGINS set, only same-origin requests
  // are expected (via nginx reverse proxy). Return just the file:// base so
  // requests without an Origin header (same-origin) are still allowed and
  // the embedded web UI works, but other cross-origin requests are rejected.
  return base;
}

const allowedOrigins = getAllowedOrigins();

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
});
