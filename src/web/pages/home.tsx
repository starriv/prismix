import { useTranslation } from "react-i18next";

import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  FileText,
  KeyRound,
  Network,
  Plug,
  Repeat,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { getUserToken } from "@/web/api/user-client";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/web/components/home/animated";
import { HeroBackground } from "@/web/components/home/hero-background";
import { HeroChat } from "@/web/components/home/hero-chat";
import { PrismDispersion } from "@/web/components/home/prism-dispersion";
import { PublicFooter } from "@/web/components/home/public-footer";
import { PublicNav } from "@/web/components/home/public-nav";
import { LocaleLink } from "@/web/components/locale-link";

export default function HomePage() {
  const { t } = useTranslation();
  const isLoggedIn = !!getUserToken();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      <main>
        {/* Hero — left: prism visual, right: text */}
        <section aria-label="Hero" className="relative min-h-svh flex items-center px-6 py-16">
          <HeroBackground />
          <div className="relative mx-auto max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center pointer-events-none">
            {/* Left — Prism dispersion */}
            <FadeInUp className="hidden lg:block">
              <PrismDispersion />
            </FadeInUp>

            {/* Right — Copy */}
            <div className="space-y-6 text-center lg:text-left pointer-events-none">
              <FadeInUp>
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {t("home.hero.ai-badge")}
                </div>
              </FadeInUp>

              <FadeInUp delay={0.1}>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tighter leading-[1.05]">
                  {t("home.hero.ai-title-1")}
                  <br />
                  <span className="text-muted-foreground">{t("home.hero.ai-title-2")}</span>
                </h1>
              </FadeInUp>

              <FadeInUp delay={0.15}>
                <p className="text-lg sm:text-xl font-medium text-muted-foreground/80 tracking-tight">
                  {t("home.hero.ai-tagline")}
                </p>
              </FadeInUp>

              <FadeInUp delay={0.25}>
                <p className="max-w-xl text-base sm:text-lg font-medium text-muted-foreground leading-relaxed">
                  {t("home.hero.ai-desc")}
                </p>
              </FadeInUp>

              <FadeInUp delay={0.35}>
                <div className="flex flex-col sm:flex-row items-center lg:items-start gap-3 pointer-events-auto">
                  <LocaleLink
                    to={isLoggedIn ? "/user/dashboard" : "/user/login"}
                    className="inline-flex items-center gap-2 rounded-md bg-foreground px-6 py-2.5 text-sm font-medium text-background hover:opacity-80 transition-opacity"
                  >
                    {t("home.hero.cta-primary")}
                    <ArrowRight className="h-4 w-4" />
                  </LocaleLink>
                  {/* TODO: unhide when docs site is ready
                  <LocaleLink
                    to="/docs"
                    className="inline-flex items-center gap-2 rounded-md border border-border px-6 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
                  >
                    <BookOpen className="h-4 w-4" />
                    {t("home.hero.cta-secondary")}
                  </LocaleLink>
                  */}
                </div>
              </FadeInUp>
            </div>
          </div>
        </section>

        {/* AI Gateway Content */}
        <div className="px-6 pt-8 pb-4">
          <div className="mx-auto max-w-6xl">
            <AiGatewayContent />
          </div>
        </div>

        {/* CTA */}
        <section aria-label="Call to action" className="pb-28 px-6">
          <FadeInUp className="mx-auto max-w-3xl">
            <div
              className="animate-glow-border relative rounded-2xl p-px border border-transparent"
              style={{
                backgroundImage: `conic-gradient(from var(--glow-angle, 0deg), var(--color-border) 25%, oklch(0.65 0.18 260) 48%, oklch(0.55 0.2 170) 55%, var(--color-border) 75%)`,
                backgroundOrigin: "border-box",
                backgroundClip: "border-box",
              }}
            >
              <div className="rounded-[calc(1rem-1px)] bg-background p-12 text-center space-y-6">
                <h2 className="text-3xl font-bold tracking-tight text-foreground">
                  {t("home.cta.ai-title")}
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-md mx-auto">
                  {t("home.cta.ai-desc")}
                </p>
                <LocaleLink
                  to={isLoggedIn ? "/user/dashboard" : "/user/login"}
                  className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-6 py-2.5 text-sm font-medium hover:opacity-80 transition-opacity"
                >
                  {t("home.cta.ai-btn")}
                  <ArrowRight className="h-4 w-4" />
                </LocaleLink>
              </div>
            </div>
          </FadeInUp>
        </section>
      </main>

      <FadeInUp>
        <PublicFooter />
      </FadeInUp>
    </div>
  );
}

// ── AI Relay Gateway Content ─────────────────────────

function AiGatewayContent() {
  const { t } = useTranslation();

  return (
    <>
      {/* AI Relay Intro */}
      <section aria-label="AI relay intro" className="pb-28">
        <FadeInUp className="text-center space-y-3 mb-16">
          <span className="inline-block font-mono text-xs tracking-widest text-muted-foreground uppercase">
            {t("home.ai.intro.label")}
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {t("home.ai.intro.title")}
          </h2>
          <p className="text-muted-foreground">{t("home.ai.intro.desc")}</p>
        </FadeInUp>
        <FadeInUp className="mb-12">
          <HeroChat />
        </FadeInUp>
        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {AI_INTRO_CARDS.map((c) => (
            <StaggerItem key={c.key}>
              <FeatureCard
                icon={c.icon}
                titleKey={`home.ai.intro.${c.key}.title`}
                descKey={`home.ai.intro.${c.key}.desc`}
              />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </section>

      {/* AI Features */}
      <section aria-label="AI features" className="pb-28 border-t border-border">
        <div className="pt-20">
          <FadeInUp className="text-center space-y-3 mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              {t("home.ai.features.title")}
            </h2>
            <p className="text-muted-foreground">{t("home.ai.features.desc")}</p>
          </FadeInUp>
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {AI_FEATURES.map((f) => (
              <StaggerItem key={f.key}>
                <FeatureCard
                  icon={f.icon}
                  titleKey={`home.ai.features.${f.key}.title`}
                  descKey={`home.ai.features.${f.key}.desc`}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* AI How it works */}
      <section aria-label="AI how it works" className="pb-28 border-t border-border">
        <div className="mx-auto max-w-5xl pt-20">
          <HowItWorksSection
            labelKey="home.ai.how.desc"
            titleKey="home.ai.how.title"
            stepPrefix="home.ai.how"
            steps={4}
          />
        </div>
      </section>
    </>
  );
}

// ── Shared Components ────────────────────────────────

function FeatureCard({
  icon: Icon,
  titleKey,
  descKey,
}: {
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="h-full rounded-xl border border-border p-6 space-y-3 hover:bg-muted/30 hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <h3 className="font-semibold text-sm">{t(titleKey)}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{t(descKey)}</p>
    </div>
  );
}

function HowItWorksSection({
  labelKey,
  titleKey,
  stepPrefix,
  steps,
}: {
  labelKey: string;
  titleKey: string;
  stepPrefix: string;
  steps: number;
}) {
  const { t } = useTranslation();

  return (
    <>
      <FadeInUp className="text-center space-y-3 mb-16">
        <span className="inline-block font-mono text-xs tracking-widest text-muted-foreground uppercase">
          {t(labelKey)}
        </span>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t(titleKey)}</h2>
      </FadeInUp>

      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
        {Array.from({ length: steps }, (_, i) => (
          <StaggerItem key={i} className="relative flex flex-col items-center text-center">
            {/* Connector line (desktop only) */}
            {i < steps - 1 && (
              <div
                className="hidden lg:block absolute top-[1.5rem] h-px overflow-visible"
                style={{ left: "calc(50% + 1.5rem)", right: "calc(-50% - 0.5rem)" }}
              >
                <div
                  className="absolute inset-0 animate-flow-dash"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(90deg, rgb(16 185 129 / 0.3) 0px, rgb(16 185 129 / 0.3) 6px, transparent 6px, transparent 14px)",
                    backgroundSize: "14px 1px",
                  }}
                />
                <div className="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-emerald-500/60 shadow-[0_0_6px_rgb(16_185_129_/_0.4)] animate-flow-dot" />
              </div>
            )}

            {/* Numbered circle */}
            <div className="relative z-10 mb-5 flex h-12 w-12 items-center justify-center rounded-full border-2 border-emerald-500/40 bg-emerald-500/10 bg-background">
              <span className="font-mono text-sm font-bold text-emerald-500">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>

            <h3 className="font-semibold text-sm mb-1.5">
              {t(`${stepPrefix}.step${i + 1}.title`)}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t(`${stepPrefix}.step${i + 1}.desc`)}
            </p>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </>
  );
}

// ── Data ─────────────────────────────────────────────

const AI_INTRO_CARDS = [
  { key: "unified", icon: Plug },
  { key: "keypool", icon: KeyRound },
  { key: "metering", icon: BarChart3 },
];

const AI_FEATURES = [
  { key: "relay", icon: Network },
  { key: "wallet", icon: Wallet },
  { key: "rotation", icon: Repeat },
  { key: "consumer", icon: ShieldCheck },
  { key: "billing", icon: Activity },
  { key: "logging", icon: FileText },
];
