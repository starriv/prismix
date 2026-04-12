import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Plus, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  type AdminMember,
  useAdminMembers,
  useCreateAdmin,
  useDeleteAdmin,
} from "@/web/api/admin-hooks";
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
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

export default function AdminMembersPage() {
  const { t } = useTranslation();
  const { data: admins = [], isLoading } = useAdminMembers();
  const deleteAdmin = useDeleteAdmin();
  const [deleteTarget, setDeleteTarget] = useState<AdminMember | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAdmin.mutateAsync(deleteTarget.id);
      toast.success(t("admin.admins.toast.deleted"));
      setDeleteTarget(null);
    } catch {
      toast.error(t("admin.admins.toast.delete-error"));
    }
  };

  return (
    <div>
      <Header title={t("admin.admins.title")} description={t("admin.admins.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <div className="flex justify-end">
          <AddAdminDialog />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {t("admin.admins.title")}
            </CardTitle>
            <CardDescription>{t("admin.admins.desc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-4">{t("auth.loading")}</p>
            ) : admins.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">{t("admin.admins.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="py-2 pr-4">ID</TableHead>
                      <TableHead className="py-2 pr-4">{t("admin.admins.name")}</TableHead>
                      <TableHead className="py-2 pr-4">{t("admin.admins.provider")}</TableHead>
                      <TableHead className="py-2 pr-4">{t("admin.admins.account")}</TableHead>
                      <TableHead className="py-2" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {admins.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="py-2 pr-4">{a.id}</TableCell>
                        <TableCell className="py-2 pr-4">{a.name}</TableCell>
                        <TableCell className="py-2 pr-4">
                          <div className="flex gap-1 flex-wrap">
                            {a.identities.map((i) => (
                              <Badge key={i.id} variant="outline" className="text-xs">
                                {i.provider}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 pr-4 font-mono text-xs">
                          {a.identities.map((i) => i.providerAccountId).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="py-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => setDeleteTarget(a)}
                            disabled={admins.length <= 1}
                            aria-label={t("common.btn.delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.admins.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">{t("admin.admins.delete-confirm")}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteAdmin.isPending}>
              {t("admin.admins.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Add Admin Dialog ─────────────────────────────────────────────────

function AddAdminDialog() {
  const { t } = useTranslation();
  const createAdmin = useCreateAdmin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("siwe");
  const [accountId, setAccountId] = useState("");

  const handleSubmit = async () => {
    if (!name.trim() || !accountId.trim()) return;
    try {
      await createAdmin.mutateAsync({
        name: name.trim(),
        provider,
        providerAccountId: accountId.trim(),
        address: provider === "siwe" ? accountId.trim().toLowerCase() : undefined,
        email: provider === "credentials" ? accountId.trim().toLowerCase() : undefined,
      });
      toast.success(t("admin.admins.toast.created"));
      setOpen(false);
      setName("");
      setProvider("siwe");
      setAccountId("");
    } catch {
      toast.error(t("admin.admins.toast.create-error"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-3.5 w-3.5" />
          {t("admin.admins.add")}
        </Button>
      </DialogTrigger>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("admin.admins.add")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("admin.admins.name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("admin.admins.form.name-ph")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.admins.provider")}</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="siwe">Wallet (SIWE)</SelectItem>
                  <SelectItem value="credentials">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.admins.account")}</Label>
              <Input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder={t("admin.admins.form.account-ph")}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                {provider === "siwe"
                  ? t("admin.admins.form.address-hint")
                  : t("admin.admins.form.email-hint")}
              </p>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || !accountId.trim()}>
            {t("admin.admins.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
