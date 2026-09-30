# components

Componentes de UI reutilizáveis.

- `ui/` — primitivos do design system (Button, Badge, NotImplemented), independentes de tela.
- `shell/` — App Shell (sidebar, navegação inferior mobile, topbar, alternador de tema).
- `dashboard/` — componentes de apresentação específicos do Painel (Gate UX-1A).

Dados fictícios ficam fora daqui, em `src/lib/*-mock-data.ts`, para facilitar a troca por dados
reais em Gates futuros sem inventar um contrato de API/backend.

## Desvios deliberados do UX-0-V.1

Decisões do usuário (Gate UX-1A-AJUSTES) que diferem do protótipo aprovado. Não são defeitos.

- **Banner do protótipo:** não implementado; nenhuma ação prevista.
- **"Ver tudo" (Atividade recente):** ausente por decisão.
- **Card de estado demo:** não implementado; nenhuma ação prevista.
- **Auditoria:** permanece esmaecida e desabilitada (sem design aprovado em nenhum Gate).
- **Espaçamento dos grupos da navegação:** mantido o atual, diferente do protótipo.
- **Nota do Painel:** o protótipo tinha uma nota com o marcador PENDENTE_DE_CONFIRMACAO; a
  implementação a substitui pelo texto neutro "Dados fictícios de demonstração.".
  Pendência de governança em aberto: visibilidade de nomes de colaborador no Painel por perfil.
  Enquanto não decidida, o Painel não exibe nomes de pessoas (ver comentário em
  `dashboard/RecentActivity.tsx`).
- **Alternador de tema (texto e semântica):** o texto visível descreve a ação ("Modo escuro" no tema
  claro, "Modo claro" no escuro) e o nome acessível é "Ativar modo escuro/claro" (prefixo sr-only
  + texto visível). Os dois rótulos ficam no DOM e o CSS mostra um conforme `<html data-theme>`,
  então o texto e o nome já estão corretos antes da hidratação. Sem `aria-label` nem
  `aria-pressed` (é um botão de ação, não um interruptor de estado). Alvo mínimo de 44 px.
- **Fonte:** Inter via `next/font/google` (subset latin, variável `--font-inter`), conforme o token
  do UX-0-V.1, seguida de `system-ui, -apple-system, "Segoe UI", sans-serif`. Os PNGs aprovados do
  UX-0-V.1 foram gerados com o fallback do sistema, então há diferença de métrica de texto.
- **Foco:** o anel (`outline` 2 px, offset 2 px) acompanha o raio do próprio elemento; a regra
  global `:focus-visible` não define mais `border-radius`. Todo focável do shell já tem `rounded-*`.
- **Cabeçalho em 390 px:** título, badge de perfil e alternador quebram em duas linhas (o protótipo
  usa uma). Com a Inter: título 58,8 + badge 197 + alternador 107 + gaps 16 = 378,8 px contra
  358 px úteis (faltam ~20,8 px); não cabe sem reduzir o alvo de 44 px ou encurtar/ocultar texto.
  Só a partir de ~430 px cabe numa linha. **Desvio ACEITO pelo usuário em 30/09/2026.**
  Alternativas descartadas: encurtar o badge, ocultar o texto do alternador e reduzir
  paddings/gaps. Reavaliar quando o cabeçalho for redesenhado com o perfil real.
- **Rótulos dos cards em 320–390 px:** "Ferramentas cadastradas" ainda quebra em duas linhas, então
  o `min-h-8` de `StatCards` permanece para alinhar os numerais.
