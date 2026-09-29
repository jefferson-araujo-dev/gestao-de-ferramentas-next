// Honesto em vez de simular uma tela funcional: usado pelas rotas cujo desenho já existe
// no protótipo aprovado (Gate UX-0-V.1) mas cuja implementação em React fica para um Gate
// futuro. Não é um "empty state" de dados — é a própria tela ainda não construída.
export function NotImplemented({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface px-6 py-12 text-center">
      <p className="text-base font-semibold text-text-primary">{title} — ainda não implementado</p>
      <p className="max-w-md text-sm text-text-muted">
        Esta tela já tem design aprovado, mas a implementação em React fica para um Gate
        futuro. Nenhuma funcionalidade real existe aqui ainda.
      </p>
    </div>
  );
}
