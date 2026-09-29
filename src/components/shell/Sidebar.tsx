"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "./nav-config";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Navegação principal"
      className="hidden w-64 shrink-0 flex-col gap-6 border-r border-border bg-surface p-4 md:flex"
    >
      <div className="flex items-center gap-2 text-base font-bold text-text-primary">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-sm bg-accent font-bold text-on-accent"
        >
          GF
        </span>
        Gestão de Ferramentas
      </div>

      <nav className="flex flex-col gap-6">
        {NAV_GROUPS.map((group) => (
          <div
            key={group.ariaLabel}
            role="group"
            aria-label={group.ariaLabel}
            className="flex flex-col gap-1"
          >
            {group.label ? (
              <div className="mb-1 px-3 text-xs font-medium tracking-wide text-text-muted uppercase">
                {group.label}
              </div>
            ) : null}

            {group.items.map((item) => {
              const Icon = item.icon;

              if (item.disabled) {
                return (
                  <span
                    key={item.label}
                    aria-disabled="true"
                    title={item.disabledReason}
                    className="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-text-muted opacity-60"
                  >
                    <Icon />
                    {item.label}
                    <span className="sr-only"> ({item.disabledReason})</span>
                  </span>
                );
              }

              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm ${
                    isActive
                      ? "bg-accent-subtle font-semibold text-accent-text"
                      : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                  }`}
                >
                  <Icon />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
