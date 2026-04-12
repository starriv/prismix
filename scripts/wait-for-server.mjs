/**
 * Wait for the API server to be reachable before starting Vite.
 *
 * Reads PORT from .env.local (same file tsx --env-file loads),
 * falls back to .env.example. Throws if PORT is not resolvable.
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

const port = process.env.PORT || readPortFromFile(".env.local") || readPortFromFile(".env.example");
if (!port) {
  console.error("ERROR: PORT not found in env, .env.local, or .env.example");
  process.exit(1);
}

execSync(`wait-on tcp:${port}`, { stdio: "inherit" });
