import { useCallback, useState } from "react";

import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { cn } from "@/web/shared/utils";

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type">;

function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  const handleToggle = useCallback(() => setVisible((value) => !value), []);

  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-9", className)} {...props} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0 h-8 w-8"
        onClick={handleToggle}
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

export { PasswordInput };
