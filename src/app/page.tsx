import { AppShell } from "@/components/shell/AppShell";
import { StatCards } from "@/components/dashboard/StatCards";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { DASHBOARD_STATS, RECENT_ACTIVITY } from "@/lib/dashboard-mock-data";

export default function DashboardPage() {
  return (
    <AppShell title="Painel">
      <StatCards stats={DASHBOARD_STATS} />
      <RecentActivity items={RECENT_ACTIVITY} />
    </AppShell>
  );
}
