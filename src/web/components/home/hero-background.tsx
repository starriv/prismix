import { useCallback, useRef } from "react";

export function HeroBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
    el.style.setProperty("--spotlight", "1");
  }, []);

  const handleMouseLeave = useCallback(() => {
    const el = containerRef.current;
    if (el) el.style.setProperty("--spotlight", "0");
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-auto absolute inset-0 top-14 overflow-hidden"
      style={{ "--mx": "-999px", "--my": "-999px", "--spotlight": "0" } as React.CSSProperties}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* ── Spectral gradient mesh (slow drift) ── */}
      <div
        className="animate-gradient-shift absolute inset-0 opacity-[0.03] dark:opacity-[0.06]"
        style={{
          background: [
            "radial-gradient(ellipse 70% 50% at 25% 35%, oklch(0.6 0.2 0), transparent)",
            "radial-gradient(ellipse 50% 60% at 50% 50%, oklch(0.55 0.18 140), transparent)",
            "radial-gradient(ellipse 60% 70% at 75% 65%, oklch(0.5 0.2 260), transparent)",
          ].join(","),
        }}
      />

      {/* ── Base grid ── */}
      <div
        className="absolute inset-0 opacity-[0.06] dark:opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px)," +
            "linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* ── Prismatic RGB grid — chromatic aberration near cursor ── */}
      {/* Red channel — offset top-left */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: "calc(var(--spotlight) * 0.5)",
          backgroundImage:
            "linear-gradient(to right, oklch(0.7 0.3 20) 1px, transparent 1px)," +
            "linear-gradient(to bottom, oklch(0.7 0.3 20) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          backgroundPosition: "-3px -2px",
          mask: "radial-gradient(circle 150px at var(--mx) var(--my), black 0%, transparent 100%)",
          WebkitMask:
            "radial-gradient(circle 150px at var(--mx) var(--my), black 0%, transparent 100%)",
        }}
      />
      {/* Green channel — centered */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: "calc(var(--spotlight) * 0.55)",
          backgroundImage:
            "linear-gradient(to right, oklch(0.75 0.25 145) 1px, transparent 1px)," +
            "linear-gradient(to bottom, oklch(0.75 0.25 145) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          mask: "radial-gradient(circle 160px at var(--mx) var(--my), black 0%, transparent 100%)",
          WebkitMask:
            "radial-gradient(circle 160px at var(--mx) var(--my), black 0%, transparent 100%)",
        }}
      />
      {/* Blue channel — offset bottom-right */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: "calc(var(--spotlight) * 0.5)",
          backgroundImage:
            "linear-gradient(to right, oklch(0.65 0.28 265) 1px, transparent 1px)," +
            "linear-gradient(to bottom, oklch(0.65 0.28 265) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          backgroundPosition: "3px 2px",
          mask: "radial-gradient(circle 150px at var(--mx) var(--my), black 0%, transparent 100%)",
          WebkitMask:
            "radial-gradient(circle 150px at var(--mx) var(--my), black 0%, transparent 100%)",
        }}
      />

      {/* ── Prismatic glow halos ── */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: "var(--spotlight)",
          background: [
            `radial-gradient(circle 180px at calc(var(--mx) - 24px) calc(var(--my) - 16px), oklch(0.7 0.3 15 / 0.18), transparent)`,
            `radial-gradient(circle 220px at var(--mx) var(--my), oklch(0.7 0.24 145 / 0.12), transparent)`,
            `radial-gradient(circle 180px at calc(var(--mx) + 24px) calc(var(--my) + 16px), oklch(0.65 0.3 265 / 0.18), transparent)`,
          ].join(","),
        }}
      />
    </div>
  );
}
