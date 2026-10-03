import type { ComponentType } from "react";
import {
  DashboardIcon,
  ShieldCheckIcon,
  SwapIcon,
  UsersIcon,
  WrenchIcon,
} from "./icons";

export type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Item ainda não desenhado/aprovado em nenhum Gate — fica visualmente desabilitado. */
  disabled?: boolean;
  disabledReason?: string;
};

export type NavGroup = {
  /** null = grupo sem rótulo visível (ex.: "Painel" isolado, como no protótipo). */
  label: string | null;
  ariaLabel: string;
  items: NavItem[];
};

// Estrutura de navegação fiel ao protótipo aprovado (Gate UX-0-V.1, dashboard.html).
// Rotas para "Retirar / Devolver", "Ferramentas" e "Colaboradores" existem neste Gate
// apenas como telas honestas de "ainda não implementado" (ver src/app/*/page.tsx) —
// as telas completas ficam para Gates futuros. "Auditoria" permanece desabilitada
// porque nem o design dela existe ainda.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    ariaLabel: "Visão geral",
    items: [{ label: "Painel", href: "/", icon: DashboardIcon }],
  },
  {
    label: "Operação",
    ariaLabel: "Operação",
    items: [
      { label: "Retirar / Devolver", href: "/retirar-devolver", icon: SwapIcon },
      { label: "Ferramentas", href: "/ferramentas", icon: WrenchIcon },
    ],
  },
  {
    label: "Pessoas",
    ariaLabel: "Pessoas",
    items: [{ label: "Colaboradores", href: "/colaboradores", icon: UsersIcon }],
  },
  {
    label: "Controle",
    ariaLabel: "Controle",
    items: [
      {
        label: "Auditoria",
        href: "#",
        icon: ShieldCheckIcon,
        disabled: true,
        disabledReason: "Ainda não desenhada em nenhum Gate de UX",
      },
    ],
  },
];

// Navegação inferior (mobile) — subconjunto com rótulos curtos, igual ao protótipo.
export const MOBILE_NAV_ITEMS: NavItem[] = [
  { label: "Painel", href: "/", icon: DashboardIcon },
  { label: "Scanner", href: "/retirar-devolver", icon: SwapIcon },
  { label: "Ferramentas", href: "/ferramentas", icon: WrenchIcon },
  { label: "Equipe", href: "/colaboradores", icon: UsersIcon },
];
