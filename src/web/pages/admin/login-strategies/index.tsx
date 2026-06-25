import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Github, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import {
  useAdminAuthProvidersConfig,
  useUpdateAdminAuthProvidersConfig,
} from "@/web/api/admin-hooks";
import { Header } from "@/web/components/dashboard/header";
import { Button } from "@/web/components/ui/button";

import { CredentialsCard } from "./credentials-card";
import { GoogleIcon } from "./google-icon";
import { OAuthCard } from "./oauth-card";
import { OidcCard } from "./oidc-card";
import { SamlCard } from "./saml-card";
import type { ConfigState, ProviderState } from "./shared";
import { validateOAuthCredentials } from "./shared";
import { SiweCard } from "./siwe-card";

export default function LoginStrategiesPage() {
  const { t } = useTranslation();
  const { data: serverConfig, isLoading } = useAdminAuthProvidersConfig();
  const updateConfig = useUpdateAdminAuthProvidersConfig();

  const [config, setConfig] = useState<ConfigState>({
    credentials: { enabled: false, clientId: "", clientSecret: "" },
    google: { enabled: false, clientId: "", clientSecret: "" },
    github: { enabled: false, clientId: "", clientSecret: "" },
    oidc: { enabled: false, clientId: "", clientSecret: "", issuer: "", displayName: "" },
    saml: {
      enabled: false,
      clientId: "",
      clientSecret: "",
      entityId: "",
      ssoUrl: "",
      certificate: "",
      displayName: "",
    },
  });
  const [dirty, setDirty] = useState(false);

  // Sync local config from server data (render-time setState — React pattern for
  // adjusting state when a prop changes, avoids synchronous setState in effect).
  const [prevServerConfig, setPrevServerConfig] = useState(serverConfig);
  if (prevServerConfig !== serverConfig) {
    setPrevServerConfig(serverConfig);
    if (serverConfig) {
      const oidcServer = serverConfig.oidc as ProviderState | undefined;
      const next: ConfigState = {
        credentials: {
          enabled: (serverConfig.credentials as ProviderState)?.enabled ?? false,
          clientId: "",
          clientSecret: "",
        },
        google: {
          enabled: (serverConfig.google as ProviderState)?.enabled ?? false,
          clientId: (serverConfig.google as ProviderState)?.clientId ?? "",
          clientSecret: (serverConfig.google as ProviderState)?.clientSecret ?? "",
        },
        github: {
          enabled: (serverConfig.github as ProviderState)?.enabled ?? false,
          clientId: (serverConfig.github as ProviderState)?.clientId ?? "",
          clientSecret: (serverConfig.github as ProviderState)?.clientSecret ?? "",
        },
        oidc: {
          enabled: oidcServer?.enabled ?? false,
          clientId: oidcServer?.clientId ?? "",
          clientSecret: oidcServer?.clientSecret ?? "",
          issuer: oidcServer?.issuer ?? "",
          displayName: oidcServer?.displayName ?? "",
          scopes: oidcServer?.scopes,
        },
        saml: {
          enabled: (serverConfig.saml as ProviderState)?.enabled ?? false,
          clientId: "",
          clientSecret: "",
          entityId: (serverConfig.saml as ProviderState)?.entityId ?? "",
          ssoUrl: (serverConfig.saml as ProviderState)?.ssoUrl ?? "",
          certificate: (serverConfig.saml as ProviderState)?.certificate ?? "",
          displayName: (serverConfig.saml as ProviderState)?.displayName ?? "",
          metadataUrl: (serverConfig.saml as ProviderState)?.metadataUrl ?? "",
        },
      };
      setConfig(next);
      setDirty(false);
    }
  }

  const update = (provider: string, patch: Partial<ProviderState>) => {
    setConfig((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], ...patch },
    }));
    setDirty(true);
  };

  const validationErrors = validateOAuthCredentials(config);

  const handleSave = async () => {
    if (validationErrors.length > 0) {
      toast.error(t(`admin.login-strategies.validation.${validationErrors[0]}`));
      return;
    }
    try {
      await updateConfig.mutateAsync(config);
      toast.success(t("admin.login-strategies.toast.saved"));
      setDirty(false);
    } catch {
      toast.error(t("admin.login-strategies.toast.save-error"));
    }
  };

  return (
    <div>
      <Header
        title={t("admin.login-strategies.title")}
        description={t("admin.login-strategies.desc")}
      />

      <div className="p-4 md:p-8 space-y-6">
        <SiweCard />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <CredentialsCard
            config={config.credentials}
            onUpdate={(p) => update("credentials", p)}
            loading={isLoading}
          />
          <OAuthCard
            provider="google"
            icon={<GoogleIcon />}
            title="Google"
            description={t("admin.login-strategies.google.desc")}
            config={config.google}
            onUpdate={(p) => update("google", p)}
            loading={isLoading}
          />
          <OAuthCard
            provider="github"
            icon={<Github className="h-5 w-5" />}
            title="GitHub"
            description={t("admin.login-strategies.github.desc")}
            config={config.github}
            onUpdate={(p) => update("github", p)}
            loading={isLoading}
          />
          <OidcCard config={config.oidc} onUpdate={(p) => update("oidc", p)} loading={isLoading} />
          <SamlCard config={config.saml} onUpdate={(p) => update("saml", p)} loading={isLoading} />
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={!dirty || validationErrors.length > 0 || updateConfig.isPending}
            className="gap-2"
          >
            {updateConfig.isPending ? (
              <span className="animate-spin">
                <Loader2 className="h-4 w-4" />
              </span>
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("admin.login-strategies.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
