// Dados 100% fictícios (Gate UX-1A) — sem integração de rede, sem Supabase/Firebase.
// Separado dos componentes de apresentação para facilitar a troca por dados reais
// em um Gate futuro, sem inventar um contrato de API/backend aqui.

export type StatCard = {
  id: string;
  label: string;
  value: number;
  caption: string;
  /** Classe utilitária Tailwind para colorir o número, opcional (default = cor de texto padrão). */
  valueClassName?: string;
};

export const DASHBOARD_STATS: StatCard[] = [
  {
    id: "cadastradas",
    label: "Ferramentas cadastradas",
    value: 128,
    caption: "Catálogo completo",
  },
  {
    id: "disponiveis",
    label: "Disponíveis",
    value: 94,
    caption: "Prontas para uso",
    valueClassName: "text-success",
  },
  {
    id: "emprestadas",
    label: "Emprestadas",
    value: 27,
    caption: "Com colaboradores",
    valueClassName: "text-accent-text",
  },
  {
    id: "atrasadas",
    label: "Atrasadas",
    value: 7,
    caption: "Requerem atenção",
    valueClassName: "text-danger",
  },
];

export type ActivityStatus = "emprestada" | "disponivel" | "manutencao";

export type ActivityEntry = {
  id: string;
  description: string;
  status: ActivityStatus;
};

export const RECENT_ACTIVITY: ActivityEntry[] = [
  { id: "1", description: "Furadeira de impacto 750W — retirada", status: "emprestada" },
  { id: "2", description: "Chave de impacto pneumática — devolvida", status: "disponivel" },
  { id: "3", description: "Multímetro digital — em manutenção", status: "manutencao" },
];
