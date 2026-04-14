import { useCallback, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { API_USER_PROFILE } from "@/web/api/constants";
import { userPut } from "@/web/api/user-client";
import { useUserProfile, useUserWallet, useWalletDepositInfo } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Skeleton } from "@/web/components/ui/skeleton";
import { WalletAddress } from "@/web/components/ui/wallet-address";
import { useCopy } from "@/web/hooks/use-copy";
import { useUserAuthContext } from "@/web/providers/user-auth-provider";
import { useChainRegistry } from "@/web/shared/chains";

const profileSchema = z.object({
  name: z.string().min(1, "common.valid.name-required").max(100),
});

type ProfileForm = z.infer<typeof profileSchema>;

export default function UserSettingsPage() {
  const { t } = useTranslation();
  const { user } = useUserAuthContext();
  const { data: profile, isLoading } = useUserProfile();
  const { data: wallet } = useUserWallet();
  const { data: depositInfo, isLoading: isDepositInfoLoading } = useWalletDepositInfo();
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const { copy, copied } = useCopy();
  const walletExplorerUrl = useMemo(() => {
    const networkId = depositInfo?.networks[0]?.networkId;
    if (!networkId) return undefined;
    return getChainDisplayByNetworkId(networkId)?.explorerUrl;
  }, [depositInfo?.networks, getChainDisplayByNetworkId]);

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: "" },
  });

  useEffect(() => {
    if (profile) {
      form.reset({ name: profile.name });
    }
  }, [profile, form]);

  const handleSubmit = useCallback(
    async (data: ProfileForm) => {
      try {
        await userPut(API_USER_PROFILE, data, z.object({ name: z.string() }));
        toast.success(t("user.settings.toast.updated"));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
      }
    },
    [t],
  );

  return (
    <div>
      <Header title={t("user.settings.title")} description={t("user.settings.desc")} />

      <div
        className="grid gap-6 p-4 md:p-8"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))" }}
      >
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("user.settings.profile-title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("user.settings.name-label")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div>
                    <Label>{t("user.settings.email-label")}</Label>
                    <Input value={user?.email ?? "—"} readOnly className="mt-1.5 bg-muted" />
                  </div>

                  <div>
                    <Label>{t("user.settings.uuid-label")}</Label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Input
                        value={user?.uuid ?? profile?.uuid ?? "—"}
                        readOnly
                        className="bg-muted font-mono"
                      />
                      {(user?.uuid ?? profile?.uuid) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => copy((user?.uuid ?? profile?.uuid)!)}
                        >
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
                    {t("user.settings.save")}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("user.settings.wallet-title")}</CardTitle>
            <CardDescription>{t("user.settings.wallet-desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t("user.settings.wallet-address")}</Label>
              {wallet?.address ? (
                <div className="mt-1.5 rounded-xl bg-secondary/60 px-3 py-2.5">
                  <WalletAddress
                    address={wallet.address}
                    explorerUrl={walletExplorerUrl}
                    className="pt-0"
                  />
                </div>
              ) : (
                <div className="mt-1.5 rounded-xl bg-secondary/60 px-3 py-2.5 text-sm text-muted-foreground">
                  {t("user.settings.wallet-address-empty")}
                </div>
              )}
            </div>

            <div>
              <Label>{t("user.settings.wallet-networks")}</Label>
              {isDepositInfoLoading ? (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              ) : depositInfo?.networks.length ? (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {depositInfo.networks.map((network) => {
                    const chain = getChainDisplayByNetworkId(network.networkId);
                    return (
                      <Badge key={network.networkId} variant="secondary" className="h-7 px-3">
                        {chain?.shortName ?? network.name}
                      </Badge>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-1.5 rounded-xl bg-secondary/60 px-3 py-2.5 text-sm text-muted-foreground">
                  {t("user.settings.wallet-networks-empty")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
