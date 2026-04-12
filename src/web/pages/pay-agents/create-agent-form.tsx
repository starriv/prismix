import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { useCreatePayAgent } from "@/web/api/hooks";
import { Button } from "@/web/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";

import { createFormSchema, type CreateFormValues } from "./helpers";

export function CreatePayAgentForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const createPayAgent = useCreatePayAgent();

  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    defaultValues: { name: "", description: "" },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await createPayAgent.mutateAsync(data);
      toast.success(t("agents.toast.created"));
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agents.toast.create-error"));
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4 mt-4 pb-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("agents.form.name")}</FormLabel>
              <FormControl>
                <Input placeholder={t("agents.form.name-ph")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("agents.form.description")}</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={createPayAgent.isPending}>
          {t("agents.btn.create")}
        </Button>
      </form>
    </Form>
  );
}
