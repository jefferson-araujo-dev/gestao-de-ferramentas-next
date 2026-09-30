import type { StatCard } from "@/lib/dashboard-mock-data";

export function StatCards({ stats }: { stats: StatCard[] }) {
  return (
    <section aria-labelledby="stats-title">
      <h2 id="stats-title" className="sr-only">
        Indicadores gerais
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.id}
            className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 shadow-sm"
          >
            {/* min-h-8 = 2 linhas (16px): alinha os numerais entre cartões da mesma linha quando
                um rótulo quebra em 390px. A partir de md o rótulo cabe em 1 linha. */}
            <span className="min-h-8 text-xs font-medium text-text-muted md:min-h-0">{stat.label}</span>
            <span
              className={`text-[28px] leading-none font-bold tabular-nums ${stat.valueClassName ?? "text-text-primary"}`}
            >
              {stat.value}
            </span>
            <span className="text-xs text-text-muted">{stat.caption}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
