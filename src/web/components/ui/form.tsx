/**
 * Form components for react-hook-form + shadcn/ui integration.
 *
 * Based on the standard shadcn form pattern:
 * https://ui.shadcn.com/docs/components/form
 */
import * as React from "react";
import type { ControllerProps, FieldPath, FieldValues } from "react-hook-form";
import { Controller, FormProvider, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { cn } from "@/web/shared/utils";

import { Label } from "./label";

// ── Form (provider wrapper) ─────────────────────────────────────────

const Form = FormProvider;

// ── FormField context ───────────────────────────────────────────────

interface FormFieldContextValue {
  name: string;
}

const FormFieldContext = React.createContext<FormFieldContextValue>({ name: "" });

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

// ── useFormField hook ───────────────────────────────────────────────

function useFormField() {
  const { name } = React.useContext(FormFieldContext);
  const { getFieldState, formState } = useFormContext();
  const state = getFieldState(name, formState);
  return { name, ...state };
}

// ── FormItem ────────────────────────────────────────────────────────

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="form-item" className={cn("space-y-2", className)} {...props} />;
}

// ── FormLabel ───────────────────────────────────────────────────────

function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { error } = useFormField();
  return <Label className={cn(error && "text-destructive", className)} {...props} />;
}

// ── FormControl ─────────────────────────────────────────────────────

function FormControl({ ...props }: React.ComponentProps<"div">) {
  const { error, name } = useFormField();
  return <div data-slot="form-control" aria-invalid={!!error} id={name} {...props} />;
}

// ── FormMessage ─────────────────────────────────────────────────────

function FormMessage({ className, children, ...props }: React.ComponentProps<"p">) {
  const { error } = useFormField();
  const { t } = useTranslation();
  const raw = error?.message ?? children;
  if (!raw) return null;
  // Translate i18n keys (e.g. "res.valid.name-required"), pass through plain text
  const body = typeof raw === "string" && raw.includes(".") ? t(raw) : raw;
  return (
    <p
      data-slot="form-message"
      className={cn("text-xs text-destructive", className)}
      role="alert"
      {...props}
    >
      {body}
    </p>
  );
}

// ── FormDescription ─────────────────────────────────────────────────

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="form-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
};
