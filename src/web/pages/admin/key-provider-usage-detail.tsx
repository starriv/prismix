import { useSearchParams } from "react-router-dom";

import { LocaleNavigate } from "@/web/components/locale-link";

export default function KeyProviderUsageDetailPage() {
  const [searchParams] = useSearchParams();
  const providerId = Number(searchParams.get("id"));

  const target =
    Number.isInteger(providerId) && providerId > 0
      ? `/admin/key-providers?providerId=${providerId}`
      : "/admin/key-providers";

  return <LocaleNavigate to={target} replace />;
}
