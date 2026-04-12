import { useCallback, useEffect, useRef, useState } from "react";

const RESET_DELAY = 2000;

/**
 * Simple clipboard copy with auto-resetting `copied` flag.
 * Cleans up the timer on unmount — no memory leaks.
 */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), RESET_DELAY);
  }, []);

  return { copy, copied } as const;
}

/**
 * Clipboard copy that tracks *which* item was copied (by id).
 * `isCopied(id)` returns true only for the last-copied item.
 */
export function useCopyById<T extends string | number = number>() {
  const [copiedId, setCopiedId] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback((text: string, id: T) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiedId(null), RESET_DELAY);
  }, []);

  const isCopied = useCallback((id: T) => copiedId === id, [copiedId]);

  return { copy, isCopied, copiedId } as const;
}
