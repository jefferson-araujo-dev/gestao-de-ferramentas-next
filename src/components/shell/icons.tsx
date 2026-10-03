// Ícones do App Shell — convertidos dos SVGs inline do protótipo aprovado
// (scratchpad/ux-0-prototypes/dashboard.html). Decorativos: aria-hidden, o rótulo
// textual ao lado de cada ícone já comunica o significado para leitores de tela.

type IconProps = {
  className?: string;
};

const commonProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  "aria-hidden": true,
} as const;

export function DashboardIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function SwapIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M3 7V4a1 1 0 0 1 1-1h3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3" />
      <path d="M7 12h10" />
    </svg>
  );
}

export function WrenchIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.6-.5-.5-2.6 2.1-2.1z" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M15.5 20a5 5 0 0 1 6.9-4.6" />
    </svg>
  );
}

export function ShieldCheckIcon({ className }: IconProps) {
  return (
    <svg {...commonProps} className={className}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
