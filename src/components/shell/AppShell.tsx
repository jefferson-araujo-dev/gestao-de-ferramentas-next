import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { Topbar } from "./Topbar";

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-text-primary">
      {/* Skip link: usa os utilitários sr-only/not-sr-only nativos do Tailwind, sem CSS extra. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
      >
        Pular para o conteúdo
      </a>

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} />
        <main
          id="main-content"
          className="flex flex-1 flex-col gap-6 p-4 pb-20 md:p-6 md:pb-6"
        >
          {children}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
