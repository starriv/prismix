import { CompactAccountMenu } from "@/web/components/dashboard/account-menu";
import { UserAnnouncementNotification } from "@/web/components/user/announcement-notification";
import { UserSidebar, UserSidebarContent } from "@/web/components/user/sidebar";

import { SidebarLayout } from "./sidebar-layout";

export function UserLayout() {
  return (
    <>
      <SidebarLayout
        sidebar={<UserSidebar />}
        mobileSidebar={(onNavigate) => <UserSidebarContent onNavigate={onNavigate} />}
        trailing={<CompactAccountMenu />}
      />
      <UserAnnouncementNotification />
    </>
  );
}
