import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { parseAsInteger, useQueryState } from "nuqs";

import { useAiKeys, useAiProviders } from "@/web/api/hooks";
import type { AiProvider } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";

import { ProviderGrid } from "./provider-grid";
import { ProviderModelList } from "./provider-model-list";

export default function AiModelsPage() {
  const { t } = useTranslation();
  const { data: providers = [], isLoading: providersLoading } = useAiProviders();
  const { data: keys = [] } = useAiKeys();
  const [providerId, setProviderId] = useQueryState("providerId", parseAsInteger);

  // Only show providers that are enabled AND have at least one API key configured
  const providerIdsWithKeys = new Set(keys.filter((k) => k.enabled).map((k) => k.providerId));
  const enabledProviders = providers.filter((p) => p.enabled && providerIdsWithKeys.has(p.id));

  // Resolve provider from query string — must be in the enabled list
  const selectedProvider = enabledProviders.find((p) => p.id === providerId) ?? null;

  const handleBack = useCallback(() => setProviderId(null), [setProviderId]);
  const handleSelect = useCallback((p: AiProvider) => setProviderId(p.id), [setProviderId]);

  return (
    <div>
      <Header title={t("ai-models.title")} description={t("ai-models.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        {selectedProvider ? (
          <ProviderModelList provider={selectedProvider} onBack={handleBack} />
        ) : (
          <ProviderGrid
            providers={enabledProviders}
            loading={providersLoading}
            onSelect={handleSelect}
          />
        )}
      </div>
    </div>
  );
}
