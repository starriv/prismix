import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

// ── Provider definitions ────────────────────────────

const PROVIDERS = [
  { id: "openai", model: "gpt-4o", color: "#10a37f" },
  { id: "anthropic", model: "claude-4-sonnet", color: "#d4a27f" },
  { id: "gemini", model: "gemini-2.5-flash", color: "#EA4335" },
  { id: "azure", model: "gpt-4o (Azure)", color: "#0078d4" },
  { id: "bedrock", model: "claude-4-sonnet (AWS)", color: "#ff9900" },
] as const;

type ProviderEntry = (typeof PROVIDERS)[number];

// ── Timing ──────────────────────────────────────────

const STREAM_CHAR_MS = 18; // ms per character for streaming effect
const PAUSE_AFTER_STREAM_MS = 2200; // pause after streaming finishes
const CYCLE_TOTAL_MS = 6000; // total cycle time per provider (fallback)

// ── Conversations ───────────────────────────────────

interface ConversationEntry {
  promptKey: string;
  responseKey: string;
}

const CONVERSATIONS: ConversationEntry[] = [
  { promptKey: "home.hero-chat.q1", responseKey: "home.hero-chat.a1" },
  { promptKey: "home.hero-chat.q2", responseKey: "home.hero-chat.a2" },
  { promptKey: "home.hero-chat.q3", responseKey: "home.hero-chat.a3" },
  { promptKey: "home.hero-chat.q4", responseKey: "home.hero-chat.a4" },
  { promptKey: "home.hero-chat.q5", responseKey: "home.hero-chat.a5" },
];

// ── Streaming text hook ─────────────────────────────

function useStreamingText(text: string, active: boolean, charMs: number) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  // Reset streaming state when inputs change (render-time setState — React pattern
  // for adjusting state when a prop changes, avoids synchronous setState in effect).
  const [prevKey, setPrevKey] = useState("");
  const key = `${active}:${text}`;
  if (prevKey !== key) {
    setPrevKey(key);
    setDisplayed("");
    setDone(false);
  }

  useEffect(() => {
    if (!active) return;

    let i = 0;
    const id = setInterval(() => {
      i += 1;
      if (i >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(id);
      } else {
        setDisplayed(text.slice(0, i));
      }
    }, charMs);

    return () => clearInterval(id);
  }, [text, active, charMs]);

  return { displayed, done };
}

// ── Component ───────────────────────────────────────

export function HeroChat() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const provider = PROVIDERS[idx % PROVIDERS.length];
  const convo = CONVERSATIONS[idx % CONVERSATIONS.length];

  const prompt = t(convo.promptKey);
  const fullResponse = t(convo.responseKey);

  // Stream the response text
  const { displayed: streamedText, done: streamDone } = useStreamingText(
    fullResponse,
    true,
    reduced ? 0 : STREAM_CHAR_MS,
  );

  // Advance to next provider after streaming completes + pause
  const advance = useCallback(() => {
    setIdx((p) => (p + 1) % PROVIDERS.length);
  }, []);

  useEffect(() => {
    if (reduced) {
      // In reduced-motion: just cycle on a fixed timer
      const id = setInterval(advance, CYCLE_TOTAL_MS);
      return () => clearInterval(id);
    }

    if (streamDone) {
      const timer = setTimeout(advance, PAUSE_AFTER_STREAM_MS);
      timerRef.current = timer;
      return () => clearTimeout(timer);
    }
  }, [streamDone, advance, reduced]);

  return (
    <div className="relative mx-auto w-full max-w-2xl select-none" aria-hidden="true">
      {/* Chat window frame */}
      <div className="rounded-xl border border-border bg-card/80 backdrop-blur-sm shadow-xl overflow-hidden">
        {/* Title bar */}
        <TitleBar provider={provider} />

        {/* Chat body — fixed height to prevent layout shift between conversations */}
        <div className="px-5 py-4 space-y-4 h-[300px] overflow-hidden">
          {/* User prompt */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`prompt-${idx}`}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex justify-end"
            >
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-foreground/[0.06] dark:bg-foreground/[0.08] px-4 py-2.5">
                <p className="text-sm leading-relaxed">{prompt}</p>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* AI response */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`response-${idx}`}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3, delay: 0.15, ease: "easeOut" }}
              className="flex items-start gap-2.5"
            >
              {/* Provider avatar */}
              <div
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: provider.color }}
              >
                {provider.id[0].toUpperCase()}
              </div>

              <div className="min-w-0 flex-1 space-y-1.5">
                {/* Model badge */}
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono font-medium"
                    style={{
                      backgroundColor: `${provider.color}15`,
                      color: provider.color,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: provider.color }}
                    />
                    {provider.model}
                  </span>
                </div>

                {/* Streamed text */}
                <div className="rounded-2xl rounded-tl-md bg-muted/60 px-4 py-2.5">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {streamedText}
                    {/* Blinking cursor */}
                    {!streamDone && !reduced && (
                      <motion.span
                        className="inline-block w-[2px] h-[14px] align-text-bottom ml-0.5"
                        style={{ backgroundColor: provider.color }}
                        animate={{ opacity: [1, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }}
                      />
                    )}
                  </p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Bottom bar — endpoint hint */}
        <BottomBar provider={provider} />
      </div>

      {/* Ambient glow behind card */}
      {!reduced && (
        <div
          className="absolute -inset-4 -z-10 rounded-2xl opacity-[0.07] dark:opacity-[0.12] blur-2xl"
          style={{
            background: `radial-gradient(ellipse 60% 50% at 50% 50%, ${provider.color}, transparent)`,
            transition: "background 0.8s ease",
          }}
        />
      )}
    </div>
  );
}

// ── Title bar ───────────────────────────────────────

function TitleBar({ provider }: { provider: ProviderEntry }) {
  const reduced = useReducedMotion();

  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-muted/30">
      {/* Traffic lights */}
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-foreground/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-foreground/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-foreground/10" />
      </div>

      {/* Active provider indicator */}
      <AnimatePresence mode="wait">
        <motion.div
          key={provider.id}
          initial={reduced ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.25 }}
          className="flex items-center gap-1.5"
        >
          <span
            className="h-1.5 w-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: provider.color }}
          />
          <span className="text-[11px] font-mono text-muted-foreground">{provider.model}</span>
        </motion.div>
      </AnimatePresence>

      {/* Spacer for symmetry */}
      <div className="w-[52px]" />
    </div>
  );
}

// ── Bottom bar ──────────────────────────────────────

function BottomBar({ provider }: { provider: ProviderEntry }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2 bg-muted/20">
      <code className="text-[10px] font-mono text-muted-foreground/70">
        POST /v1/chat/completions
      </code>
      <div className="flex items-center gap-3">
        {PROVIDERS.map((p) => (
          <span
            key={p.id}
            className="h-1.5 w-1.5 rounded-full transition-all duration-500"
            style={{
              backgroundColor: p.id === provider.id ? p.color : "var(--color-muted-foreground)",
              opacity: p.id === provider.id ? 1 : 0.2,
              transform: p.id === provider.id ? "scale(1.4)" : "scale(1)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
