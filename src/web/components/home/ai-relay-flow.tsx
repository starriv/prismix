import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { motion, useReducedMotion } from "motion/react";

// ── Providers ────────────────────────────────────────

const PROVIDERS = [
  { id: "openai", label: "OpenAI", color: "#10a37f" },
  { id: "anthropic", label: "Anthropic", color: "#d4a27f" },
  { id: "gemini", label: "Gemini", color: "#EA4335" },
  { id: "azure", label: "Azure", color: "#0078d4" },
  { id: "bedrock", label: "Bedrock", color: "#ff9900" },
] as const;

const KEY_COUNT = 3; // visual key indicators per gateway
const CYCLE_MS = 2800;

// ── Layout (viewBox 800×310) ─────────────────────────

const VB_W = 800;
const VB_H = 310;

const CONSUMER_CX = 90;
const GATEWAY_CX = 400;
const PROVIDER_CX = 710;
const CENTER_Y = 168;

// Node sizes
const CONSUMER_R = 24;
const GATEWAY_HW = 44;
const GATEWAY_HH = 26;
const PROVIDER_HW = 38;
const PROVIDER_HH = 15;

// Edge coordinates
const CONSUMER_RIGHT = CONSUMER_CX + CONSUMER_R;
const GATEWAY_LEFT = GATEWAY_CX - GATEWAY_HW;
const GATEWAY_RIGHT = GATEWAY_CX + GATEWAY_HW;
const PROVIDER_LEFT = PROVIDER_CX - PROVIDER_HW;

const providerYs = PROVIDERS.map((_, i) => 30 + i * 54);

// ── Bezier helpers ───────────────────────────────────

function fanCurve(py: number): string {
  const cpx = GATEWAY_RIGHT + (PROVIDER_LEFT - GATEWAY_RIGHT) * 0.4;
  return `M ${GATEWAY_RIGHT} ${CENTER_Y} Q ${cpx} ${py}, ${PROVIDER_LEFT} ${py}`;
}

function reqCurve(py: number): string {
  const cpx = GATEWAY_RIGHT + (PROVIDER_LEFT - GATEWAY_RIGHT) * 0.4;
  return `M ${CONSUMER_RIGHT} ${CENTER_Y} L ${GATEWAY_CX} ${CENTER_Y} L ${GATEWAY_RIGHT} ${CENTER_Y} Q ${cpx} ${py}, ${PROVIDER_LEFT} ${py}`;
}

function resCurve(py: number): string {
  const cpx = GATEWAY_RIGHT + (PROVIDER_LEFT - GATEWAY_RIGHT) * 0.4;
  return `M ${PROVIDER_LEFT} ${py} Q ${cpx} ${py}, ${GATEWAY_RIGHT} ${CENTER_Y} L ${GATEWAY_CX} ${CENTER_Y} L ${CONSUMER_RIGHT} ${CENTER_Y}`;
}

// ── Component ────────────────────────────────────────

export function AiRelayFlow() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeKeyIdx, setActiveKeyIdx] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setActiveIdx((p) => (p + 1) % PROVIDERS.length);
      setActiveKeyIdx((p) => (p + 1) % KEY_COUNT);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [reduced]);

  const activeProvider = PROVIDERS[activeIdx];
  const activeY = providerYs[activeIdx];

  const reqPath = useMemo(() => reqCurve(activeY), [activeY]);
  const resPath = useMemo(() => resCurve(activeY), [activeY]);

  return (
    <div className="relative mx-auto w-full max-w-3xl select-none" aria-hidden="true">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-auto"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={`glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id={`particle-${uid}`}>
            <stop offset="0%" stopColor={activeProvider.color} stopOpacity="1" />
            <stop offset="50%" stopColor={activeProvider.color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={activeProvider.color} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ── Trunk: consumer → gateway ── */}
        <line
          x1={CONSUMER_RIGHT}
          y1={CENTER_Y}
          x2={GATEWAY_LEFT}
          y2={CENTER_Y}
          stroke="var(--color-foreground)"
          strokeWidth="1"
          strokeDasharray="5 4"
          opacity={0.12}
        />

        {/* ── Fan curves: inactive (dashed) ── */}
        {PROVIDERS.map((p, i) => (
          <path
            key={p.id}
            d={fanCurve(providerYs[i])}
            fill="none"
            stroke="var(--color-foreground)"
            strokeWidth="1"
            strokeLinecap="round"
            strokeDasharray="5 4"
            opacity={0.12}
          />
        ))}

        {/* ── Fan curve: active highlight ── */}
        {!reduced && (
          <motion.path
            key={`fan-active-${activeIdx}`}
            d={fanCurve(activeY)}
            fill="none"
            stroke={activeProvider.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            filter={`url(#glow-${uid})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.85 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        )}

        {/* ── Active trunk highlight ── */}
        {!reduced && (
          <motion.line
            key={`trunk-${activeIdx}`}
            x1={CONSUMER_RIGHT}
            y1={CENTER_Y}
            x2={GATEWAY_LEFT}
            y2={CENTER_Y}
            stroke={activeProvider.color}
            strokeWidth="2"
            strokeLinecap="round"
            filter={`url(#glow-${uid})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ duration: 0.3 }}
          />
        )}

        {/* ── Request particle ── */}
        {!reduced && (
          <>
            <motion.circle
              key={`trail-${activeIdx}`}
              r="8"
              fill={`url(#particle-${uid})`}
              initial={{ offsetDistance: "0%" }}
              animate={{ offsetDistance: "100%" }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
              style={{ offsetPath: `path('${reqPath}')` }}
            />
            <motion.circle
              key={`req-${activeIdx}`}
              r="3"
              fill={activeProvider.color}
              initial={{ offsetDistance: "0%" }}
              animate={{ offsetDistance: "100%" }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
              style={{ offsetPath: `path('${reqPath}')` }}
            />
          </>
        )}

        {/* ── Response particle ── */}
        {!reduced && (
          <>
            <motion.circle
              key={`res-trail-${activeIdx}`}
              r="6"
              fill={`url(#particle-${uid})`}
              opacity={0.5}
              initial={{ offsetDistance: "0%" }}
              animate={{ offsetDistance: "100%" }}
              transition={{ duration: 1.0, delay: 1.4, ease: "easeInOut" }}
              style={{ offsetPath: `path('${resPath}')` }}
            />
            <motion.circle
              key={`res-${activeIdx}`}
              r="2.5"
              fill={activeProvider.color}
              opacity={0.7}
              initial={{ offsetDistance: "0%" }}
              animate={{ offsetDistance: "100%" }}
              transition={{ duration: 1.0, delay: 1.4, ease: "easeInOut" }}
              style={{ offsetPath: `path('${resPath}')` }}
            />
          </>
        )}

        {/* ── Consumer node ── */}
        <g>
          <circle
            cx={CONSUMER_CX}
            cy={CENTER_Y}
            r={CONSUMER_R}
            className="fill-muted stroke-border"
            strokeWidth="1"
          />
          <circle
            cx={CONSUMER_CX}
            cy={CENTER_Y}
            r={CONSUMER_R - 5}
            className="fill-background stroke-border"
            strokeWidth="0.5"
            opacity="0.5"
          />
          <text
            x={CONSUMER_CX}
            y={CENTER_Y + 1}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground text-[10px] font-semibold"
          >
            API
          </text>
          <text
            x={CONSUMER_CX}
            y={CENTER_Y + 42}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {t("home.ai.flow.consumer")}
          </text>
        </g>

        {/* ── Gateway node ── */}
        <g>
          {/* Outer glow ring */}
          {!reduced && (
            <motion.rect
              x={GATEWAY_LEFT - 3}
              y={CENTER_Y - GATEWAY_HH - 3}
              width={(GATEWAY_HW + 3) * 2}
              height={(GATEWAY_HH + 3) * 2}
              rx="15"
              fill="none"
              animate={{
                stroke: [
                  `${activeProvider.color}00`,
                  `${activeProvider.color}30`,
                  `${activeProvider.color}00`,
                ],
              }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
              strokeWidth="1"
            />
          )}
          <rect
            x={GATEWAY_LEFT}
            y={CENTER_Y - GATEWAY_HH}
            width={GATEWAY_HW * 2}
            height={GATEWAY_HH * 2}
            rx="12"
            className="fill-muted stroke-border"
            strokeWidth="1.5"
          />
          <text
            x={GATEWAY_CX}
            y={CENTER_Y + 1}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground text-[11px] font-bold"
          >
            {t("home.ai.flow.gateway")}
          </text>

          {/* ── Key pool indicator: 3 dots above gateway ── */}
          {Array.from({ length: KEY_COUNT }, (_, k) => {
            const dotX = GATEWAY_CX + (k - 1) * 12;
            const dotY = CENTER_Y - GATEWAY_HH - 12;
            const isActiveKey = k === activeKeyIdx;
            return (
              <g key={k}>
                <motion.circle
                  cx={dotX}
                  cy={dotY}
                  r="3.5"
                  className="stroke-border"
                  strokeWidth="0.5"
                  animate={{
                    fill: isActiveKey ? activeProvider.color : "var(--color-muted)",
                    opacity: isActiveKey ? 1 : 0.4,
                  }}
                  transition={{ duration: 0.3 }}
                />
                {/* Pulse ring on active key */}
                {isActiveKey && !reduced && (
                  <motion.circle
                    cx={dotX}
                    cy={dotY}
                    r="3.5"
                    fill="none"
                    stroke={activeProvider.color}
                    strokeWidth="1"
                    initial={{ r: 3.5, opacity: 0.6 }}
                    animate={{ r: 8, opacity: 0 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
              </g>
            );
          })}

          {/* Key pool label */}
          <text
            x={GATEWAY_CX}
            y={CENTER_Y - GATEWAY_HH - 24}
            textAnchor="middle"
            className="fill-muted-foreground text-[8px]"
          >
            {t("home.ai.flow.key-pool")}
          </text>
        </g>

        {/* ── Provider nodes ── */}
        {PROVIDERS.map((p, i) => {
          const py = providerYs[i];
          const isActive = i === activeIdx;
          return (
            <g key={p.id}>
              <motion.rect
                x={PROVIDER_LEFT}
                y={py - PROVIDER_HH}
                width={PROVIDER_HW * 2}
                height={PROVIDER_HH * 2}
                rx="8"
                strokeWidth={isActive ? "1.5" : "1"}
                animate={{
                  fill: isActive ? `${p.color}18` : "var(--color-muted)",
                  stroke: isActive ? p.color : "var(--color-border)",
                  opacity: isActive ? 1 : 0.55,
                }}
                transition={{ duration: 0.4 }}
              />
              <motion.circle
                cx={PROVIDER_LEFT + 12}
                cy={py}
                r="3"
                animate={{
                  fill: isActive ? p.color : "var(--color-muted-foreground)",
                  opacity: isActive ? 1 : 0.35,
                }}
                transition={{ duration: 0.3 }}
              />
              {isActive && !reduced && (
                <motion.circle
                  cx={PROVIDER_LEFT + 12}
                  cy={py}
                  r="3"
                  fill="none"
                  stroke={p.color}
                  strokeWidth="1"
                  initial={{ r: 3, opacity: 0.6 }}
                  animate={{ r: 8, opacity: 0 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                />
              )}
              <motion.text
                x={PROVIDER_CX + 4}
                y={py + 1}
                textAnchor="middle"
                dominantBaseline="central"
                className="text-[10px] font-medium"
                animate={{
                  fill: isActive ? "var(--color-foreground)" : "var(--color-muted-foreground)",
                  opacity: isActive ? 1 : 0.45,
                }}
                transition={{ duration: 0.4 }}
              >
                {p.label}
              </motion.text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
