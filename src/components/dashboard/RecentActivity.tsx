import { Badge } from "@/components/ui/Badge";
import type { ActivityEntry, ActivityStatus } from "@/lib/dashboard-mock-data";

const STATUS_META: Record<ActivityStatus, { label: string; variant: "warning" | "success" | "neutral" }> = {
  emprestada: { label: "Emprestada", variant: "warning" },
  disponivel: { label: "Disponível", variant: "success" },
  manutencao: { label: "Manutenção", variant: "neutral" },
};

export function RecentActivity({ items }: { items: ActivityEntry[] }) {
  return (
    <section aria-labelledby="activity-title" className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="activity-title" className="text-xl font-semibold text-text-primary">
          Atividade recente
        </h2>
      </div>

      <ul className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={`flex flex-col items-start gap-2 md:flex-row md:items-center md:justify-between md:gap-3 ${
              index < items.length - 1 ? "border-b border-border pb-3" : ""
            }`}
          >
            <span className="text-sm text-text-primary">{item.description}</span>
            <Badge variant={STATUS_META[item.status].variant}>{STATUS_META[item.status].label}</Badge>
          </li>
        ))}
      </ul>

      {/* Pendência de governança (não exibir na UI): visibilidade de nomes de colaborador no
          Painel por perfil ainda não decidida. Enquanto isso o Painel não mostra nomes de
          pessoas. Registrada também em src/components/README.md ("Desvios deliberados"). */}
      <p className="mt-3 text-xs text-text-muted">Dados fictícios de demonstração.</p>
    </section>
  );
}
