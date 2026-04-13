import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const LOCALE_FILES = [
  path.join(ROOT, "src/i18n/locales/en.json"),
  path.join(ROOT, "src/i18n/locales/zh.json"),
];
const KEY_ATTRS = new Set(["i18nKey", "titleKey", "descKey", "labelKey", "stepPrefix"]);
const KEY_PROPS = new Set(["i18nKey", "titleKey", "descKey", "labelKey", "stepPrefix"]);

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

interface Pattern {
  parts: string[];
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "i18n") continue;
      walkFiles(fullPath, out);
      continue;
    }
    if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function flattenJson(input: JsonValue, prefix = "", out = new Set<string>()): Set<string> {
  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      const next = prefix ? `${prefix}.${index}` : String(index);
      flattenJson(item, next, out);
    });
    return out;
  }

  if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenJson(value, next, out);
    }
    return out;
  }

  if (prefix) out.add(prefix);
  return out;
}

function addPattern(patterns: Pattern[], parts: string[]) {
  if (parts.length === 0) return;
  if (parts.every((part) => part.length === 0)) return;
  patterns.push({ parts });
}

function addExact(exact: Set<string>, key: string) {
  const normalized = key.trim();
  if (!normalized) return;
  exact.add(normalized);
}

function getTemplateParts(
  node: ts.TemplateExpression | ts.NoSubstitutionTemplateLiteral,
): string[] {
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  const parts = [node.head.text];
  for (const span of node.templateSpans) {
    parts.push(span.literal.text);
  }
  return parts;
}

function collectFromExpression(
  node: ts.Expression | undefined,
  exact: Set<string>,
  patterns: Pattern[],
): void {
  if (!node) return;

  if (ts.isStringLiteralLike(node)) {
    addExact(exact, node.text);
    return;
  }

  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
    const parts = getTemplateParts(node);
    if (parts.length === 1) {
      addExact(exact, parts[0]);
    } else {
      addPattern(patterns, parts);
    }
    return;
  }

  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (ts.isExpression(element)) collectFromExpression(element, exact, patterns);
    }
    return;
  }
}

function isTCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) return node.expression.text === "t";
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text === "t";
  return false;
}

function matchesPattern(key: string, pattern: Pattern): boolean {
  const { parts } = pattern;
  if (parts.length === 1) return key === parts[0];

  let cursor = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;

    if (i === 0) {
      if (!key.startsWith(part)) return false;
      cursor = part.length;
      continue;
    }

    const index = key.indexOf(part, cursor);
    if (index === -1) return false;
    cursor = index + part.length;
  }

  const last = parts[parts.length - 1];
  return !last || key.endsWith(last);
}

function markAncestors(key: string, exact: Set<string>) {
  const segments = key.split(".");
  while (segments.length > 1) {
    segments.pop();
    exact.add(segments.join("."));
  }
}

function pruneJson(
  input: JsonValue,
  prefix: string,
  usedLeafKeys: Set<string>,
): JsonValue | undefined {
  if (Array.isArray(input)) {
    const next = input
      .map((item, index) =>
        pruneJson(item, prefix ? `${prefix}.${index}` : String(index), usedLeafKeys),
      )
      .filter((item) => item !== undefined);
    return next.length ? next : undefined;
  }

  if (input && typeof input === "object") {
    const next: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(input)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      const pruned = pruneJson(value, childPath, usedLeafKeys);
      if (pruned !== undefined) next[key] = pruned;
    }
    return Object.keys(next).length ? next : undefined;
  }

  return usedLeafKeys.has(prefix) ? input : undefined;
}

function collectUsages(files: string[]) {
  const exact = new Set<string>();
  const patterns: Pattern[] = [];

  for (const file of files) {
    const sourceText = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && isTCall(node)) {
        collectFromExpression(node.arguments[0], exact, patterns);
      }

      if (ts.isJsxAttribute(node) && KEY_ATTRS.has(node.name.text) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          addExact(exact, node.initializer.text);
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression &&
          ts.isExpression(node.initializer.expression)
        ) {
          collectFromExpression(node.initializer.expression, exact, patterns);
        }
      }

      if (ts.isPropertyAssignment(node)) {
        const name =
          ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
        if (name && KEY_PROPS.has(name)) {
          collectFromExpression(node.initializer, exact, patterns);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return { exact, patterns };
}

function main() {
  const localeDocs = LOCALE_FILES.map((file) => ({
    file,
    json: JSON.parse(fs.readFileSync(file, "utf8")) as JsonValue,
  }));

  const allLeafKeys = localeDocs.reduce(
    (acc, locale) => flattenJson(locale.json, "", acc),
    new Set<string>(),
  );
  const sourceFiles = walkFiles(SRC_DIR);
  const { exact, patterns } = collectUsages(sourceFiles);

  for (const key of allLeafKeys) {
    for (const pattern of patterns) {
      if (matchesPattern(key, pattern)) {
        exact.add(key);
        break;
      }
    }
  }

  for (const key of [...exact]) markAncestors(key, exact);

  const unusedLeafKeys = [...allLeafKeys].filter((key) => !exact.has(key));
  const missingExactKeys = [...exact].filter(
    (key) => !allLeafKeys.has(key) && ![...allLeafKeys].some((leaf) => leaf.startsWith(`${key}.`)),
  );
  const unmatchedPatterns = patterns.filter(
    (pattern) => ![...allLeafKeys].some((key) => matchesPattern(key, pattern)),
  );

  for (const locale of localeDocs) {
    const pruned = pruneJson(
      locale.json,
      "",
      new Set([...allLeafKeys].filter((key) => exact.has(key))),
    );
    fs.writeFileSync(locale.file, `${JSON.stringify(pruned, null, 2)}\n`);
  }

  console.log(`Source files scanned: ${sourceFiles.length}`);
  console.log(`Leaf keys before: ${allLeafKeys.size}`);
  console.log(`Unused leaf keys removed: ${unusedLeafKeys.length}`);
  console.log(`Missing exact keys after prune: ${missingExactKeys.length}`);
  console.log(`Unmatched dynamic patterns after prune: ${unmatchedPatterns.length}`);

  if (missingExactKeys.length > 0) {
    console.error("Missing exact keys:");
    for (const key of missingExactKeys.slice(0, 20)) console.error(`- ${key}`);
  }

  if (unmatchedPatterns.length > 0) {
    console.error("Unmatched dynamic patterns:");
    for (const pattern of unmatchedPatterns.slice(0, 20)) {
      console.error(`- ${pattern.parts.join("${...}")}`);
    }
  }
}

main();
