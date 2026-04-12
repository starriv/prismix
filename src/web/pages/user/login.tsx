import { useCallback, useEffect, useState } from "react";
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
  UserPlus,
} from "lucide-react";
import { useAccount } from "wagmi";

import { useUserAuthProviders } from "@/web/api/user-auth-hooks";
import { BrandPanel } from "@/web/components/auth/brand-panel";
import { GoogleIcon } from "@/web/components/auth/google-icon";
import { isPasswordValid, PasswordStrength } from "@/web/components/auth/password-strength";
import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import { EmailInput } from "@/web/components/ui/email-input";
import { Input } from "@/web/components/ui/input";
import { Logo } from "@/web/components/ui/logo";
import { useLanguageSwitch, useLocaleNavigate } from "@/web/hooks/use-locale";
import { useUserAuthContext } from "@/web/providers/user-auth-provider";

export default function UserLoginPage() {
  const { t } = useTranslation();
  const navigate = useLocaleNavigate();
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isAuthenticated, isBusy, error, login, register } = useUserAuthContext();
  const { data: providersData } = useUserAuthProviders();
  const providers = providersData?.providers ?? ["siwe"];

  // Local state for email/password form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  const { currentLang, toggleLang } = useLanguageSwitch();

  useEffect(() => {
    if (isAuthenticated) navigate("/user/dashboard", { replace: true });
  }, [isAuthenticated, navigate]);

  const handleWalletLogin = useCallback(() => {
    if (isConnected) {
      login("siwe");
    } else {
      openConnectModal?.();
    }
  }, [isConnected, login, openConnectModal]);

  const handleEmailLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email || !password) return;
      if (isRegisterMode) {
        if (password !== confirmPassword || !isPasswordValid(password)) return;
        await register("credentials", { email, password, name: email.split("@")[0] });
      } else {
        await login("credentials", { email, password });
      }
    },
    [email, password, confirmPassword, isRegisterMode, login, register],
  );

  const handleGoogleLogin = useCallback(() => login("google"), [login]);
  const handleGithubLogin = useCallback(() => login("github"), [login]);

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
              {currentLang === "zh" ? "EN" : "\u4e2d\u6587"}
            </Button>
            <LocaleLink
              to="/"
              className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              {t("user.login.back")}
            </LocaleLink>
          </div>
        </div>

        {/* Form */}
        <div className="flex flex-1 items-center justify-center px-8 py-12 lg:px-16">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">{t("user.login.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("user.login.desc")}</p>
            </div>

            {/* Wallet login (primary CTA) */}
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
                  {t("user.login.sign-in-btn")}
                </>
              )}
            </Button>

            {/* Web2 auth section (only if any web2 provider is enabled) */}
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
                      autoComplete={isRegisterMode ? "new-password" : "current-password"}
                    />
                    {isRegisterMode && (
                      <>
                        <PasswordStrength password={password} />
                        <Input
                          type="password"
                          placeholder={t("auth.confirm-password-ph")}
                          aria-label={t("auth.confirm-password-ph")}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          autoComplete="new-password"
                          disabled={!isPasswordValid(password)}
                        />
                        <p className="text-xs text-destructive min-h-[1rem]">
                          {confirmPassword && password !== confirmPassword
                            ? t("auth.password-mismatch")
                            : "\u00A0"}
                        </p>
                      </>
                    )}
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={
                        isBusy ||
                        !email ||
                        !password ||
                        (isRegisterMode &&
                          (password !== confirmPassword || !isPasswordValid(password)))
                      }
                      className="w-full gap-2"
                      size="sm"
                    >
                      {isRegisterMode ? (
                        <>
                          <UserPlus className="h-3.5 w-3.5" />
                          {t("user.login.register-btn")}
                        </>
                      ) : (
                        <>
                          <Mail className="h-3.5 w-3.5" />
                          {t("auth.sign-in-btn-email")}
                        </>
                      )}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsRegisterMode((v) => !v);
                        setPassword("");
                        setConfirmPassword("");
                      }}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isRegisterMode ? t("user.login.have-account") : t("user.login.no-account")}
                    </button>
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

            {/* Error */}
            <div className="min-h-[20px]">
              {error && (
                <p className="text-sm text-destructive text-center">
                  {t(`auth.error.${error}`, { defaultValue: error })}
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {t("user.login.footer-note")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
