import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Check, Copy, Info, Key, Zap } from "lucide-react";
import { toast } from "sonner";

import { useUserKeys } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { LocaleLink } from "@/web/components/locale-link";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

export default function UserEndpointPage() {
  const { t } = useTranslation();
  const { data: keys = [], isLoading } = useUserKeys();

  const baseUrl = useMemo(() => `${window.location.origin}/api/gateway/ai/endpoint/v1`, []);
  const activeKeys = keys.filter((k) => k.status === "active");

  const handleCopy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text);
      toast.success(t("user.endpoint.copied"));
    },
    [t],
  );

  return (
    <div>
      <Header title={t("user.endpoint.title")} description={t("user.endpoint.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        {/* Intro */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              {t("user.endpoint.intro-title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("user.endpoint.intro-body")}
            </p>
          </CardContent>
        </Card>

        {/* Endpoint URL */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {t("user.endpoint.url-title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="inline-flex items-center gap-1.5 rounded-md bg-muted pl-3 pr-1.5 py-1.5">
              <code className="font-mono text-xs select-all">{baseUrl}</code>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => handleCopy(baseUrl)}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("user.endpoint.url-hint")}</p>
          </CardContent>
        </Card>

        {/* My Keys */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Key className="h-4 w-4" />
                {t("user.endpoint.keys-title")}
              </CardTitle>
              <Button variant="outline" size="sm" asChild>
                <LocaleLink to="/user/keys">{t("user.endpoint.manage-keys")}</LocaleLink>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : activeKeys.length === 0 ? (
              <div className="text-center py-4 space-y-2">
                <p className="text-xs text-muted-foreground">{t("user.endpoint.no-keys")}</p>
                <Button size="sm" asChild>
                  <LocaleLink to="/user/keys">{t("user.keys.create")}</LocaleLink>
                </Button>
              </div>
            ) : (
              <div className="grid gap-2">
                {activeKeys.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{k.name}</span>
                      <code className="font-mono text-xs text-muted-foreground">
                        {k.apiKeyPrefix}...
                      </code>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-green-500/50 bg-green-500/10 text-green-600"
                    >
                      <Check className="mr-1 h-3 w-3" />
                      {t("common.status.active")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Code Examples */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
          <ExampleCard title="OpenAI SDK" code={openaiExample(baseUrl)} onCopy={handleCopy} />
          <ExampleCard title="Claude Code" code={claudeCodeExample(baseUrl)} onCopy={handleCopy} />
          <ExampleCard title="Gemini SDK" code={geminiExample(baseUrl)} onCopy={handleCopy} />
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function ExampleCard({
  title,
  code,
  onCopy,
}: {
  title: string;
  code: string;
  onCopy: (text: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopy(code)}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="rounded-lg bg-muted p-3 overflow-x-auto whitespace-pre font-mono text-xs">
          <code>
            <CodeWithKeyLink code={code} />
          </code>
        </pre>
      </CardContent>
    </Card>
  );
}

const SKA_PLACEHOLDER = "ska_YOUR_CONSUMER_KEY";

function CodeWithKeyLink({ code }: { code: string }) {
  const idx = code.indexOf(SKA_PLACEHOLDER);
  if (idx === -1) return <>{code}</>;
  return (
    <>
      {code.slice(0, idx)}
      <LocaleLink to="/user/keys" className="underline text-primary hover:text-primary/80">
        {SKA_PLACEHOLDER}
      </LocaleLink>
      {code.slice(idx + SKA_PLACEHOLDER.length)}
    </>
  );
}

function openaiExample(base: string): string {
  return `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "ska_YOUR_CONSUMER_KEY",
  baseURL: "${base}",
});

const res = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});`;
}

function claudeCodeExample(base: string): string {
  return `# ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "${base}",
    "ANTHROPIC_API_KEY": "ska_YOUR_CONSUMER_KEY"
  }
}`;
}

function geminiExample(base: string): string {
  return `import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: "ska_YOUR_CONSUMER_KEY",
  httpOptions: { baseUrl: "${base}" },
});

const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "Hello!",
});
console.log(response.text);`;
}
