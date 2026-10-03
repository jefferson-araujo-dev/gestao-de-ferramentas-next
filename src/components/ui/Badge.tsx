import type { ReactNode } from "react";

type Variant = "neutral" | "success" | "warning" | "danger" | "info";

const VARIANT_CLASSES: Record<Variant, string> = {
  neutral: "bg-surface-muted text-text-secondary",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
  info: "bg-info-subtle text-info",
};

export function Badge({ variant, children }: { variant: Variant; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold leading-[18px] ${VARIANT_CLASSES[variant]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
