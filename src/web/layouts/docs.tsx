import { DocsSidebar, DocsSidebarContent } from "@/web/components/docs/sidebar";

import { SidebarLayout } from "./sidebar-layout";

export function DocsLayout() {
  return (
    <SidebarLayout
      sidebar={<DocsSidebar />}
      mobileSidebar={(onNavigate) => <DocsSidebarContent onNavigate={onNavigate} />}
    />
  );
}
