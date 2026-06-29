import { useTranslation } from "react-i18next";

import { parseAsInteger, useQueryState } from "nuqs";

import { useAiEndpoints, useAiModelsList } from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";

import { ModelList } from "./model-list";
import { ModelRoutesDialog } from "./model-routes-dialog";

export default function AiModelsPage() {
  const { t } = useTranslation();
  const { data: models = [], isLoading } = useAiModelsList();
  const { data: endpoints = [] } = useAiEndpoints();
  const [routeModelId, setRouteModelId] = useQueryState("routeModel", parseAsInteger);

  const routeModel = models.find((m) => m.id === routeModelId) ?? null;

  return (
    <div>
      <Header title={t("ai-models.title")} description={t("ai-models.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <ModelList
          models={models}
          endpoints={endpoints}
          loading={isLoading}
          onManageRoutes={(m) => setRouteModelId(m.id)}
        />
      </div>

      {routeModel && (
        <ModelRoutesDialog
          open={!!routeModel}
          onOpenChange={(v) => {
            if (!v) setRouteModelId(null);
          }}
          model={routeModel}
          endpoints={endpoints}
        />
      )}
    </div>
  );
}
