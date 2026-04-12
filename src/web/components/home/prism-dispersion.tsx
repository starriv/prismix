import { lazy, Suspense, useRef } from "react";

/**
 * Lazy-loaded 3D prism dispersion — only the homepage pays the Three.js cost.
 * The heavy Canvas + Three.js bundle (~300KB) is code-split via React.lazy().
 */

const PrismScene = lazy(() => import("./prism-scene"));

export function PrismDispersion() {
  return (
    <div
      className="relative w-full max-w-[520px] aspect-square mx-auto select-none pointer-events-none"
      aria-hidden="true"
    >
      <Suspense fallback={<PrismFallback />}>
        <PrismScene />
      </Suspense>
    </div>
  );
}

// ── Minimal SVG fallback while Three.js loads ───────

function PrismFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg
        width="120"
        height="156"
        viewBox="0 0 120 156"
        fill="none"
        className="opacity-10 animate-pulse"
      >
        <polygon
          points="60,0 0,130 120,130"
          strokeWidth="1.5"
          className="stroke-foreground"
          fill="none"
        />
      </svg>
    </div>
  );
}
