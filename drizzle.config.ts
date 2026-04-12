import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local → .env (same as server/env.ts)
dotenv.config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schemas/pg.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      (() => {
        throw new Error("DATABASE_URL is not set — check .env.local");
      })(),
  },
});
