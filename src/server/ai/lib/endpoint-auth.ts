/**
 * Endpoint auth builder — constructs authentication headers/URL for AI endpoint requests.
 *
 * Supports four auth modes:
 * - bearer:  Authorization: Bearer <key>
 * - api-key: Custom header (default x-api-key) with the key value
 * - cloudflare: Cloudflare Access service-token headers
 * - gemini:  API key as ?key= query parameter (no Authorization header)
 * - sigv4:   AWS Signature Version 4 (for Bedrock)
 *
 * Anthropic format additionally injects anthropic-version header.
 */
import crypto from "crypto";

import { match } from "ts-pattern";

import type { AiEndpoint } from "@/server/db";
import { log } from "@/server/lib/logger";

import { type ConnectorAuthFields, resolveConnectorAuthConfig } from "./connector-runtime-config";

export interface EndpointAuthResult {
  headers: Record<string, string>;
  url: string;
}

export interface SigV4Config {
  region: string;
  service: string;
  accessKeyId: string;
}

export interface CloudflareAccessConfig {
  clientId: string;
}

/**
 * Build authentication headers and (possibly modified) URL for an AI endpoint request.
 *
 * @param endpoint - The AI endpoint configuration from `ai_supplier_connections` table
 * @param plainKey - The decrypted API key (or secret access key for SigV4)
 * @param url      - The upstream URL (may be modified for Gemini query-param auth)
 * @param body     - Request body (needed for SigV4 payload signing)
 */
export function buildEndpointAuth(
  endpoint: ConnectorAuthFields & Pick<AiEndpoint, "apiFormat">,
  plainKey: string,
  url: string,
  body?: string,
): EndpointAuthResult {
  const headers: Record<string, string> = {};
  let finalUrl = url;
  const auth = resolveConnectorAuthConfig(endpoint);

  // -- Auth type dispatch --
  match(auth.authType)
    .with("bearer", () => {
      headers.Authorization = `Bearer ${plainKey}`;
    })
    .with("api-key", () => {
      try {
        const authConfig = JSON.parse(auth.authConfig) as { headerName?: string };
        headers[authConfig.headerName || "x-api-key"] = plainKey;
      } catch {
        headers["x-api-key"] = plainKey;
      }
    })
    .with("cloudflare", () => {
      let config: CloudflareAccessConfig;
      try {
        config = JSON.parse(auth.authConfig) as CloudflareAccessConfig;
      } catch {
        log.gateway.warn(
          { authType: "cloudflare" },
          "Invalid Cloudflare Access authConfig — skipping headers",
        );
        return;
      }
      const clientId = typeof config.clientId === "string" ? config.clientId.trim() : "";
      if (!clientId) {
        log.gateway.warn(
          { authType: "cloudflare" },
          "Cloudflare Access authConfig missing clientId — skipping headers",
        );
        return;
      }
      headers["CF-Access-Client-Id"] = clientId;
      headers["CF-Access-Client-Secret"] = plainKey;
    })
    .with("sigv4", () => {
      let config: SigV4Config;
      try {
        config = JSON.parse(auth.authConfig) as SigV4Config;
      } catch {
        log.gateway.warn({ authType: "sigv4" }, "Invalid SigV4 authConfig — skipping signature");
        return;
      }
      const sigv4Headers = signSigV4({
        method: "POST",
        url,
        body: body ?? "",
        region: config.region,
        service: config.service,
        accessKeyId: config.accessKeyId,
        secretAccessKey: plainKey,
      });
      Object.assign(headers, sigv4Headers);
    })
    .otherwise(() => {
      // Unknown auth type — no auth headers
    });

  // -- Anthropic requires version header (Bedrock Claude models also need it) --
  if (endpoint.apiFormat === "anthropic" || endpoint.apiFormat === "bedrock") {
    headers["anthropic-version"] = "2023-06-01";
  }

  // -- Gemini uses query param instead of header --
  if (endpoint.apiFormat === "gemini" && auth.authType !== "cloudflare") {
    delete headers.Authorization;
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${sep}key=${plainKey}`;
  }

  return { headers, url: finalUrl };
}

// ── AWS Signature Version 4 ──────────────────────────────────────────

interface SigV4Params {
  method: string;
  url: string;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

/**
 * Compute AWS SigV4 headers for a request.
 * Returns: Authorization, X-Amz-Date, X-Amz-Content-Sha256 headers.
 */
export function signSigV4(params: SigV4Params): Record<string, string> {
  const { method, url: rawUrl, body, region, service, accessKeyId, secretAccessKey } = params;

  const parsedUrl = new URL(rawUrl);
  const host = parsedUrl.host;
  const path = parsedUrl.pathname;
  const queryString = parsedUrl.search.slice(1); // remove leading ?

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8); // YYYYMMDD
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); // YYYYMMDDTHHmmssZ

  const payloadHash = sha256(body);
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  // Step 1: Canonical request
  const canonicalHeaders = [
    `content-type:application/json`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n");

  const canonicalRequest = [
    method,
    path,
    queryString,
    canonicalHeaders,
    "", // empty line after headers
    signedHeaders,
    payloadHash,
  ].join("\n");

  // Step 2: String to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  // Step 3: Signing key
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");

  // Step 4: Signature
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  // Step 5: Authorization header
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    "X-Amz-Date": amzDate,
    "X-Amz-Content-Sha256": payloadHash,
  };
}
