import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Check, X } from "lucide-react";

import { cn } from "@/web/shared/utils";

interface PasswordStrengthProps {
  password: string;
}

interface Rule {
  key: string;
  test: (pw: string) => boolean;
}

const RULES: Rule[] = [
  { key: "length", test: (pw) => pw.length >= 10 },
  { key: "upper", test: (pw) => /[A-Z]/.test(pw) },
  { key: "lower", test: (pw) => /[a-z]/.test(pw) },
  { key: "digit", test: (pw) => /\d/.test(pw) },
];

const LEVELS = ["weak", "fair", "good", "strong"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_COLORS: Record<Level, string> = {
  weak: "bg-red-500",
  fair: "bg-yellow-500",
  good: "bg-blue-500",
  strong: "bg-green-500",
};

const LEVEL_TEXT_COLORS: Record<Level, string> = {
  weak: "text-red-500",
  fair: "text-yellow-500",
  good: "text-blue-500",
  strong: "text-green-500",
};

function getLevel(passed: number): Level {
  if (passed <= 1) return "weak";
  if (passed === 2) return "fair";
  if (passed === 3) return "good";
  return "strong";
}

/** Returns true when all server-side password rules are satisfied. */
export function isPasswordValid(password: string): boolean {
  return RULES.every((r) => r.test(password));
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const { t } = useTranslation();

  const results = useMemo(() => RULES.map((r) => ({ ...r, passed: r.test(password) })), [password]);
  const passed = results.filter((r) => r.passed).length;
  const level = getLevel(passed);

  return (
    <div className="space-y-3">
      {/* Strength bar */}
      <div className="space-y-1.5">
        <div className="flex gap-1">
          {LEVELS.map((l, i) => (
            <div
              key={l}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < passed ? LEVEL_COLORS[level] : "bg-muted",
              )}
            />
          ))}
        </div>
        {password.length > 0 && (
          <p className={cn("text-xs font-medium", LEVEL_TEXT_COLORS[level])}>
            {t(`auth.strength.${level}`)}
          </p>
        )}
      </div>

      {/* Rule checklist */}
      <ul className="space-y-1">
        {results.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            {r.passed ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <X className="h-3 w-3 text-muted-foreground/50" />
            )}
            <span className={cn(r.passed ? "text-muted-foreground" : "text-muted-foreground/50")}>
              {t(`auth.strength.rule-${r.key}`)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
