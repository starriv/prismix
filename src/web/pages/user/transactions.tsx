import { useTranslation } from "react-i18next";

import { Header } from "@/web/components/dashboard/header";
import { TransactionHistory } from "@/web/pages/user/wallet/transaction-history";

export default function UserTransactionsPage() {
  const { t } = useTranslation();

  return (
    <div>
      <Header title={t("user.transactions.title")} description={t("user.transactions.desc")} />

      <div className="p-4 md:p-8">
        <TransactionHistory />
      </div>
    </div>
  );
}
