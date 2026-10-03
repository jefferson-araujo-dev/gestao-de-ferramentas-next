import { ThemeToggle } from "./ThemeToggle";

export function Topbar({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3 md:px-6 md:py-4">
      <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <span className="whitespace-nowrap rounded-full bg-info-subtle px-2 py-0.5 text-xs font-semibold text-info">
          Perfil: Administrador (exemplo)
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
