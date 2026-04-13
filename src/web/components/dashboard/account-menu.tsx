import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Check, Copy, Link as LinkIcon, Mail, UserRound, Wallet } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/web/components/ui/avatar";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { useCopyById } from "@/web/hooks/use-copy";
import { useOptionalAdminAuthContext } from "@/web/providers/admin-auth-provider";
import { useOptionalUserAuthContext } from "@/web/providers/user-auth-provider";
import { explorerAddressUrl, useChainRegistry } from "@/web/shared/chains";

const CLOSE_DELAY_MS = 120;

function getInitials(name: string | null | undefined) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getAuthLabel(user: { address: string | null; email: string | null }): string {
  if (user.address) return "user.account-menu.auth.wallet";
  if (user.email) return "user.account-menu.auth.email";
  return "user.account-menu.auth.user";
}

export function AccountMenu() {
  return <AccountMenuInner compact={false} />;
}

export function CompactAccountMenu() {
  return <AccountMenuInner compact />;
}

function AccountMenuInner({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const userAuth = useOptionalUserAuthContext();
  const adminAuth = useOptionalAdminAuthContext();
  const { copy, isCopied } = useCopyById<"uuid" | "email" | "wallet">();
  const { getChainDisplay } = useChainRegistry();
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);

  const user = userAuth?.user;
  const admin = adminAuth?.admin;
  const identity = user ?? admin;
  useEffect(() => {
    return () => clearTimeout(closeTimer.current);
  }, []);

  const cancelClose = () => {
    clearTimeout(closeTimer.current);
  };

  const scheduleClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  if (!identity) return null;

  const displayName =
    identity.name ||
    identity.email ||
    (identity.address ? shortAddress(identity.address) : t("user.account-menu.fallback-name"));
  const authLabelKey = getAuthLabel({
    address: identity.address,
    email: identity.email,
  });
  const avatarSrc = user?.avatar ?? null;
  const userUuid = user?.uuid ?? null;

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const walletConnected = !!(mounted && account && chain);
        const explorerUrl =
          chain?.id !== undefined ? getChainDisplay(chain.id)?.explorerUrl : undefined;

        return (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={
                  compact
                    ? "inline-flex size-8 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
                    : "inline-flex h-8 max-w-[162px] items-center gap-2 rounded-md px-1 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
                }
                {...(!ready && {
                  "aria-hidden": true,
                  style: {
                    opacity: 0,
                    pointerEvents: "none" as const,
                    userSelect: "none" as const,
                  },
                })}
                onMouseEnter={() => {
                  cancelClose();
                  setOpen(true);
                }}
                onMouseLeave={scheduleClose}
                onClick={() => {
                  cancelClose();
                  setOpen((value) => !value);
                }}
              >
                <span className="relative shrink-0">
                  <Avatar size="sm">
                    {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
                    <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                  </Avatar>
                  {walletConnected && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border border-background bg-emerald-500" />
                  )}
                </span>
                {!compact && (
                  <>
                    <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
                    <span className="min-w-0 truncate text-sm font-medium">{displayName}</span>
                  </>
                )}
              </button>
            </PopoverTrigger>

            <PopoverContent
              align="end"
              className="w-[360px] space-y-4 rounded-xl p-3"
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              <div className="flex items-start gap-3">
                <span className="relative shrink-0">
                  <Avatar>
                    {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
                    <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                  </Avatar>
                  {walletConnected && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background bg-emerald-500" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {t(authLabelKey)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(
                      walletConnected
                        ? "user.account-menu.wallet.connected"
                        : "user.account-menu.wallet.not-connected",
                    )}
                  </p>
                </div>
              </div>

              <section className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t("user.account-menu.sections.account")}
                </p>
                <ProfileField
                  icon={UserRound}
                  label={t("user.account-menu.fields.name")}
                  value={displayName}
                />
                {userUuid && (
                  <ProfileField
                    icon={UserRound}
                    label={t("user.account-menu.fields.uuid")}
                    value={userUuid}
                    copied={isCopied("uuid")}
                    onCopy={() => copy(userUuid, "uuid")}
                    mono
                  />
                )}
                {identity.email && (
                  <ProfileField
                    icon={Mail}
                    label={t("user.account-menu.fields.email")}
                    value={identity.email}
                    copied={isCopied("email")}
                    onCopy={() => copy(identity.email!, "email")}
                  />
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    {t("user.account-menu.sections.wallet")}
                  </p>
                  {walletConnected && chain && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="px-1.5"
                      onClick={openChainModal}
                    >
                      {chain.name}
                    </Button>
                  )}
                </div>

                {!walletConnected ? (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">
                      {t("user.account-menu.wallet.connect-hint")}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={openConnectModal}
                    >
                      {t("common.connect-wallet")}
                    </Button>
                  </div>
                ) : chain?.unsupported ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-xs text-destructive">
                      {t("user.account-menu.wallet.unsupported")}
                    </p>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={openChainModal}
                    >
                      {t("user.account-menu.wallet.switch-network")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <ProfileField
                      icon={Wallet}
                      label={t("user.account-menu.fields.network")}
                      value={chain?.name ?? t("user.account-menu.wallet.connected")}
                    />
                    {account && (
                      <ProfileField
                        icon={LinkIcon}
                        label={t("user.account-menu.fields.address")}
                        value={account.address}
                        copied={isCopied("wallet")}
                        onCopy={() => copy(account.address, "wallet")}
                        mono
                        action={
                          explorerUrl ? (
                            <Button variant="ghost" size="icon-xs" asChild>
                              <a
                                href={explorerAddressUrl(explorerUrl, account.address)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={t("user.account-menu.wallet.open-explorer")}
                              >
                                <LinkIcon className="size-3" />
                              </a>
                            </Button>
                          ) : null
                        }
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={openAccountModal}
                    >
                      {t("user.account-menu.wallet.manage")}
                    </Button>
                  </div>
                )}
              </section>
            </PopoverContent>
          </Popover>
        );
      }}
    </ConnectButton.Custom>
  );
}

function ProfileField({
  icon: Icon,
  label,
  value,
  copied = false,
  onCopy,
  mono = false,
  action,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
  copied?: boolean;
  onCopy?: () => void;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/25 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <div className="flex items-start gap-1.5">
        <p className={`min-w-0 flex-1 break-all text-xs ${mono ? "font-mono" : ""}`}>{value}</p>
        {action}
        {onCopy && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            onClick={onCopy}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </Button>
        )}
      </div>
    </div>
  );
}
