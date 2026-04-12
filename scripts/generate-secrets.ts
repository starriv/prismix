/**
 * Batch generate all crypto secrets for .env files.
 *
 * Usage:
 *   pnpm generate-secrets            # print to stdout
 *   pnpm generate-secrets -- --write # write to .env.local (creates or updates)
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

const secrets = {
  JWT_SECRET: crypto.randomBytes(32).toString("hex"),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
  ENCRYPTION_SALT: crypto.randomBytes(16).toString("hex"),
};

const shouldWrite = process.argv.includes("--write");

if (shouldWrite) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  let content = "";

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
  }

  let updated = false;
  for (const [key, value] of Object.entries(secrets)) {
    // Match: KEY= (empty), KEY=value, or # KEY= (commented)
    const regex = new RegExp(`^(#\\s*)?${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
      updated = true;
    } else {
      content += `\n${key}=${value}`;
      updated = true;
    }
  }

  if (updated) {
    fs.writeFileSync(envPath, content);
    console.log(`Updated ${envPath}`);
  }

  for (const [key, value] of Object.entries(secrets)) {
    console.log(`  ${key}=${value}`);
  }
} else {
  console.log("# Generated secrets — paste into your .env.local\n");
  for (const [key, value] of Object.entries(secrets)) {
    console.log(`${key}=${value}`);
  }
  console.log("\n# Or run: pnpm generate-secrets -- --write");
}
