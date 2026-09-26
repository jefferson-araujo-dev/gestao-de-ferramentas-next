# MIG-R2 — Fundação técnica (Next.js + TypeScript + Supabase local)

Este documento descreve o que foi construído neste Gate (MIG-R2) e o que fica pendente para os
próximos. **Esta aplicação não está pronta para uso real.** Nenhuma funcionalidade de negócio
(autenticação, perfis, Dashboard, ferramentas, colaboradores, Scanner, empréstimos, devoluções,
custódia) foi implementada.

## Situação do Firebase existente

O projeto Firebase em `C:\Projetos\gestao-de-ferramentas` permanece preservado e inalterado além
do commit local do Gate 1-F4.C.2 (testes de isolamento do emulador), que é uma frente de trabalho
independente desta reconstrução. Nenhum dado, regra publicada ou configuração do Firebase real foi
lido, migrado ou alterado a partir deste repositório.

## Arquitetura-alvo

```
src/
  app/             # App Router do Next.js (rotas, layouts)
  components/      # Componentes de UI reutilizáveis (vazio nesta fundação)
  config/          # Configuração de ambiente e o guard de isolamento
  contracts/       # Tipos/schemas compartilhados entre camadas (vazio; depende do esquema MIG-R3)
  domain/          # Entidades e regras de domínio (vazio; próximos Gates)
  application/     # Casos de uso que orquestram o domínio (vazio; próximos Gates)
  authz/           # Autorização e políticas de acesso (vazio; RLS de negócio é MIG-R3+)
  infrastructure/  # Integrações externas (Supabase local nesta fase)
  lib/             # Utilitários puros, incluindo isolation-guard.ts
tests/
  unit/            # Testes unitários (node --test, sem dependências externas)
  integration/     # Testes que dependem do Supabase local (vazio nesta fundação)
scripts/           # Scripts de desenvolvimento local
supabase/          # Configuração do Supabase CLI local (config.toml)
docs/              # Esta documentação
```

Cada diretório de `src/` que ainda está vazio tem um `README.md` explicando sua finalidade e por
que não foi populado neste Gate — nenhum diretório vazio ficou sem justificativa registrada.

A aplicação **não** acessa o banco diretamente do navegador: `NEXT_PUBLIC_SUPABASE_ANON_KEY` é a
única credencial exposta ao cliente (por design do Supabase, a anon key é pública). A
`SUPABASE_SERVICE_ROLE_KEY` é de uso exclusivo do servidor (rotas de API / Server Components) e
nunca deve ser prefixada com `NEXT_PUBLIC_*`. Nenhuma rota de servidor foi implementada ainda —
a integração real com o Supabase fica para os próximos Gates.

## Versões instaladas (verificadas nesta máquina, não presumidas)

| Ferramenta | Versão |
|---|---|
| Node.js | v24.19.0 |
| npm | 11.17.0 |
| Docker | 29.7.2 |
| Docker Compose | v5.5.1 |
| Next.js / create-next-app | 16.3.6 (estável, não canary/beta) |
| React / React DOM | 19.2.8 |
| TypeScript | 5.9.3 |
| Tailwind CSS | 4.3.3 |
| ESLint | 9.39.5 |
| eslint-config-next | 16.3.6 |
| Supabase CLI | 2.118.0 (devDependency, pin exato — estável, não beta) |

`npm warn deprecated eslint@9.39.5` apareceu durante a instalação (ESLint 9.x já tem uma versão
mais nova fora do range `^9` usado pelo template do Next.js); não é um erro, é o aviso padrão do
scaffold oficial do Next.js 16.3.6 e não foi alterado nesta fundação.

## Comandos de instalação executados

```
npx create-next-app@16.3.6 gestao-de-ferramentas-next \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --disable-git

npm install --save-dev supabase@2.118.0
npx supabase init
```

## Iniciar o Next.js

```
npm run dev      # servidor de desenvolvimento
npm run build    # build de produção
npm run start    # serve o build de produção
npm run lint     # ESLint
```

`npm run dev` e `npm run build` chamam o guard de isolamento (via `next.config.ts`) antes de
prosseguir — ver seção "Guard de isolamento".

## Iniciar o Supabase local

```
npx supabase start    # ou: npm run supabase:start
npx supabase stop     # ou: npm run supabase:stop
```

`supabase start` baixa e inicia os containers Docker oficiais do Supabase (Postgres, Auth API
gateway/Kong, Studio, Realtime, Storage, Mailpit, Analytics, etc.) e imprime a URL da API, a
`anon key` e a `service role key` fixas de desenvolvimento local. Copie esses valores para
`.env.local` (nunca para `.env.example`, que só tem placeholders).

### Portas locais

O Supabase CLI usa por padrão o intervalo `54320–54329`. Nesta máquina, esse intervalo colide
com uma faixa de exclusão dinâmica de portas do Windows (reservada pelo Hyper-V/WSL2 — visível
em `netsh interface ipv4 show excludedportrange protocol=tcp`), o que impede qualquer processo,
inclusive o proxy de portas do Docker Desktop, de fazer bind nelas. `supabase/config.toml` foi
ajustado para o intervalo `40200–40209`, confirmado livre nesta máquina antes do ajuste:

| Serviço | Porta padrão | Porta usada aqui |
|---|---|---|
| API (Kong) | 54321 | **40201** |
| Postgres | 54322 | **40202** |
| Shadow DB | 54320 | **40200** |
| Studio | 54323 | **40203** |
| Mailpit (SMTP de teste) | 54324 | **40204** |
| Analytics | 54327 | **40207** |
| Connection Pooler (desabilitado) | 54329 | 40209 |

Se outra máquina não tiver esse conflito de portas, os valores podem voltar ao padrão do
Supabase CLI — o importante é manter as portas consistentes entre `supabase/config.toml` e
`.env.local`.

## Variáveis de ambiente

`.env.example` documenta os placeholders (commitável). `.env.local` tem os valores reais do
Supabase local e está no `.gitignore` (não commitado). Nenhum valor de `.env.local` é reproduzido
neste documento.

| Variável | Exposta ao navegador? | Conteúdo |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | URL da API local, ex.: `http://127.0.0.1:40201` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Chave anônima fixa do Supabase local |
| `SUPABASE_SERVICE_ROLE_KEY` | **Não** | Chave de service role — uso exclusivo do servidor |

## Guard de isolamento (`src/lib/isolation-guard.ts`)

`assertLocalSupabaseEnvironment()` falha fechado (lança exceção) sempre que:

1. `NEXT_PUBLIC_SUPABASE_URL` está ausente ou vazia (sem fallback remoto silencioso).
2. A URL é sintaticamente inválida.
3. O protocolo não é `http:`/`https:`.
4. O hostname não é exatamente `localhost` ou `127.0.0.1`.
5. A URL não tem porta explícita.
6. Qualquer variável com prefixo `NEXT_PUBLIC_` tem nome de credencial privilegiada
   (`SERVICE_ROLE`, `SECRET`, `PRIVATE_KEY`, `ADMIN_KEY`, `DB_PASSWORD`) e valor não vazio.
7. Existe `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` ou `SUPABASE_DB_PASSWORD` no ambiente
   (indício de `supabase login`/`supabase link` — projeto vinculado a um remoto), mesmo que a URL
   configurada seja local.
8. `SUPABASE_URL` (nome alternativo, não público) está definida com um host diferente de
   `NEXT_PUBLIC_SUPABASE_URL` (conflito entre variáveis).

O guard é chamado em `next.config.ts` (cobre `next dev` e `next build`) e em
`tests/integration/support/env.ts` (bootstrap para os testes de integração dos próximos Gates,
que devem importar esse módulo antes de qualquer chamada de rede).

**Limitação conhecida, registrada e não presumida resolvida**: validar a URL configurada prova
que a aplicação não foi *configurada* para apontar a um destino remoto. Isso não prova que
nenhuma biblioteca, SDK ou dependência transitiva possa abrir sua própria conexão de rede para
outro destino — o guard cobre configuração declarada, não o runtime de rede completo do processo.

### Testes do guard

`tests/unit/isolation-guard.test.ts` — `npm run test:unit` — cobre as 10 situações exigidas pelo
Gate (configuração válida; URL ausente; URL de projeto remoto; hostname externo; configuração
malformada; credencial privilegiada em variável pública; conflito entre variáveis de ambiente;
ausência de fallback remoto; execução sem credenciais reais; inicialização segura idempotente),
mais um caso extra para projeto vinculado via `supabase link`/`login`. 11/11 testes passando.

## Docker e isolamento de rede — pendência registrada, não resolvida

`npx supabase start` foi executado com sucesso nesta máquina: todas as imagens oficiais foram
baixadas, os containers subiram e a API respondeu no host/porta configurados. **Em seguida, os
containers foram parados (`supabase stop`)** porque a inspeção de `docker ps` mostrou os serviços
publicados em `0.0.0.0` (IPv4) e `[::]` (IPv6) — todas as interfaces de rede da máquina, não
apenas loopback:

```
supabase_studio    0.0.0.0:40203->3000/tcp, [::]:40203->3000/tcp
supabase_db        0.0.0.0:40202->5432/tcp, [::]:40202->5432/tcp
supabase_kong      0.0.0.0:40201->8000/tcp, [::]:40201->8000/tcp
supabase_analytics 0.0.0.0:40207->4000/tcp, [::]:40207->4000/tcp
supabase_inbucket  0.0.0.0:40204->8025/tcp, [::]:40204->8025/tcp
```

Isso viola o critério do Gate de restringir os serviços locais a `127.0.0.1`. Nem
`supabase/config.toml` nem as flags do CLI (`supabase start --help`) oferecem uma opção para
restringir o host de publicação das portas a loopback — é o comportamento padrão do
Supabase CLI com Docker Desktop nesta plataforma, não uma escolha de configuração desta
fundação. Um remédio possível — bloquear, no Firewall do Windows, o tráfego de entrada não
proveniente de loopback para essas portas específicas — está fora das autorizações concedidas a
este Gate (que cobrem instalar dependências e rodar o Supabase local, não alterar a configuração
de rede do sistema operacional) e por isso não foi aplicado unilateralmente.

**Estado final**: os containers estão parados. Nenhum serviço do Supabase local ficou exposto
além do tempo necessário para a verificação acima. A decisão de como isolar essas portas
(Firewall do Windows, executar em uma VM/rede isolada, ou aceitar o risco documentado por se
tratar de uma máquina de desenvolvimento) fica para o Cowork.

## Testes executados

```
npx tsc --noEmit        # 0 erros
npx eslint .             # 0 problemas
npm run test:unit        # 11/11 testes (isolation-guard)
npm run build            # build de produção OK
```

Ordem de verificação do guard comprovada experimentalmente: com `.env.local` presente, o build
conclui; com `.env.local` renomeado (ausência da URL local), o build falha imediatamente com o
erro do guard, antes de qualquer outra etapa — não há bypass silencioso.

## Correções arquiteturais herdadas da revisão MIG-R1

Estas ressalvas não foram implementadas nesta fundação (implementação de esquema/RLS é MIG-R3),
mas ficam registradas aqui para não se perderem ao planejar o próximo Gate:

- Separar observações administrativas dos dados operacionais públicos.
- Não confundir colaborador inativo com operador inativo.
- Não implementar literalmente a chave primária inválida proposta para `operator_throttle`.
- Não presumir que um sucesso zera os contadores K4.
- Não construir rollback que reabra acesso indevido a dados pessoais.
- Não considerar RLS suficiente para ocultar colunas de uma linha já autorizada.
- Não disponibilizar credenciais administrativas ao navegador.

## O que NÃO foi implementado (fica para os próximos Gates)

Autenticação, perfis, Dashboard funcional, ferramentas, colaboradores, Scanner, empréstimos,
devoluções, custódia, migração Firestore → PostgreSQL, esquema PostgreSQL e políticas RLS de
negócio (regras K1–K15 inclusive), PWA. **As regras K1–K15 continuam sendo requisitos
obrigatórios para os Gates seguintes** — MIG-R2 não as implementa nem as substitui.

## Limitações conhecidas (consolidado)

- O guard de isolamento valida configuração declarada, não o runtime de rede completo (ver acima).
- Os serviços do Supabase local, quando iniciados, publicam portas em todas as interfaces de
  rede da máquina (`0.0.0.0`/`[::]`), não apenas loopback — pendência sem solução dentro do
  escopo autorizado deste Gate (ver seção "Docker e isolamento de rede").
- As portas locais do Supabase foram deslocadas de `54320–54329` para `40200–40209` por causa de
  um conflito específico desta máquina com o intervalo de exclusão de portas do Windows.
