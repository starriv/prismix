import { UserSidebar, UserSidebarContent } from "@/web/components/user/sidebar";

import { SidebarLayout } from "./sidebar-layout";

export function UserLayout() {
  return (
    <SidebarLayout
      sidebar={<UserSidebar />}
      mobileSidebar={(onNavigate) => <UserSidebarContent onNavigate={onNavigate} />}
    />
  );
}
