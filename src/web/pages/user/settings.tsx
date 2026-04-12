import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";

import { API_USER_PROFILE } from "@/web/api/constants";
import { userPut } from "@/web/api/user-client";
import { useUserProfile } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
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
import { Skeleton } from "@/web/components/ui/skeleton";
import { useUserAuthContext } from "@/web/providers/user-auth-provider";

const profileSchema = z.object({
  name: z.string().min(1, "common.valid.name-required").max(100),
});

type ProfileForm = z.infer<typeof profileSchema>;

export default function UserSettingsPage() {
  const { t } = useTranslation();
  const { user } = useUserAuthContext();
  const { data: profile, isLoading } = useUserProfile();

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

      <div className="p-4 md:p-8 space-y-6">
        <Card className="max-w-lg">
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
                    <label className="text-sm font-medium">{t("user.settings.email-label")}</label>
                    <Input value={user?.email ?? "—"} readOnly className="mt-1.5 bg-muted" />
                  </div>

                  <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
                    {t("user.settings.save")}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
