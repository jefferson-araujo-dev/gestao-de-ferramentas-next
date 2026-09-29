"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_NAV_ITEMS } from "./nav-config";

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação inferior"
      className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-border bg-surface py-1 [padding-bottom:env(safe-area-inset-bottom)] md:hidden"
    >
      {MOBILE_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-sm px-2 py-1 text-[11px] ${
              isActive ? "font-semibold text-accent-text" : "text-text-secondary"
            }`}
          >
            <Icon />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
