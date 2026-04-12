/**
 * Wait for the API server to be reachable before starting Vite.
 *
 * Reads PORT from .env.local (same file tsx --env-file loads),
 * falls back to .env.example, then to 3403.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

function readPortFromFile(path) {
  try {
    const match = readFileSync(path, "utf8").match(/^PORT=(\d+)/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

const port = process.env.PORT || readPortFromFile(".env.local") || readPortFromFile(".env.example") || "3403";

execSync(`wait-on tcp:${port}`, { stdio: "inherit" });
