import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  ArrowLeft,
  Building2,
  Github,
  Languages,
  Loader2,
  LogIn,
  Mail,
  Shield,
} from "lucide-react";
import { useAccount } from "wagmi";

import { useAdminAuthProviders } from "@/web/api/admin-auth-hooks";
import { BrandPanel } from "@/web/components/auth/brand-panel";
import { GoogleIcon } from "@/web/components/auth/google-icon";
import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import { EmailInput } from "@/web/components/ui/email-input";
import { Input } from "@/web/components/ui/input";
import { Logo } from "@/web/components/ui/logo";
import { useLanguageSwitch, useLocaleNavigate } from "@/web/hooks/use-locale";
import { useAdminAuthContext } from "@/web/providers/admin-auth-provider";

export default function AdminLoginPage() {
  const { t } = useTranslation();
  const navigate = useLocaleNavigate();
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isAuthenticated, isBusy, error, login } = useAdminAuthContext();
  const { data: providersData } = useAdminAuthProviders();
  const providers = providersData?.providers ?? ["siwe"];

  // Local state for email/password form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { currentLang, toggleLang } = useLanguageSwitch();

  useEffect(() => {
    if (isAuthenticated) navigate("/admin/dashboard", { replace: true });
  }, [isAuthenticated, navigate]);

  const handleWalletLogin = () => {
    if (isConnected) {
      login("siwe");
    } else {
      openConnectModal?.();
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    await login("credentials", { email, password });
  };

  const handleGoogleLogin = () => login("google");
  const handleGithubLogin = () => login("github");

  return (
    <div className="flex min-h-screen">
      <BrandPanel />

      {/* Right panel */}
      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-8 py-5 lg:px-12">
          <div className="lg:invisible">
            <Logo className="h-6 w-6" />
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <Button variant="ghost" size="sm" onClick={toggleLang} className="gap-1.5 text-xs">
              <Languages className="h-3.5 w-3.5" />
              {currentLang === "zh" ? "EN" : "中文"}
            </Button>
            <LocaleLink
              to="/user/login"
              className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              {t("admin.back")}
            </LocaleLink>
          </div>
        </div>

        {/* Form */}
        <div className="flex flex-1 items-center justify-center px-8 py-12 lg:px-16">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">{t("admin.login-title")}</h2>
              <p className="text-sm text-muted-foreground">{t("admin.login-desc")}</p>
            </div>

            {/* ── Wallet login (primary CTA) ──────────────────── */}
            <Button
              onClick={handleWalletLogin}
              disabled={isBusy}
              className="w-full gap-2"
              size="lg"
            >
              {isBusy ? (
                <>
                  <span className="animate-spin">
                    <Loader2 className="h-4 w-4" />
                  </span>
                  {t("auth.signing")}
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  {t("admin.sign-in-btn")}
                </>
              )}
            </Button>

            {/* ── Web2 auth section (only if any web2 provider is enabled) ── */}
            {(providers.includes("credentials") ||
              providers.includes("google") ||
              providers.includes("github") ||
              providers.includes("oidc") ||
              providers.includes("saml")) && (
              <>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">
                    {t("auth.or-sign-in-with-account")}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {providers.includes("credentials") && (
                  <form onSubmit={handleEmailLogin} className="space-y-3">
                    <EmailInput
                      placeholder={t("auth.email-ph")}
                      aria-label={t("auth.email-ph")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                    <Input
                      type="password"
                      placeholder={t("auth.password-ph")}
                      aria-label={t("auth.password-ph")}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={isBusy || !email || !password}
                      className="w-full gap-2"
                      size="sm"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {t("auth.sign-in-btn-email")}
                    </Button>
                  </form>
                )}

                {(providers.includes("google") ||
                  providers.includes("github") ||
                  providers.includes("oidc") ||
                  providers.includes("saml")) && (
                  <div className="flex gap-2">
                    {providers.includes("google") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        disabled={isBusy}
                        onClick={handleGoogleLogin}
                      >
                        <GoogleIcon />
                        {t("auth.continue-with-google")}
                      </Button>
                    )}
                    {providers.includes("github") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        disabled={isBusy}
                        onClick={handleGithubLogin}
                      >
                        <Github className="h-3.5 w-3.5" />
                        {t("auth.continue-with-github")}
                      </Button>
                    )}
                    {providers.includes("oidc") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        disabled={isBusy}
                        onClick={() => login("oidc")}
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        {t("auth.continue-with-sso")}
                      </Button>
                    )}
                    {providers.includes("saml") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        disabled={isBusy}
                        onClick={() => login("saml")}
                      >
                        <Shield className="h-3.5 w-3.5" />
                        {t("auth.continue-with-saml")}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Error ────────────────────────────────────────── */}
            <div className="min-h-[20px]">
              {error && (
                <p className="text-sm text-destructive text-center">
                  {error === "not-admin"
                    ? t("admin.not-admin")
                    : t(`auth.error.${error}`, { defaultValue: error })}
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">{t("admin.footer-note")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
