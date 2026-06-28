import { z } from "zod";

const SVGL_BASE_URL = "https://svgl.app";
const SVGL_API_URL = "https://api.svgl.app";
const MAX_SVGL_RESULTS = 12;

const svglRouteSchema = z.union([
  z.string(),
  z.object({
    light: z.string().optional(),
    dark: z.string().optional(),
  }),
]);

const svglIconSchema = z.object({
  id: z.number().optional(),
  title: z.string(),
  category: z.union([z.string(), z.array(z.string())]).optional(),
  route: svglRouteSchema,
  url: z.string().optional(),
});

const svglSearchResponseSchema = z.array(svglIconSchema);

export type SvglRoute = z.infer<typeof svglRouteSchema>;
export type SvglIcon = z.infer<typeof svglIconSchema>;

const SUPPLIER_SVGL_PRESETS: SvglIcon[] = [
  {
    title: "OpenAI",
    category: "AI",
    route: {
      light: "https://svgl.app/library/openai.svg",
      dark: "https://svgl.app/library/openai_dark.svg",
    },
    url: "https://openai.com/",
  },
  {
    title: "Anthropic",
    category: "AI",
    route: {
      light: "https://svgl.app/library/anthropic_black.svg",
      dark: "https://svgl.app/library/anthropic_white.svg",
    },
    url: "https://www.anthropic.com/",
  },
  {
    title: "Gemini",
    category: ["Google", "AI"],
    route: "https://svgl.app/library/gemini.svg",
    url: "https://gemini.google.com/",
  },
  {
    title: "Google",
    category: "Google",
    route: "https://svgl.app/library/google.svg",
    url: "https://www.google.com/",
  },
  {
    title: "DeepSeek",
    category: "AI",
    route: "https://svgl.app/library/deepseek.svg",
    url: "https://deepseek.com/",
  },
  {
    title: "Groq",
    category: "AI",
    route: "https://svgl.app/library/groq.svg",
    url: "https://groq.com/",
  },
  {
    title: "Amazon Web Services",
    category: "Software",
    route: {
      light: "https://svgl.app/library/aws_light.svg",
      dark: "https://svgl.app/library/aws_dark.svg",
    },
    url: "https://aws.amazon.com/",
  },
];

const SUPPLIER_PRESET_ALIASES: Record<string, string[]> = {
  "Amazon Web Services": ["amazon", "aws", "bedrock"],
  Gemini: ["gemini", "google-ai", "google"],
};

function absoluteSvglUrl(value: string): string {
  return new URL(value, SVGL_BASE_URL).toString();
}

function normalizeRoute(route: SvglRoute): SvglRoute {
  if (typeof route === "string") return absoluteSvglUrl(route);

  return {
    light: route.light ? absoluteSvglUrl(route.light) : undefined,
    dark: route.dark ? absoluteSvglUrl(route.dark) : undefined,
  };
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function iconMatches(icon: SvglIcon, query: string): boolean {
  const needle = normalizeMatchText(query);
  if (!needle) return false;

  const aliases = SUPPLIER_PRESET_ALIASES[icon.title] ?? [];
  return [icon.title, ...aliases].some((value) => {
    const candidate = normalizeMatchText(value);
    return candidate.includes(needle) || needle.includes(candidate);
  });
}

function mergeIcons(primary: SvglIcon[], secondary: SvglIcon[]): SvglIcon[] {
  const seen = new Set<string>();
  const merged: SvglIcon[] = [];

  for (const icon of [...primary, ...secondary]) {
    const url = getSvglIconUrl(icon);
    const key = url || icon.title.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    merged.push(icon);
  }

  return merged.slice(0, MAX_SVGL_RESULTS);
}

export function getSvglIconUrl(icon: SvglIcon): string {
  if (typeof icon.route === "string") return absoluteSvglUrl(icon.route);

  const route = icon.route.light ?? icon.route.dark;
  return route ? absoluteSvglUrl(route) : "";
}

export function getSvglPresetIcons(query: string): SvglIcon[] {
  const trimmed = query.trim();
  if (!trimmed) return SUPPLIER_SVGL_PRESETS;

  return SUPPLIER_SVGL_PRESETS.filter((icon) => iconMatches(icon, trimmed));
}

export async function searchSvglIcons(query: string, signal?: AbortSignal): Promise<SvglIcon[]> {
  const trimmed = query.trim();
  const presets = getSvglPresetIcons(trimmed);
  if (!trimmed) return presets.slice(0, MAX_SVGL_RESULTS);

  const url = new URL(SVGL_API_URL);
  url.searchParams.set("search", trimmed);

  const response = await fetch(url, { signal });
  if (response.status === 404) return presets;
  if (!response.ok) {
    if (presets.length > 0) return presets;
    throw new Error(`SVGL request failed with ${response.status}`);
  }

  const data = await response.json();
  const icons = svglSearchResponseSchema
    .parse(data)
    .map((icon) => ({ ...icon, route: normalizeRoute(icon.route) }));

  return mergeIcons(icons, presets);
}
