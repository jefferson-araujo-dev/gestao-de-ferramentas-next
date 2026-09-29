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
            className={`flex items-center justify-between gap-3 ${
              index < items.length - 1 ? "border-b border-border pb-3" : ""
            }`}
          >
            <span className="text-sm text-text-primary">{item.description}</span>
            <Badge variant={STATUS_META[item.status].variant}>{STATUS_META[item.status].label}</Badge>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-text-muted">
        Nomes de ferramentas fictícios. Nenhum nome de colaborador é exibido no Painel, para
        nenhum perfil — <strong className="text-text-primary">PENDENTE_DE_CONFIRMACAO</strong>.
      </p>
    </section>
  );
}
