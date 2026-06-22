import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Check, Copy, Info, Key, Zap } from "lucide-react";
import { toast } from "sonner";

import { useAiKeys, useAiProviders } from "@/web/api/hooks";
import { EndpointUrlList } from "@/web/components/dashboard/endpoint-url-list";
import { Header } from "@/web/components/dashboard/header";
import { LocaleLink } from "@/web/components/locale-link";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

export default function AiRelayPage() {
  const { t } = useTranslation();
  const { data: providers = [], isLoading } = useAiProviders();
  const { data: keys = [] } = useAiKeys();

  const openAiBaseUrl = useMemo(() => `${window.location.origin}/api/gateway/ai/openai/v1`, []);
  const anthropicBaseUrl = useMemo(
    () => `${window.location.origin}/api/gateway/ai/anthropic/v1`,
    [],
  );

  const handleCopy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text);
      toast.success(t("ai-relay.toast.copied"));
    },
    [t],
  );

  // Build provider status: has merchant key OR admin shared key
  const providerStatus = useMemo(
    () =>
      providers.map((p) => ({
        ...p,
        hasKey: keys.some((k) => k.providerId === p.id && k.enabled),
      })),
    [providers, keys],
  );

  return (
    <div>
      <Header title={t("ai-relay.title")} description={t("ai-relay.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        {/* Intro Card */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              {t("ai-relay.intro.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("ai-relay.intro.body")}
            </p>
            <div className="flex flex-wrap gap-3">
              {t("ai-relay.intro.benefits")
                .split(" | ")
                .map((b) => (
                  <Badge key={b} variant="outline" className="bg-background text-xs">
                    {b}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>

        {/* Endpoint Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {t("ai-relay.endpoint.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <EndpointUrlList
              items={[
                { label: "OpenAI", value: openAiBaseUrl },
                { label: "Anthropic", value: anthropicBaseUrl },
              ]}
              copyLabel={t("common.btn.copy")}
              onCopy={handleCopy}
            />
            <p className="text-xs text-muted-foreground">
              {t("ai-relay.endpoint.hint-before")}
              <LocaleLink
                to="/admin/consumer-keys"
                className="underline text-primary hover:text-primary/80"
              >
                {t("ai-relay.endpoint.hint-link")}
              </LocaleLink>
              {t("ai-relay.endpoint.hint-after")}
            </p>
          </CardContent>
        </Card>

        {/* Provider Status */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{t("ai-relay.providers.title")}</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <LocaleLink to="/admin/ai-providers">
                  <Key className="mr-1 h-3.5 w-3.5" />
                  {t("ai-relay.providers.manage-keys")}
                </LocaleLink>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2 py-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : providerStatus.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                {t("ai-relay.providers.empty")}
              </p>
            ) : (
              <div className="grid gap-2">
                {providerStatus.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2"
                  >
                    <span className="text-sm font-medium">{p.name}</span>
                    <Badge
                      variant={p.hasKey ? "outline" : "outline"}
                      className={
                        p.hasKey ? "border-green-500/50 bg-green-500/10 text-green-600" : ""
                      }
                    >
                      {p.hasKey ? (
                        <span className="flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          {t("ai-relay.providers.ready")}
                        </span>
                      ) : (
                        t("ai-relay.providers.no-key")
                      )}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Usage Examples — 3 cards */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          <ExampleCard
            title="OpenAI SDK"
            code={openaiExample(openAiBaseUrl)}
            onCopy={handleCopy}
            copyLabel={t("common.btn.copy")}
          />
          <ExampleCard
            title="Claude Code"
            code={claudeCodeExample(anthropicBaseUrl)}
            onCopy={handleCopy}
            copyLabel={t("common.btn.copy")}
          />
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
  copyLabel,
}: {
  title: string;
  code: string;
  onCopy: (text: string) => void;
  copyLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onCopy(code)}
            aria-label={copyLabel}
          >
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
      <LocaleLink
        to="/admin/consumer-keys"
        className="underline text-primary hover:text-primary/80"
      >
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
  messages: [
    { role: "developer", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
  ],
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
