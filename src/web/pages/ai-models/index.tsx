import { useState } from "react";
import { useTranslation } from "react-i18next";

import { parseAsInteger, useQueryState } from "nuqs";

import { useAiModelsList, useAiProviders } from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";

import { ModelList } from "./model-list";
import { ModelRoutesSheet } from "./model-routes-sheet";

export default function AiModelsPage() {
  const { t } = useTranslation();
  const { data: models = [], isLoading } = useAiModelsList();
  const { data: providers = [] } = useAiProviders();
  const [routeModelId, setRouteModelId] = useQueryState("routeModel", parseAsInteger);

  const routeModel = models.find((m) => m.id === routeModelId) ?? null;

  return (
    <div>
      <Header title={t("ai-models.title")} description={t("ai-models.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <ModelList
          models={models}
          providers={providers}
          loading={isLoading}
          onManageRoutes={(m) => setRouteModelId(m.id)}
        />
      </div>

      {routeModel && (
        <ModelRoutesSheet
          open={!!routeModel}
          onOpenChange={(v) => {
            if (!v) setRouteModelId(null);
          }}
          model={routeModel}
          providers={providers}
        />
      )}
    </div>
  );
}
