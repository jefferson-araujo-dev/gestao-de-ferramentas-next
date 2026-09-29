"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// No servidor não há <html data-theme>, então a única leitura estável é "light" — o
// script inline em layout.tsx já aplica o tema real ao <html> antes da hidratação, e o
// useSyncExternalStore corrige o snapshot do cliente sem precisar de useEffect+setState.
function getServerSnapshot(): Theme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggleTheme() {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    listeners.forEach((notify) => notify());
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={isDark}
      className="inline-flex h-11 items-center gap-2 rounded-full border border-border-control bg-surface px-3 text-[13px] text-text-secondary hover:bg-surface-muted"
    >
      <span>{isDark ? "Modo escuro" : "Modo claro"}</span>
    </button>
  );
}
