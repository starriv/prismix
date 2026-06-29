#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";
import type { ConsoleMessage, Request, Response } from "@playwright/test";

type Role = "admin" | "none" | "user";

interface AuthSummary {
  principal?: unknown;
  role: Role;
  tokenFingerprint?: string;
}

interface VerifyOptions {
  expectText: string[];
  headed: boolean;
  identity: string[];
  origin: string;
  output?: string;
  role: Role;
  screenshotDir: string;
  targetUrl: string;
  viewports: Viewport[];
  waitMs: number;
}

interface Viewport {
  height: number;
  label: string;
  width: number;
}

interface VerifyResult {
  apiResponses: Array<{ status: number; url: string }>;
  consoleEntries: Array<{
    level: string;
    location: ReturnType<ConsoleMessage["location"]>;
    text: string;
  }>;
  expectedTextMissing: string[];
  failedRequests: Array<{ failure: string | null; method: string; url: string }>;
  finalUrl: string;
  heading: string | null;
  mainStatus: number | null;
  screenshot: string;
  title: string;
  viewport: Viewport;
  visibleText: string[];
}

function args(): string[] {
  return process.argv.slice(2);
}

function hasFlag(name: string): boolean {
  return args().includes(name);
}

function values(name: string): string[] {
  const result: string[] = [];
  const eqPrefix = `${name}=`;
  const allArgs = args();
  for (let i = 0; i < allArgs.length; i += 1) {
    const arg = allArgs[i];
    if (arg.startsWith(eqPrefix)) {
      result.push(arg.slice(eqPrefix.length));
      continue;
    }
    if (arg === name) {
      const next = allArgs[i + 1];
      if (next && !next.startsWith("--")) {
        result.push(next);
        i += 1;
      }
    }
  }
  return result;
}

function option(name: string): string | undefined {
  return values(name)[0];
}

function printHelp(): void {
  console.log(`Usage:
  pnpm verify:web -- --url http://localhost:5189/zh/admin/ai-credentials
  pnpm verify:web -- --url http://localhost:5189/zh/admin/ai-credentials --expect-text "AI 凭证"
  pnpm verify:web -- --url http://localhost:5189/zh/ --role none

Options:
  --url <url>              Required local URL to verify.
  --role admin|user|none   Auth role. Defaults to admin.
  --id <id>                Principal id for auth token generation.
  --address <address>      Wallet address for auth token generation.
  --email <email>          Email for auth token generation.
  --include-disabled       Allow disabled users when role=user.
  --origin <url>           Storage-state origin. Defaults to target URL origin.
  --viewport <WxH>         Viewport to verify. Repeatable. Defaults to 1440x1000.
  --mobile                 Also verify 390x844.
  --expect-text <text>     Text that must be visible. Repeatable.
  --screenshot-dir <path>  Screenshot directory. Defaults to /tmp/prismix-web-verify.
  --output <path>          Write JSON report to a file instead of stdout only.
  --headed                 Run Chromium headed.
  --wait-ms <n>            Extra wait after network idle. Defaults to 1000.
`);
}

function parseRole(): Role {
  const raw = option("--role") ?? "admin";
  if (raw === "admin" || raw === "user" || raw === "none") return raw;
  throw new Error("--role must be admin, user, or none");
}

function parseViewport(raw: string): Viewport {
  const match = /^(\d+)x(\d+)$/i.exec(raw.trim());
  if (!match) throw new Error(`Invalid viewport "${raw}". Use WIDTHxHEIGHT, e.g. 1440x1000.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid viewport "${raw}". Width and height must be positive integers.`);
  }
  return { width, height, label: `${width}x${height}` };
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = option(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptions(): VerifyOptions {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    process.exit(0);
  }

  const targetUrl = option("--url");
  if (!targetUrl) throw new Error("--url is required");

  const url = new URL(targetUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("--url must be an http(s) URL");
  }

  const viewports = values("--viewport").map(parseViewport);
  if (viewports.length === 0) viewports.push(parseViewport("1440x1000"));
  if (hasFlag("--mobile") && !viewports.some((v) => v.label === "390x844")) {
    viewports.push(parseViewport("390x844"));
  }

  const identity: string[] = [];
  for (const key of ["--id", "--address", "--email"]) {
    const value = option(key);
    if (value) identity.push(key, value);
  }
  if (hasFlag("--include-disabled")) identity.push("--include-disabled");

  return {
    expectText: values("--expect-text"),
    headed: hasFlag("--headed"),
    identity,
    origin: option("--origin") ?? url.origin,
    output: option("--output"),
    role: parseRole(),
    screenshotDir: option("--screenshot-dir") ?? path.join(os.tmpdir(), "prismix-web-verify"),
    targetUrl,
    viewports,
    waitMs: parsePositiveInt("--wait-ms", 1000),
  };
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "page";
}

function isApiUrl(raw: string): boolean {
  try {
    return new URL(raw).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function generateStorageState(options: VerifyOptions): {
  auth: AuthSummary;
  cleanupPath: string | null;
  storageStatePath?: string;
} {
  if (options.role === "none") return { auth: { role: "none" }, cleanupPath: null };

  const storageStatePath = path.join(
    os.tmpdir(),
    `prismix-${options.role}-state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const output = execFileSync(
    "pnpm",
    [
      "--silent",
      "dev:auth-token",
      "--",
      "--role",
      options.role,
      "--origin",
      options.origin,
      "--storage-state",
      storageStatePath,
      ...options.identity,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const parsed = JSON.parse(output) as {
    principal?: unknown;
    role: Role;
    tokenFingerprint?: string;
  };
  return {
    auth: {
      role: parsed.role,
      principal: parsed.principal,
      tokenFingerprint: parsed.tokenFingerprint,
    },
    cleanupPath: storageStatePath,
    storageStatePath,
  };
}

async function verifyViewport(
  options: VerifyOptions,
  viewport: Viewport,
  storageStatePath?: string,
): Promise<VerifyResult> {
  const browser = await chromium.launch({ headless: !options.headed });
  const context = await browser.newContext({
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  const consoleEntries: VerifyResult["consoleEntries"] = [];
  const failedRequests: VerifyResult["failedRequests"] = [];
  const apiResponses: VerifyResult["apiResponses"] = [];

  page.on("console", (msg: ConsoleMessage) => {
    const level = msg.type();
    if (level === "error" || level === "warning") {
      consoleEntries.push({
        level,
        text: msg.text(),
        location: msg.location(),
      });
    }
  });
  page.on("requestfailed", (request: Request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? null,
    });
  });
  page.on("response", (response: Response) => {
    const responseUrl = response.url();
    if (isApiUrl(responseUrl)) {
      apiResponses.push({ url: responseUrl, status: response.status() });
    }
  });

  try {
    const mainResponse = await page.goto(options.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    if (options.waitMs > 0) await page.waitForTimeout(options.waitMs);

    const pageState = await page.evaluate((expectedText: string[]) => {
      const visibleText = document.body.innerText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 80);
      const heading =
        document.querySelector("h1")?.textContent?.trim() ??
        document.querySelector("h2")?.textContent?.trim() ??
        null;
      const bodyText = document.body.innerText;
      const expectedTextMissing = expectedText.filter((text) => !bodyText.includes(text));
      return { expectedTextMissing, heading, visibleText };
    }, options.expectText);

    fs.mkdirSync(options.screenshotDir, { recursive: true });
    const url = new URL(options.targetUrl);
    const screenshot = path.join(
      options.screenshotDir,
      `${sanitizeFilePart(url.pathname)}-${viewport.label}.png`,
    );
    await page.screenshot({ path: screenshot, fullPage: true });

    return {
      apiResponses,
      consoleEntries,
      expectedTextMissing: pageState.expectedTextMissing,
      failedRequests,
      finalUrl: page.url(),
      heading: pageState.heading,
      mainStatus: mainResponse?.status() ?? null,
      screenshot,
      title: await page.title(),
      viewport,
      visibleText: pageState.visibleText,
    };
  } finally {
    await browser.close();
  }
}

function summarizeOk(results: VerifyResult[]): boolean {
  return results.every((result) => {
    const badApi = result.apiResponses.some((response) => response.status >= 400);
    const consoleErrors = result.consoleEntries.some((entry) => entry.level === "error");
    const blockingRequestFailures = result.failedRequests.filter(
      (request) => !(request.method === "HEAD" && request.failure === "net::ERR_ABORTED"),
    );
    return (
      (result.mainStatus ?? 0) >= 200 &&
      (result.mainStatus ?? 500) < 400 &&
      result.expectedTextMissing.length === 0 &&
      blockingRequestFailures.length === 0 &&
      !badApi &&
      !consoleErrors
    );
  });
}

async function main(): Promise<void> {
  const options = parseOptions();
  const { auth, cleanupPath, storageStatePath } = generateStorageState(options);

  try {
    const results: VerifyResult[] = [];
    for (const viewport of options.viewports) {
      results.push(await verifyViewport(options, viewport, storageStatePath));
    }

    const report = {
      ok: summarizeOk(results),
      targetUrl: options.targetUrl,
      origin: options.origin,
      role: auth.role,
      principal: auth.principal,
      tokenFingerprint: auth.tokenFingerprint,
      viewports: results,
    };

    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      const dir = path.dirname(options.output);
      if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(options.output, json, { mode: 0o600 });
    }
    process.stdout.write(json);
    if (!report.ok) process.exitCode = 1;
  } finally {
    if (cleanupPath) fs.rmSync(cleanupPath, { force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
