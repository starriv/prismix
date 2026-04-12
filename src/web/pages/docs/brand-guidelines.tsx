import { useTranslation } from "react-i18next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

export default function BrandGuidelinesPage() {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-8 space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("docs.brand.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("docs.brand.desc")}</p>
      </div>

      {/* Brand Overview */}
      <DocSection title={t("docs.brand.overview.title")}>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("docs.brand.overview.desc")}
        </p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.overview.th.attr")}</TableHead>
                <TableHead>{t("docs.brand.overview.th.desc")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["trustworthy", "minimal", "technical", "modern"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.brand.overview.rows.${k}.attr`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.brand.overview.rows.${k}.desc`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DocSection>

      {/* Logo */}
      <DocSection title={t("docs.brand.logo.title")}>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("docs.brand.logo.desc")}</p>
        <CodeBlock>{`┌─────────────────────────────────────────────────────┐
│  Layer 3 (back)   Corner Brackets — the "Gate" frame        │
│  Layer 2 (mid)    C Arc Ring — the "Coin" + gateway opening │
│  Layer 1 (front)  Center Dot — the transaction origin       │
└─────────────────────────────────────────────────────┘`}</CodeBlock>

        <h4 className="text-sm font-semibold mt-6">{t("docs.brand.logo.variants-title")}</h4>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.logo.th.variant")}</TableHead>
                <TableHead>{t("docs.brand.logo.th.file")}</TableHead>
                <TableHead>{t("docs.brand.logo.th.used-when")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-sm font-medium">{t("docs.brand.logo.dark")}</TableCell>
                <TableCell className="font-mono text-xs">public/logo.svg</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {t("docs.brand.logo.dark-when")}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-sm font-medium">{t("docs.brand.logo.light")}</TableCell>
                <TableCell className="font-mono text-xs">public/logo-light.svg</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {t("docs.brand.logo.light-when")}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <h4 className="text-sm font-semibold mt-6">{t("docs.brand.logo.wordmark-title")}</h4>
        <p className="text-sm text-muted-foreground">{t("docs.brand.logo.wordmark-desc")}</p>
        <CodeBlock>{`Font:     Plus Jakarta Sans ExtraBold (800)
Size:     15px
Spacing:  -0.02em
Case:     all lowercase "prismix"
Color:    inherits currentColor (auto light/dark)`}</CodeBlock>

        <h4 className="text-sm font-semibold mt-6">{t("docs.brand.logo.meaning-title")}</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
          <li>{t("docs.brand.logo.meaning-coin")}</li>
          <li>{t("docs.brand.logo.meaning-gate")}</li>
          <li>{t("docs.brand.logo.meaning-together")}</li>
        </ul>

        <h4 className="text-sm font-semibold mt-6">{t("docs.brand.logo.favicon-title")}</h4>
        <p className="text-sm text-muted-foreground">{t("docs.brand.logo.favicon-desc")}</p>

        <h4 className="text-sm font-semibold mt-6">{t("docs.brand.logo.lockup-title")}</h4>
        <p className="text-sm text-muted-foreground">{t("docs.brand.logo.lockup-desc")}</p>
        <CodeBlock>{`[ ICON ]  prismix
  28px     15px Plus Jakarta Sans ExtraBold
     ↕ 8px gap`}</CodeBlock>

        <h4 className="text-sm font-semibold mt-6">{t("docs.brand.logo.component-title")}</h4>
        <CodeBlock>{`<Logo />                              // icon + wordmark, auto theme
<Logo subtitle={t("nav.subtitle")} /> // icon + wordmark + subtitle
<Logo iconOnly />                     // icon only
<Logo variant="dark" />               // force dark variant
<Logo className="h-8 w-8" />          // custom size`}</CodeBlock>
      </DocSection>

      {/* Color System */}
      <DocSection title={t("docs.brand.colors.title")}>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("docs.brand.colors.desc")}
        </p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.colors.th.name")}</TableHead>
                <TableHead>{t("docs.brand.colors.th.hex")}</TableHead>
                <TableHead>{t("docs.brand.colors.th.usage")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(
                [
                  "black",
                  "charcoal",
                  "white",
                  "grey-500",
                  "grey-800",
                  "near-black",
                  "near-white",
                ] as const
              ).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.brand.colors.rows.${k}.name`)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t(`docs.brand.colors.rows.${k}.hex`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.brand.colors.rows.${k}.usage`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm text-muted-foreground">{t("docs.brand.colors.accent-note")}</p>
      </DocSection>

      {/* Typography */}
      <DocSection title={t("docs.brand.typography.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.typography.th.role")}</TableHead>
                <TableHead>{t("docs.brand.typography.th.typeface")}</TableHead>
                <TableHead>{t("docs.brand.typography.th.weight")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["wordmark", "headings", "body-en", "body-zh", "code"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.brand.typography.rows.${k}.role`)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`docs.brand.typography.rows.${k}.typeface`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.brand.typography.rows.${k}.weight`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <CodeBlock>{`--font-sans: "Plus Jakarta Sans", "Noto Sans SC", system-ui, -apple-system, sans-serif;`}</CodeBlock>
      </DocSection>

      {/* Logo Usage Rules */}
      <DocSection title={t("docs.brand.usage.title")}>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("docs.brand.usage.approved")}
        </p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.usage.th.rule")}</TableHead>
                <TableHead>{t("docs.brand.usage.th.reason")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(
                [
                  "no-rotate",
                  "no-arc-angle",
                  "no-color",
                  "no-shadow",
                  "no-stretch",
                  "no-busy-bg",
                  "no-outline",
                  "no-raster",
                  "no-combine",
                  "no-dark-on-dark",
                  "no-font-change",
                  "no-capitalize",
                ] as const
              ).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.brand.usage.rows.${k}.rule`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.brand.usage.rows.${k}.reason`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DocSection>

      {/* Component Library & Icons */}
      <DocSection title={t("docs.brand.components.title")}>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("docs.brand.components.desc")}
        </p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.components.th.property")}</TableHead>
                <TableHead>{t("docs.brand.components.th.value")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["primitives", "styling", "radius", "icons", "icon-size"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.brand.components.rows.${k}.property`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.brand.components.rows.${k}.value`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DocSection>

      {/* Voice & Tone */}
      <DocSection title={t("docs.brand.voice.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.voice.th.attr")}</TableHead>
                <TableHead>{t("docs.brand.voice.th.guideline")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["technical", "concise", "developer", "neutral"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.brand.voice.rows.${k}.attr`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.brand.voice.rows.${k}.guideline`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DocSection>

      {/* Clear Space & Minimum Size */}
      <DocSection title={t("docs.brand.clear-space.title")}>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("docs.brand.clear-space.desc")}
        </p>
        <CodeBlock>{`          ┌─ 25% ─┐
     ┌────┬────────┬────┐
     │    │        │    │ 25%
     ├────┼────────┼────┤
     │    │  ICON  │    │
     ├────┼────────┼────┤
     │    │        │    │ 25%
     └────┴────────┴────┘`}</CodeBlock>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.clear-space.th.context")}</TableHead>
                <TableHead>{t("docs.brand.clear-space.th.min-size")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["favicon", "header", "print", "app-icon"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm">
                    {t(`docs.brand.clear-space.rows.${k}.context`)}
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    {t(`docs.brand.clear-space.rows.${k}.min-size`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">{t("docs.brand.clear-space.small-note")}</p>
      </DocSection>

      {/* Backgrounds & Surfaces */}
      <DocSection title={t("docs.brand.surfaces.title")}>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("docs.brand.surfaces.desc")}
        </p>
        <h4 className="text-sm font-semibold">{t("docs.brand.surfaces.dark-title")}</h4>
        <CodeBlock>{`Page background:    #0A0A0A  (oklch 0.145)
Card surface:       #1A1A1C  (oklch 0.205)
Elevated surface:   #2A2A2C  (oklch 0.269)`}</CodeBlock>
        <h4 className="text-sm font-semibold mt-4">{t("docs.brand.surfaces.light-title")}</h4>
        <CodeBlock>{`Page background:    #FFFFFF  (oklch 1.0)
Card surface:       #FFFFFF  (oklch 1.0)
Muted surface:      #F7F7F7  (oklch 0.97)`}</CodeBlock>
      </DocSection>

      {/* Motion & Animation */}
      <DocSection title={t("docs.brand.motion.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.motion.th.property")}</TableHead>
                <TableHead>{t("docs.brand.motion.th.value")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["transition", "hover", "page", "reduced", "scrollbar"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.brand.motion.rows.${k}.property`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.brand.motion.rows.${k}.value`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DocSection>

      {/* SEO & Social */}
      <DocSection title={t("docs.brand.seo.title")}>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("docs.brand.seo.desc")}</p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.seo.th.tag")}</TableHead>
                <TableHead>{t("docs.brand.seo.th.content")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["title-tag", "og-image", "twitter", "canonical", "hreflang"] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-mono">
                    {t(`docs.brand.seo.rows.${k}.tag`)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`docs.brand.seo.rows.${k}.content`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <h4 className="text-sm font-semibold mt-4">{t("docs.brand.seo.structured-title")}</h4>
        <p className="text-sm text-muted-foreground">{t("docs.brand.seo.structured-desc")}</p>
        <h4 className="text-sm font-semibold mt-4">{t("docs.brand.seo.files-title")}</h4>
        <p className="text-sm text-muted-foreground">{t("docs.brand.seo.files-desc")}</p>
      </DocSection>

      {/* Asset Files */}
      <DocSection title={t("docs.brand.assets.title")}>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("docs.brand.assets.th.asset")}</TableHead>
                <TableHead>{t("docs.brand.assets.th.location")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(
                [
                  "logo-dark",
                  "logo-light",
                  "favicon-svg",
                  "favicon-ico",
                  "apple-touch",
                  "og-image",
                  "manifest",
                  "robots",
                  "sitemap",
                  "logo-component",
                ] as const
              ).map((k) => (
                <TableRow key={k}>
                  <TableCell className="text-sm font-medium">
                    {t(`docs.brand.assets.rows.${k}.asset`)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t(`docs.brand.assets.rows.${k}.location`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DocSection>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="font-mono text-xs bg-muted rounded-lg p-4 overflow-x-auto whitespace-pre">
      <code>{children}</code>
    </pre>
  );
}
