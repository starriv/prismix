import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { BarChart3, Check, Copy, DollarSign, KeyRound, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useAdminUserDetail,
  useCreateUserAgent,
  useDeleteUser,
  useDisableUser,
  useEnableUser,
  useUpdateUser,
} from "@/web/api/admin-hooks";
import { usePayAgents } from "@/web/api/hooks";
import type { UserInfo } from "@/web/api/schemas";
import { LocaleLink } from "@/web/components/locale-link";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";
import { LongText } from "@/web/components/ui/long-text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { SheetBody, SheetFooter, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import { Switch } from "@/web/components/ui/switch";
import { WalletAddress } from "@/web/components/ui/wallet-address";
import { useCopy } from "@/web/hooks/use-copy";

import { CreditDialog } from "./credit-dialog";

const editUserSchema = z.object({
  name: z.string().min(1, "common.valid.name-required").max(200),
  email: z.string().email("common.valid.invalid-email").or(z.literal("")).optional(),
  agentId: z.string().optional(),
});

export function UserDetailSheet({ user, onClose }: { user: UserInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const updateUser = useUpdateUser();
  const disableUser = useDisableUser();
  const enableUser = useEnableUser();
  const deleteUser = useDeleteUser();
  const createAgent = useCreateUserAgent();
  const { data: agents = [] } = usePayAgents();
  const { data: userDetail } = useAdminUserDetail(user.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const { copy, copied } = useCopy();

  const isActive = user.status === 1;

  const form = useForm<z.infer<typeof editUserSchema>>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      name: user.name,
      email: user.email ?? "",
      agentId: user.agentId ? String(user.agentId) : "none",
    },
  });

  useEffect(() => {
    form.reset({
      name: user.name,
      email: user.email ?? "",
      agentId: user.agentId ? String(user.agentId) : "none",
    });
  }, [user, form]);

  // Reset confirm-delete flag when user changes (render-time setState — React
  // pattern for adjusting state when a prop changes, avoids synchronous setState in effect).
  const [prevUser, setPrevUser] = useState(user);
  if (prevUser !== user) {
    setPrevUser(user);
    setConfirmDelete(false);
  }

  const handleSave = form.handleSubmit(async (data) => {
    try {
      const agentId =
        data.agentId === "none" ? null : data.agentId ? Number(data.agentId) : undefined;
      await updateUser.mutateAsync({
        id: user.id,
        name: data.name,
        email: data.email || undefined,
        agentId,
      });
      toast.success(t("admin.users.toast.updated"));
      onClose();
    } catch {
      toast.error(t("admin.users.toast.update-error"));
    }
  });

  const handleToggleStatus = useCallback(async () => {
    try {
      if (isActive) {
        await disableUser.mutateAsync(user.id);
        toast.success(t("admin.users.toast.disabled"));
      } else {
        await enableUser.mutateAsync(user.id);
        toast.success(t("admin.users.toast.enabled"));
      }
    } catch {
      toast.error(
        isActive ? t("admin.users.toast.disable-error") : t("admin.users.toast.enable-error"),
      );
    }
  }, [isActive, disableUser, enableUser, user.id, t]);

  const handleCreateAgent = useCallback(async () => {
    try {
      await createAgent.mutateAsync(user.id);
      toast.success(t("admin.users.toast.agent-created"));
    } catch {
      toast.error(t("admin.users.toast.agent-create-error"));
    }
  }, [createAgent, user.id, t]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteUser.mutateAsync(user.id);
      toast.success(t("admin.users.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.users.toast.delete-error"));
    }
  }, [confirmDelete, deleteUser, user.id, t, onClose]);

  return (
    <Form {...form}>
      <SheetHeader className="border-b pb-4">
        <SheetTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          {user.name}
        </SheetTitle>
      </SheetHeader>

      <SheetBody className="space-y-5">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs text-muted-foreground">User #{user.id}</p>
                <div className="flex items-start gap-2">
                  <LongText value={user.uuid} head={8} tail={6} emptyText="---" />
                  {user.uuid && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => copy(user.uuid!)}
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {user.createdAt ? new Date(user.createdAt).toLocaleString() : "---"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                  <LocaleLink to={`/admin/ai-usage?user=${user.id}`}>
                    <BarChart3 className="h-3.5 w-3.5" />
                  </LocaleLink>
                </Button>
                <span className="text-xs text-muted-foreground">
                  {isActive ? t("admin.users.status.active") : t("admin.users.status.disabled")}
                </span>
                <Switch
                  checked={isActive}
                  onCheckedChange={handleToggleStatus}
                  disabled={disableUser.isPending || enableUser.isPending}
                />
              </div>
            </div>

            {user.address && <WalletAddress address={user.address} className="pt-1" />}
          </CardContent>
        </Card>

        {user.providers && user.providers.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("admin.users.detail.auth")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {user.providers.map((provider) => (
                  <Badge key={provider} variant="outline" className="text-xs gap-1">
                    <KeyRound className="h-3 w-3" />
                    {provider}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("admin.users.detail.info")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">{t("admin.users.form.name")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("admin.users.form.name-ph")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">{t("admin.users.form.email")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("admin.users.form.email-ph")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("admin.users.form.agent")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField
              control={form.control}
              name="agentId"
              render={({ field }) => (
                <FormItem>
                  <div className="flex gap-2">
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("admin.users.form.agent-ph")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("admin.users.form.no-agent")}</SelectItem>
                        {agents.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.name}
                            {a.userId && a.userId !== user.id ? ` (User #${a.userId})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={handleCreateAgent}
                      disabled={createAgent.isPending}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {user.agentId && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("admin.users.detail.wallet")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">{t("admin.users.detail.balance")}</p>
                <p className="text-2xl font-bold">
                  {userDetail?.wallet?.balance ?? "---"}{" "}
                  <span className="text-sm font-normal text-muted-foreground">USDC</span>
                </p>
              </div>
              <Button size="sm" onClick={() => setCreditOpen(true)}>
                <DollarSign className="mr-1 h-3.5 w-3.5" />
                {t("admin.users.credit-title")}
              </Button>
            </CardContent>
          </Card>
        )}
      </SheetBody>

      <SheetFooter>
        {confirmDelete && (
          <p className="text-sm text-destructive mb-2">{t("admin.users.delete-confirm")}</p>
        )}
        <div className="flex gap-2 w-full">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteUser.isPending}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {confirmDelete ? t("common.btn.confirm") : t("admin.users.delete-title")}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateUser.isPending}>
            {t("common.btn.save")}
          </Button>
        </div>
      </SheetFooter>

      {creditOpen && <CreditDialog user={user} onClose={() => setCreditOpen(false)} />}
    </Form>
  );
}
