# MIG-R3 / MIG-R3.1 — Modelo PostgreSQL, autorização e RLS

Este documento descreve o modelo de dados local construído em MIG-R3 e corrigido em MIG-R3.1.
**Nada aqui está em produção**: existe apenas no Supabase local (Docker), com dados fictícios. A
autenticação definitiva, as APIs de negócio, o algoritmo K4 e qualquer migração de dados reais
continuam futuros.

> **Atualizado pelo MIG-R3.2 — leia junto com `docs/mig-r3-2-barreira.md`.** Os cinco objetos da
> aplicação saíram de `public` para o esquema dedicado `api` (`api.tool`, `api.tool_operational`,
> `api.tool_movement_log`, `api.tool_image`, `api.get_current_custodian`), e `public` ficou sem
> objetos e sem `USAGE` para `anon`, `authenticated` e `service_role`. Onde este documento escreve
> `public.<objeto>`, leia `api.<objeto>`: as garantias, GRANTs, RLS e filtros descritos abaixo foram
> preservados sem reconcessão (`ALTER ... SET SCHEMA`), e os caminhos REST não mudaram.

## Migrações

| Arquivo | Conteúdo |
|---|---|
| `supabase/migrations/20260926210000_mig_r3_schema.sql` | esquemas, correção dos privilégios padrão de `postgres`, tipos, tabelas, invariantes |
| `supabase/migrations/20260926210100_mig_r3_access.sql` | GRANTs, RLS, `authz.current_access_level()`, views operacionais |
| `supabase/migrations/20260926220000_mig_r3_1_corrections.sql` | revogação da RPC nominal, GRANT por coluna em `public.tool`, mídia, quarentena, `tool_image` |

Reprodução: `npx supabase db reset --local --network-id gf-supabase-loopback` (somente local;
nunca `--linked`, `link`, `login` ou `db push`).

## Esquemas

| Esquema | Exposto pela API REST? | USAGE | Conteúdo |
|---|---|---|---|
| `public` | sim | anon, authenticated, service_role | `tool` (operacional) e três views operacionais |
| `private` | não | somente `postgres` | tudo o que é protegido (tabela abaixo) |
| `authz` | não | `authenticated` | somente a função `current_access_level()`; nenhuma tabela |

Tabelas de `private`: `app_user` (operadores), `collaborator`, `collaborator_badge` (HMAC),
`custody`, `maintenance_record`, `movement` (histórico bruto com operador, dispositivo e IP),
`tool_admin_note`, `tool_media`, `migration_quarantine`, `badge_attempt`,
`operator_tool_throttle`, `operator_global_throttle`, `security_event`.

## GRANTs efetivos

| Objeto | anon | authenticated | service_role |
|---|---|---|---|
| `public.tool` | — | SELECT **por coluna** (id, code, name, category, condition, next_maintenance, is_complete, created_at) | SELECT, INSERT, UPDATE, DELETE |
| `public.tool_operational` | — | SELECT | — |
| `public.tool_movement_log` | — | SELECT | — |
| `public.tool_image` | — | SELECT | — |
| `public.get_current_custodian` | — | — | — |
| `authz.current_access_level` | — | EXECUTE | — |
| todas as tabelas de `private` | — | — | — |

RLS está habilitada em todas as tabelas de `public` e `private`. A única política é
`tool_select_active_operator` em `public.tool` (operador ativo). As tabelas de `private` não têm
política: mesmo um GRANT concedido por engano não retorna linhas.

`service_role` e `postgres` têm BYPASSRLS. Por isso os testes de RLS usam os papéis efetivos
`anon`/`authenticated` com sessões fictícias, e o servidor precisará verificar autorização
explicitamente sempre que usar a service role.

GRANT por coluna em `public.tool`: coluna nova adicionada no futuro não fica legível pelo cliente
até receber GRANT explícito (falha fechada; `select=*` passa a falhar em vez de vazar).

## Modelo das views operacionais

As três views (`tool_operational`, `tool_movement_log`, `tool_image`) executam com o privilégio do
dono (`postgres`), não do chamador.

**Justificativa.** A alternativa `security_invoker = true` exigiria conceder SELECT a
`authenticated` sobre `private.custody`, `private.maintenance_record`, `private.movement` e
`private.tool_media`, e USAGE sobre `private`. Como RLS filtra linhas e não colunas, qualquer
linha autorizada exporia todas as suas colunas (colaborador, crachá, IP, operador, manual) — o
que contraria K13 e a proibição de conceder acesso direto às tabelas protegidas. A view com
privilégio do dono é o mecanismo de projeção de colunas.

**Salvaguardas, todas cobertas por teste** (`supabase/tests/mig_r3_1.test.sql`):

- lista de colunas explícita; coluna nova nas tabelas de origem não aparece (V6–V8);
- `security_barrier = true` em toda view de `public` (V2);
- filtro de operador ativo dentro de cada view, pois o dono ignora RLS (V4; P6–P14);
- dono único `postgres` (V3) e conjunto de views de `public` fixo (V1);
- somente `authenticated` tem SELECT; anon e service_role não (D12; P1–P3);
- `tool_image` só entrega imagens verificadas; manuais nunca (P17, P24, P28, P29).

Não autenticado → sem GRANT. Autenticado sem sujeito, sem perfil ou inativo → zero linhas.

## Fronteira da consulta nominal (D3/K8)

`public.get_current_custodian(uuid)` existe, mas **nenhum papel de cliente a executa** (nem
PUBLIC, anon, authenticated ou service_role). Chamadas HTTP de qualquer perfil recebem 42501.
A consulta de nome e função do responsável atual será uma API de backend, com política própria
(perfil, ferramenta única, auditoria), em Gate posterior. O Padrão não tem nenhuma via de
listagem de colaboradores; nenhum perfil lê `private.custody` diretamente.

## Mídia verificada (D9)

`private.tool_media` guarda **referências** de armazenamento (chave de objeto; data URI e URLs
externas são recusadas), o tipo (`image` | `manual`) e a verificação (`verified_at` +
`verified_by`, ambos ou nenhum). No máximo uma imagem verificada vigente por ferramenta.
Somente imagens verificadas entram em `public.tool_image`; manuais permanecem protegidos.
Não há upload, verificação administrativa nem Storage configurado — isso é futuro.

## Quarentena (D10)

`private.migration_quarantine` registra coleção de origem, id legado, motivo e **nomes** dos
campos ausentes — nunca o conteúdo do documento. Um problema aberto não se duplica (reexecução
idempotente). Enquanto houver quarentena aberta, o registro não entra no destino: triggers em
`public.tool` (`code`), `private.collaborator` (`legacy_doc_id`) e `private.app_user`
(`legacy_firebase_uid`) recusam inserção/atualização, inclusive pela service_role. A resolução
exige responsável e descrição. Histórico (`history`) não tem chave legada no destino; registros
em quarentena simplesmente não são importados. Nenhuma migração real foi executada.

## Contratos TypeScript

`src/contracts/operational.ts`: interfaces e allowlists de `ToolOperational`, `ToolMovementLog`,
`ToolImage` e do composto `ToolOperationalDetail`. `project()` copia somente os campos permitidos
(em qualquer profundidade) e recusa objeto escondido em campo escalar; `assertShape()` recusa
campo extra ou ausente em qualquer profundidade. `satisfies` faz o compilador recusar allowlist
que divirja da interface. Testes: `tests/unit/operational-contracts.test.ts`; os testes HTTP
validam as respostas reais das views com esses contratos. Nenhuma API usa os contratos ainda.

## Privilégios padrão

| Papel criador | Esquema | Estado |
|---|---|---|
| `postgres` | `public`, `private`, `authz`, global | **corrigido**: objetos novos não concedem nada a PUBLIC/anon/authenticated |
| `supabase_admin` | `public` (e `graphql`, `graphql_public`, `supabase_functions`) | **não corrigido**: concede ALL/EXECUTE a anon e authenticated |

Somente `postgres` e `supabase_admin` podem criar objetos em `public`, `private` e `authz`. O
Studio local (pg-meta) usa `postgres`. Os privilégios padrão de `supabase_admin` são
administrados pelo Supabase, não podem ser alterados pelas migrações (que rodam como `postgres`)
nem no Supabase Cloud, e alterá-los localmente mudaria o comportamento de um papel interno sem
compatibilidade comprovada — por isso não foram alterados.

**Via indevida ainda efetiva, comprovada em transação desfeita:** objeto criado por
`supabase_admin` em `public` fica acessível a anon/authenticated. Isso inclui
`create extension <x>` **sem** `with schema extensions`, que cria funções em `public` com dono
`supabase_admin` e EXECUTE para anon. Regras: toda extensão em `with schema extensions`; nenhuma
DDL como `supabase_admin`. Detecção: os testes de inventário D12–D16 falham se qualquer objeto
acessível inesperado aparecer em `public`, `private`, `authz` ou `graphql_public`.
`graphql_public.graphql()` (plataforma, `pg_graphql` desabilitado) é o único item fora do projeto
executável por anon.

## Testes

```
npm run test:db           # pgTAP: supabase/tests/*.test.sql (local, rede gf-supabase-loopback)
npm run test:integration  # HTTP real (PostgREST + Auth local), sessões fictícias
npm run test:unit         # guard de isolamento + contratos
```

## Limitações conhecidas

- Privilégios padrão de `supabase_admin` (acima) — mitigados por regra e por teste, não eliminados.
- `supabase_vector` em crash-loop (Docker Engine API indisponível em modo Local only); sem
  impacto em banco, API, Auth, migrações ou testes; logs locais não são coletados.
- `security_event` bloqueia até o dono; a retenção exigirá procedimento administrativo auditado.
- `tool.is_complete` nasce `false` (falha fechada) — pendente de confirmação.
- Sem restrição de um crachá ativo por colaborador; algoritmo e chave do HMAC pendentes (MIG-R5).
- Retenção de IP/dispositivo em `movement` e de `security_event`: a definir.

## Dependências do MIG-R4

- Criação de `private.app_user` a partir do Supabase Auth (quem cria, com que perfil inicial).
- Leitura do próprio perfil pelo usuário autenticado (hoje inexistente).
- Caminho de escrita do servidor: `service_role` não tem acesso a `private`; decidir entre
  funções SECURITY DEFINER com verificação explícita de autorização ou conexão dedicada.
- API de backend da consulta nominal (D3), substituindo a RPC revogada.
- Revalidação de perfil por requisição (K7-A) — `authz.current_access_level()` já lê o status
  a cada chamada.
