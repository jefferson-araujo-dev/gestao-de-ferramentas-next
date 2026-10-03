"use client";

import { ACTION_PREFIX, TARGET_LABEL, nextTheme, saveTheme, type Theme } from "./theme";

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function toggleTheme() {
  const next = nextTheme(currentTheme());
  document.documentElement.setAttribute("data-theme", next);
  let storage: Storage | null = null;
  try {
    storage = window.localStorage; // o próprio acesso pode lançar com storage bloqueado
  } catch {}
  saveTheme(storage, next);
}

// Os dois rótulos de destino existem no DOM; o CSS (globals.css, .theme-toggle-*) mostra só o
// do tema atual conforme <html data-theme>. Assim o texto e o nome acessível já estão certos
// no HTML do servidor, antes da hidratação. O nome acessível vem do conteúdo: "Ativar " (sr-only)
// + texto visível do rótulo ativo (o oculto, display:none, não entra no nome).
export function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-11 min-w-11 items-center rounded-full border border-border-control bg-surface px-3 text-[13px] text-text-secondary hover:bg-surface-muted"
    >
      <span className="sr-only">{ACTION_PREFIX}</span>
      <span className="theme-toggle-to-dark inline-block first-letter:uppercase">{TARGET_LABEL.dark}</span>
      <span className="theme-toggle-to-light inline-block first-letter:uppercase">{TARGET_LABEL.light}</span>
    </button>
  );
}
