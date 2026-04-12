import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { parseUnits } from "viem";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { useAllowedTokens, useTopupPayAgent } from "@/web/api/hooks";
import type { PayAgent as PayAgentType } from "@/web/api/schemas";
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
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { USDC_ABI, useChainRegistry } from "@/web/shared/chains";

import { topupSchema, type TopupValues } from "./helpers";

export function TopupForm({ agent }: { agent: PayAgentType }) {
  const { t } = useTranslation();
  const topupPayAgent = useTopupPayAgent();
  const { data: allowedTokens = [] } = useAllowedTokens();
  const { chainIdFromNetworkId, byNetworkId } = useChainRegistry();
  const { chainId: currentChainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const form = useForm<TopupValues>({
    resolver: zodResolver(topupSchema),
    defaultValues: { amount: "", network: "" },
  });

  // Networks that have an enabled USDC token
  const usdcNetworks = allowedTokens.filter((at) => at.symbol === "USDC" && at.enabled);

  const selectedNetwork = form.watch("network");
  const usdcToken = usdcNetworks.find((at) => at.network === selectedNetwork);

  // wagmi write contract
  const {
    writeContractAsync,
    data: txHash,
    isPending: isSending,
    reset: resetTx,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Step 2: when tx confirmed on-chain, submit to backend for verification
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (!isConfirmed || !txHash || !selectedNetwork || isVerifying) return;

    setIsVerifying(true);
    topupPayAgent
      .mutateAsync({ agentId: agent.id, txHash, network: selectedNetwork })
      .then(() => {
        toast.success(t("agents.toast.topup-success"));
        form.reset();
        resetTx();
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : t("agents.toast.topup-error"));
      })
      .finally(() => setIsVerifying(false));
  }, [isConfirmed, txHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 1: send USDC via wallet
  async function handleSend(data: TopupValues) {
    if (!isConnected) {
      toast.error(t("agents.topup.no-wallet-error"));
      return;
    }
    if (!usdcToken) {
      toast.error(t("agents.topup.no-usdc-error"));
      return;
    }

    try {
      // Switch chain if needed
      const targetChainId = chainIdFromNetworkId(data.network);
      if (targetChainId && currentChainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }

      const amountInUnits = parseUnits(data.amount, 6);
      await writeContractAsync({
        address: usdcToken.contractAddress as `0x${string}`,
        abi: USDC_ABI,
        functionName: "transfer",
        args: [agent.address as `0x${string}`, amountInUnits],
        chainId: targetChainId,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agents.toast.topup-error"));
    }
  }

  const isBusy = isSending || isConfirming || isVerifying;

  const buttonLabel = isSending
    ? t("agents.topup.btn-confirming-wallet")
    : isConfirming
      ? t("agents.topup.btn-confirming-chain")
      : isVerifying
        ? t("agents.topup.btn-verifying")
        : t("agents.topup.btn-send");

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">{t("agents.topup.title")}</Label>

      {/* Recipient address */}
      <div className="rounded-md bg-muted px-3 py-2">
        <p className="text-xs text-muted-foreground">{t("agents.topup.recipient")}</p>
        <p className="font-mono text-xs mt-0.5 break-all">{agent.address}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSend)} className="space-y-3">
          {/* Network selector */}
          <FormField
            control={form.control}
            name="network"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("agents.topup.network-label")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("agents.topup.network-ph")} />
                  </SelectTrigger>
                  <SelectContent>
                    {usdcNetworks.map((at) => (
                      <SelectItem key={at.network} value={at.network}>
                        {byNetworkId[at.network]?.name ?? at.network}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Amount input */}
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("agents.topup.amount-label")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder={t("agents.topup.amount-ph")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" size="sm" className="w-full" disabled={isBusy || !isConnected}>
            <Wallet className="h-4 w-4 mr-1" />
            {buttonLabel}
          </Button>
        </form>
      </Form>
    </div>
  );
}
