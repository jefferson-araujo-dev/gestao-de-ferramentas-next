import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-active",
  secondary:
    "bg-surface text-text-primary border border-border-control hover:bg-surface-muted",
  ghost: "bg-transparent text-text-secondary hover:bg-surface-muted hover:text-text-primary",
  // Correção de contraste (Gate UX-1A): no protótipo original, o texto era fixo em
  // branco (#fff) sobre --color-danger. Em modo escuro --color-danger é um vermelho
  // claro (#f87171) e branco sobre essa cor não atinge 4.5:1 (~2.6:1, reprovado AA).
  // Fix: usar o token --color-text-inverse, que já é dinâmico por tema (branco no
  // claro, quase-preto no escuro) — mede ~6.5:1 no claro e ~6.7:1 no escuro.
  danger: "bg-danger text-text-inverse hover:brightness-90 active:brightness-80",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
