import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { Copy, MoreHorizontal, RotateCw, ShieldOff, Trash2 } from "lucide-react";

import type { ApiKey } from "@/web/api/schemas";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/web/components/ui/table";

interface ApiKeyRowProps {
  apiKey: ApiKey;
  onCopyClientId: (clientId: string) => void;
  onAction: (action: { type: "revoke" | "rotate" | "delete"; key: ApiKey }) => void;
}

export function ApiKeyRow({ apiKey, onCopyClientId, onAction }: ApiKeyRowProps) {
  const { t } = useTranslation();
  const isActive = apiKey.status === "active";

  const handleCopy = useCallback(() => {
    onCopyClientId(apiKey.clientId);
  }, [onCopyClientId, apiKey.clientId]);

  const handleRevoke = useCallback(() => {
    onAction({ type: "revoke", key: apiKey });
  }, [onAction, apiKey]);

  const handleRotate = useCallback(() => {
    onAction({ type: "rotate", key: apiKey });
  }, [onAction, apiKey]);

  const handleDelete = useCallback(() => {
    onAction({ type: "delete", key: apiKey });
  }, [onAction, apiKey]);

  return (
    <TableRow>
      <TableCell className="font-medium">{apiKey.name}</TableCell>
      <TableCell>
        <code className="font-mono text-xs text-muted-foreground">{apiKey.clientId}</code>
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
        {apiKey.lastUsedAt
          ? formatDistanceToNow(new Date(apiKey.lastUsedAt), { addSuffix: true })
          : t("settings.api-keys.never-used")}
      </TableCell>
      <TableCell>
        <Badge variant={isActive ? "default" : "destructive"}>
          {isActive ? t("common.status.active") : t("common.status.disabled")}
        </Badge>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t("common.a11y.actions")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isActive && (
              <>
                <DropdownMenuItem onClick={handleCopy}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  {t("settings.api-keys.action.copy-id")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRotate}>
                  <RotateCw className="mr-2 h-3.5 w-3.5" />
                  {t("settings.api-keys.action.rotate")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleRevoke} className="text-destructive">
                  <ShieldOff className="mr-2 h-3.5 w-3.5" />
                  {t("settings.api-keys.action.revoke")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {t("settings.api-keys.action.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
