/**
 * SecretInput — masked text input for API keys, tokens, and secrets.
 *
 * Uses CSS `-webkit-text-security: disc` instead of `type="password"` to
 * avoid browser "Save password?" prompts. Includes anti-autofill attributes
 * for 1Password, LastPass, and native browser autofill.
 *
 * DO NOT use for login passwords — those should remain `type="password"`
 * with `autoComplete="current-password"` so the browser can remember them.
 */
import { useCallback, useState } from "react";

import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { cn } from "@/web/shared/utils";

interface SecretInputProps extends Omit<
  React.ComponentProps<typeof Input>,
  "type" | "autoComplete" | "style"
> {
  /** Show the Eye/EyeOff toggle button. @default true */
  showToggle?: boolean;
}

function SecretInput({ className, showToggle = true, ...props }: SecretInputProps) {
  const [visible, setVisible] = useState(false);

  const handleToggle = useCallback(() => setVisible((v) => !v), []);

  const input = (
    <Input
      type="text"
      style={visible ? undefined : ({ WebkitTextSecurity: "disc" } as React.CSSProperties)}
      autoComplete="one-time-code"
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
      className={cn("font-mono", showToggle && "pr-9", className)}
      {...props}
    />
  );

  if (!showToggle) return input;

  return (
    <div className="relative">
      {input}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0 h-8 w-8"
        onClick={handleToggle}
        tabIndex={-1}
        aria-label={visible ? "Hide secret" : "Show secret"}
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

export { SecretInput };
