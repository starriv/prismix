import { AdminSidebar, AdminSidebarContent } from "@/web/components/admin/sidebar";

import { SidebarLayout } from "./sidebar-layout";

export function AdminLayout() {
  return (
    <SidebarLayout
      sidebar={<AdminSidebar />}
      mobileSidebar={(onNavigate) => <AdminSidebarContent onNavigate={onNavigate} />}
    />
  );
}
