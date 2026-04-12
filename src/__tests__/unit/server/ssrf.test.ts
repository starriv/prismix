import { describe, expect, it } from "vitest";

import { checkDnsRebinding } from "@/server/lib/ssrf";
import { isPrivateHost } from "@/shared/url";

describe("isPrivateHost", () => {
  // ── Should detect as private ────────────────────────────────────

  it("detects IPv4 loopback", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("127.0.0.2")).toBe(true);
    expect(isPrivateHost("127.255.255.255")).toBe(true);
  });

  it("detects 10.x.x.x private range", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("10.255.255.255")).toBe(true);
  });

  it("detects 172.16-31.x.x private range", () => {
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
  });

  it("detects 192.168.x.x private range", () => {
    expect(isPrivateHost("192.168.0.1")).toBe(true);
    expect(isPrivateHost("192.168.1.100")).toBe(true);
  });

  it("detects 169.254.x.x link-local", () => {
    expect(isPrivateHost("169.254.169.254")).toBe(true); // AWS metadata
  });

  it("detects localhost", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("LOCALHOST")).toBe(true);
  });

  it("detects IPv6 loopback", () => {
    expect(isPrivateHost("::1")).toBe(true);
  });

  it("detects 0.x.x.x unspecified", () => {
    expect(isPrivateHost("0.0.0.0")).toBe(true);
  });

  it("detects decimal IP notation (2130706433 = 127.0.0.1)", () => {
    expect(isPrivateHost("2130706433")).toBe(true); // 127.0.0.1
    expect(isPrivateHost("167772161")).toBe(true); // 10.0.0.1
    expect(isPrivateHost("3232235521")).toBe(true); // 192.168.0.1
    expect(isPrivateHost("2851995649")).toBe(true); // 169.254.169.1
  });

  it("allows decimal IP for public addresses", () => {
    expect(isPrivateHost("134744072")).toBe(false); // 8.8.8.8
  });

  it("detects IPv6-mapped IPv4 prefix", () => {
    expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateHost("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateHost("::ffff:192.168.1.1")).toBe(true);
  });

  // ── Should allow public ─────────────────────────────────────────

  it("allows public IPs", () => {
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("1.1.1.1")).toBe(false);
    expect(isPrivateHost("203.0.113.1")).toBe(false);
  });

  it("allows public hostnames", () => {
    expect(isPrivateHost("api.example.com")).toBe(false);
    expect(isPrivateHost("google.com")).toBe(false);
  });

  it("allows 172.32+ (outside private range)", () => {
    expect(isPrivateHost("172.32.0.1")).toBe(false);
  });
});

describe("checkDnsRebinding", () => {
  it("blocks IPv6 loopback", async () => {
    const result = await checkDnsRebinding("http://[::1]/test");
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });

  it("blocks IPv6-mapped private IPv4", async () => {
    const result = await checkDnsRebinding("http://[::ffff:127.0.0.1]/test");
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });

  it("allows dotted-quad public IP", async () => {
    const result = await checkDnsRebinding("http://8.8.8.8/test");
    expect(result).toBeNull();
  });
});
