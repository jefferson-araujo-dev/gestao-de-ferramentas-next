export type Theme = "light" | "dark";

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

// Fonte única dos textos do alternador. O botão descreve a AÇÃO: o rótulo é o do tema de
// destino. Em minúsculas porque compõem o nome acessível ("Ativar modo escuro"); a capitalização
// visual vem de CSS (first-letter). O nome acessível contém o texto visível (WCAG 2.5.3).
export const TARGET_LABEL: Record<Theme, string> = {
  dark: "modo escuro",
  light: "modo claro",
};
export const ACTION_PREFIX = "Ativar ";

/** Grava o tema; storage bloqueado/indisponível não pode impedir a troca de tema. */
export function saveTheme(storage: Pick<Storage, "setItem"> | null, theme: Theme): boolean {
  try {
    if (!storage) return false;
    storage.setItem("theme", theme);
    return true;
  } catch {
    return false;
  }
}
