# MIG-R3.3-P — Planejamento: backend exclusivo Next.js

> **Atualização MIG-R3.3-S:** o `config.toml` agora tem `[api]`, `[studio]` e `[analytics]` com
> `enabled = false`, e o `/pg/query` (risco 1) e o `/rest-admin` (risco 2) estão fechados. O teste
> API-3 foi invertido. Ver [mig-r3-3-seguranca-local.md](mig-r3-3-seguranca-local.md).

Estudo com prova local. **Nada foi implementado como arquitetura definitiva**, nada foi publicado e
nenhum ambiente hospedado foi acessado. A desativação da Data API foi temporária e revertida; o
`supabase/config.toml` do repositório continua com `[api] enabled = true`.

Rótulos usados em todo o documento:

| Rótulo | Significado |
| --- | --- |
| **COMPROVADO_LOCALMENTE** | executado neste Supabase local, com teste automatizado que pode ser repetido |
| **FUNDAMENTADO_EM_DOCUMENTACAO** | afirmado por documentação oficial ou pelo binário da CLI; não executado |
| **PROPOSTO_NAO_IMPLEMENTADO** | desenho para o Gate de implementação |
| **NAO_COMPROVADO** | nem executado nem documentado de forma suficiente |

## 1. Objetivo arquitetural

- O Next.js (Route Handlers / Server Actions / Proxy, em runtime Node) é a **única** interface de
  acesso aos dados de negócio.
- O Supabase Auth continua autenticando; o PostgreSQL continua sendo o banco.
- A RLS e os GRANTs mínimos do MIG-R3/R3.1/R3.2 continuam obrigatórios e são **os mesmos**.
- O navegador não consulta tabela, view nem RPC; só fala com o Next.js e com o endpoint do Auth.
- A Data API (PostgREST + GraphQL) pode ser desligada sem afetar Auth nem operações essenciais.

## 2. Resultado em uma tabela

| Pergunta | Resposta | Rótulo |
| --- | --- | --- |
| A Data API foi desativada no teste? | Sim: `[api] enabled = false`, container `supabase_rest` ausente | COMPROVADO_LOCALMENTE |
| Algum caminho da Data API entregou dado ou executou RPC? | Não: 336 requisições, 0 respostas 2xx, 0 dados, 0 execuções da RPC-sonda | COMPROVADO_LOCALMENTE |
| O Auth funciona sem a Data API? | Sim: endpoint, cliente, SSR com cookies, renovação, logout, rejeições | COMPROVADO_LOCALMENTE |
| Há conexão com privilégio mínimo viável? | Sim: papel de login NOINHERIT, sem BYPASSRLS, só assume `authenticated` | COMPROVADO_LOCALMENTE |
| A RLS por transação funciona sem vazar contexto? | Sim, inclusive com conexão reutilizada, erro no meio e concorrência | COMPROVADO_LOCALMENTE |
| O mesmo vale no Supabase hospedado? | Não verificado; só há documentação para parte do caminho | NAO_COMPROVADO |

## 3. Inventário de dependências

| Componente | Quem usa hoje | Com a Data API desligada | Classe |
| --- | --- | --- | --- |
| PostgREST (`/rest/v1`, `/rest-admin/v1`) | só `tests/integration/*` | indisponível (503) | exclusiva de testes antigos |
| GraphQL (`/graphql/v1`) | ninguém (`pg_graphql` desabilitado) | indisponível (503) | não usado |
| Supabase Auth (GoTrue, `/auth/v1`) | testes; será usado pela aplicação | **funciona** | necessária à aplicação |
| Auth Admin API (`/auth/v1/admin`) | testes (contas fictícias) | **funciona** | testes / administração |
| PostgreSQL direto (40202) | pgTAP, fixtures via `psql`, backend proposto | **funciona** | necessária à aplicação |
| Storage | ninguém (0 buckets) | funciona, sem uso | fora da primeira versão |
| Realtime | ninguém (publicação `supabase_realtime` sem tabelas) | funciona, sem uso | fora da primeira versão |
| Studio / pg-meta (40203, `/pg/`) | administração local | funciona | ferramenta administrativa local |
| pgTAP (`supabase test db`) | `npm run test:db` | **funciona** (179/179) | exclusiva de testes |
| Supabase CLI (`migration list --local`, `start/stop`) | desenvolvimento | **funciona** | ferramenta local |
| Edge Runtime, Analytics, Mailpit | ninguém | funcionam, sem uso | fora da primeira versão |

Dependências novas **somente na branch do spike** (devDependencies, versão exata): `pg@8.23.0`,
`@types/pg@8.23.1`, `@supabase/supabase-js@2.117.2`, `@supabase/ssr@0.12.7`.

## 4. Configuração estudada

**`[api] enabled`** — FUNDAMENTADO_EM_DOCUMENTACAO (binário da CLI 2.118.0: *"Enable the local
PostgREST service."*) e COMPROVADO_LOCALMENTE: com `false`, `supabase start` não cria o container
`supabase_rest_*`; todos os demais sobem.

**`[auth] enabled`** permaneceu `true` e não foi tocado. As duas chaves não foram alteradas juntas.

Comportamento observado que o nome da chave não revela:

- O Kong local **mantém** as rotas `/rest/v1/`, `/rest-admin/v1/` e `/graphql/v1` apontando para o
  hostname do PostgREST e responde **503 `name resolution failed`**. O bloqueio local é a
  **ausência do upstream**, não uma política do gateway. Um container com esse nome na rede
  `gf-supabase-loopback` voltaria a receber o tráfego.
- O papel `authenticator` continua existindo no banco (sem conexões).

**Hospedado** — FUNDAMENTADO_EM_DOCUMENTACAO ([Securing your API](https://supabase.com/docs/guides/api/securing-your-api)):
*"Open the Data API integration overview in the Dashboard. Turn Enable Data API off."* e *"With the
Data API disabled, none of the auto-generated REST endpoints respond, regardless of grants or RLS."*
O binário da CLI também conhece o estado (`the Data API is disabled on the project; declare
api.enabled = true to apply this`), ou seja, `config push` mapeia `api.enabled` para o projeto
hospedado. A documentação **não** afirma que Auth, Storage e Realtime continuam iguais com a
Data API desligada no hospedado → **NAO_COMPROVADO** até o Gate de implementação testar em um
projeto descartável.

## 5. Prova de desativação da Data API

`tests/spike/mig-r3-3-data-api.test.ts` (COMPROVADO_LOCALMENTE):

- **Matriz:** 14 caminhos × 8 perfis de esquema (`Accept-Profile`/`Content-Profile`: nenhum,
  `api`, `public`, `private`, `authz`, `graphql_public`, `auth`, `storage`) × 3 identidades (sem
  JWT, usuário fictício Administrador ativo, `service_role` local) = 336 requisições.
- **Caminhos:** `/rest/v1/`, `tool`, `tool_operational`, `tool_movement_log`, `app_user`,
  `collaborator`, `rpc/<sonda>` (POST e GET), `rpc/get_current_custodian`,
  `rpc/current_access_level`, `/graphql/v1`, `/rest-admin/v1/schema_cache|ready|metrics`.
- **Sonda de execução:** função temporária em `api` com EXECUTE para os três papéis, que incrementa
  uma sequência temporária em `private`. Com a Data API desligada a sequência **não andou**.
- **Resultado desligada:** 0 respostas 2xx; nenhuma resposta contém o código da ferramenta nem o
  nome do colaborador sentinela; 0 execuções.
- **Controle (`EXPECT_DATA_API=on`)**, com a Data API ligada: a RPC executa e a `service_role`
  recebe o dado → a sonda detecta exposição real. E o modo `off` **falha** (2 de 4) quando a Data
  API está ligada. O teste não passa por acidente.
- Não se exigiu código HTTP específico; o observado foi 503.

**Caminhos alternativos examinados:**

| Caminho | Situação | Rótulo |
| --- | --- | --- |
| Realtime `postgres_changes` | publicação `supabase_realtime` sem tabelas → não entrega linha de negócio | COMPROVADO_LOCALMENTE (catálogo) |
| Storage | 0 buckets; opera só o esquema `storage` | COMPROVADO_LOCALMENTE (catálogo) |
| `/rest-admin/v1/schema_cache` | **com a Data API ligada** entrega metadados (nomes de views e RPCs de `api`) **sem autenticação**; desligada, 503 | COMPROVADO_LOCALMENTE |
| `/pg/query` (pg-meta local) | executa SQL como `postgres` **sem chave**, com CORS `*`, com ou sem Data API | COMPROVADO_LOCALMENTE — ver Riscos |
| Conexão direta ao PostgreSQL | superfície distinta, não afetada pela Data API; protegida por SCRAM e loopback | COMPROVADO_LOCALMENTE |

O PostgreSQL **não** fica inacessível: a conexão direta é outra superfície, e é justamente a que o
backend proposto usa.

## 6. Prova do Supabase Auth

`tests/spike/mig-r3-3-backend.test.ts`, executado com a Data API **desligada** e de novo ligada,
18/18 nas duas (COMPROVADO_LOCALMENTE). Só contas `@example.test`, criadas e apagadas pela
execução; nenhum token ou senha é impresso.

| Teste | O que prova |
| --- | --- |
| AUTH-1 | `/auth/v1/health` 200; JWKS publica chave **ES256** (assinatura assimétrica) |
| AUTH-2 | `@supabase/supabase-js` faz login; o servidor valida com `auth.getUser(token)` |
| AUTH-3 | `refreshSession()` emite novo access token e **rotaciona** o refresh token |
| AUTH-4 | após `signOut`, `getUser` recusa o token e o refresh token revogado é recusado; **`getClaims` (JWKS local) continua aceitando até o `exp`** |
| AUTH-5 | token com `sub` trocado (assinatura original) recusado por `getUser` e `getClaims` |
| AUTH-6 | lixo, `alg: none` e assinatura corrompida recusados |
| AUTH-7 | token HS256 **corretamente assinado** com `exp` no passado é recusado; o controle idêntico e não expirado é aceito (a recusa é pela expiração) |
| SSR-1 | `@supabase/ssr` grava a sessão via `setAll` (`path=/`, `sameSite=lax`, `maxAge>0`) |
| SSR-2 | nova requisição reconstrói a sessão a partir dos cookies (`getAll`) |
| SSR-3 | sessão vencida no cookie → renovação automática com refresh token e cookie regravado |
| SSR-4 | logout remove o cookie e o token passa a ser recusado |

**Integração com Next.js 16:** `cookies()` é assíncrono e só grava em Server Functions e Route
Handlers; `middleware` foi renomeado para `proxy` e roda em Node por padrão
(FUNDAMENTADO_EM_DOCUMENTACAO, `node_modules/next/dist/docs`). O adaptador `getAll/setAll` dos
testes tem exatamente a forma exigida por `createServerClient`. **Um Route Handler real do Next.js
com `await cookies()` não foi executado** → NAO_COMPROVADO (primeiro item do Gate de implementação).

**Cookies:** `@supabase/ssr` grava por padrão `httpOnly: false` (para o cliente do navegador ler).
Nesta arquitetura o navegador não precisa ler a sessão, então o adaptador força `httpOnly: true`
(PROPOSTO_NAO_IMPLEMENTADO; os testes registram a opção, não um navegador real). Em produção:
`secure: true`.

**Verificação no servidor — decisão proposta:** `auth.getUser(token)` a cada requisição, porque é
a única das duas que enxerga logout (AUTH-4). `getClaims` é mais rápida e dispensa ida ao Auth,
mas deixa uma janela de até `jwt_expiry` (3600 s) depois do logout. Se o custo de latência pesar,
a alternativa é `getClaims` + checagem de `session_id` em `auth.sessions` dentro da mesma
transação (exige GRANT a decidir).

## 7. Alternativas de conexão ao PostgreSQL

| Critério | A. Direta (5432) | B. Supavisor session (5432) | C. Supavisor transaction (6543) |
| --- | --- | --- | --- |
| Rede no hospedado | IPv6; IPv4 só com add-on pago (que **troca** o AAAA por A) | IPv4 | IPv4 |
| Vercel Functions (sem saída IPv6) | só com add-on IPv4 | funciona | funciona |
| Uso indicado pela Supabase | backends persistentes | alternativa IPv4 à direta | **serverless / edge** |
| Conexões | 1 por instância × pool | 1 por cliente durante a sessão | multiplexadas por transação |
| Prepared statements nomeados | sim | sim | **não** |
| `SET LOCAL` + `set_config(..., true)` | sim | sim | **sim** (escopo de transação) |
| `SET` / `set_config(..., false)` de sessão | vazaria entre usos do pool | vazaria entre clientes | **vazaria entre clientes** |
| TLS | `sslmode=require`; `verify-full` com a CA da Supabase | idem | idem |

Rede, prepared statements e TLS: FUNDAMENTADO_EM_DOCUMENTACAO
([Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres):
*"Transaction mode does not support prepared statements"*, *"Use it for serverless and edge
functions"*; [IPv4/IPv6](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP)).
A falta de saída IPv6 nas Vercel Functions foi confirmada em fórum da Vercel, não em documentação
formal → reconfirmar no Gate de implementação.

**Proposta (PROPOSTO_NAO_IMPLEMENTADO):** C, **transaction mode**, pool pequeno (`max` 1–3 por
instância), TLS `verify-full`, `pg` sem statements nomeados. O desenho de contexto já é 100%
transacional, então é compatível com C por construção; DB-9 e DB-10 provam isso com a
reutilização de conexão mais agressiva possível (pool de 1).

**NAO_COMPROVADO:** o Supavisor em si (desabilitado no stack local); login de papel customizado
pelo Supavisor (`<papel>.<project_ref>`); limites de conexão do plano.

## 8. Modelo proposto de autorização

Fluxo comprovado localmente (`tests/spike/support/operator-tx.ts`):

```
navegador ──cookie httpOnly──▶ Next.js (Route Handler / Server Action)
  1. auth.getUser(token)            identidade verificada pelo Auth (nunca user_id do cliente)
  2. pool.connect()                 papel de login SEM privilégio próprio (NOINHERIT)
  3. BEGIN
  4. SET LOCAL ROLE authenticated   papel fixo no código
  5. set_config('request.jwt.claims', {"sub": <id verificado>}, true)   escopo de transação
  6. authz.current_access_level()   perfil + status ativo revalidados (K7); NULL → 403
  7. SQL fixo e parametrizado       sob RLS e GRANTs atuais
  8. COMMIT | ROLLBACK              papel e claims somem; conexão volta limpa ao pool
```

**Papel de backend (PROPOSTO_NAO_IMPLEMENTADO; criado e removido pelo spike como `gf_spike_backend`):**

```sql
create role gf_app_backend login noinherit nobypassrls nocreatedb nocreaterole noreplication
  connection limit <n>;                                   -- senha só em variável de servidor
grant authenticated to gf_app_backend with inherit false, set true;
-- nenhum outro GRANT, nenhum membership em service_role, anon, authenticator ou postgres
```

É o mesmo padrão do `authenticator` do PostgREST, **sem** a capacidade de assumir `service_role`.

O que os testes comprovaram sobre esse papel:

| Teste | Garantia |
| --- | --- |
| DB-1 | `rolbypassrls = f`, `rolinherit = f`, `rolsuper = f`; login SCRAM pela porta de loopback |
| DB-2 | sem `SET LOCAL ROLE` não lê `api.*` nem `private.*` (42501); `SET LOCAL` fora de transação não tem efeito (**falha fechada** se o código esquecer o BEGIN) |
| DB-3 | `SET LOCAL ROLE` para `service_role`, `postgres`, `supabase_admin`, `authenticator`, `anon` → 42501 |

## 9. Preservação da RLS e testes negativos

| Teste | Caso | Resultado |
| --- | --- | --- |
| DB-4 | Administrador, Padrão, Restrito ativos | leem `tool_operational` e `tool_movement_log`; linhas validadas pelos contratos TypeScript; nenhum valor sentinela pessoal |
| DB-5 | sem sessão, token inválido, token adulterado | `Unauthorized` **sem tocar no pool** |
| DB-5 | autenticado sem perfil; operador inativo | `Forbidden`; e, mesmo sem a checagem da aplicação, views e RLS devolvem 0 linhas |
| DB-6 | operador desativado entre duas requisições (K7) | a seguinte é recusada; reativado, volta a ler |
| DB-7 | K8/K13 — Administrador, Padrão, Restrito | `private.collaborator`, `custody`, `movement`, `app_user` e `api.get_current_custodian` → 42501 para todos |
| DB-8 | `user_id` do navegador | ignorado: o contrato do handler só aceita o token |
| DB-8 | SQL arbitrário na conexão | **troca as claims** (Restrito vira Administrador). Registrado como risco, não como defesa |
| DB-9 | conexão reutilizada após COMMIT, ROLLBACK por exceção e erro SQL | `current_user` volta a `gf_spike_backend`, claims vazias, `api.tool` negado |
| DB-10 | **controle negativo**: `SET ROLE` e `set_config(..., false)` de sessão | o vazamento é reproduzido → o DB-9 detectaria |
| DB-11 | 45 transações concorrentes de 3 usuários, pool de 3, intercaladas por `pg_sleep` | cada uma vê o próprio `auth.uid()` e o próprio perfil |
| NET-1 | 40201/40202 | aceitos em `127.0.0.1` e `::1`; recusados em todo IPv4/IPv6 não loopback da máquina |

K7 e K8 preservados. O Padrão continua **sem** qualquer leitura nominal: a API específica do
responsável atual (D3) não foi implementada. A conexão direta não expõe `private` ao cliente: o
navegador não recebe credencial de banco, e o papel de backend também não lê `private`.

## 10. Compatibilidade com o modelo atual

| Objeto | Decisão proposta |
| --- | --- |
| `api.tool` | **reutilizar**. SELECT por coluna para `authenticated` + política `tool_select_active_operator` funcionam pela conexão do backend (DB-4, DB-5). **Adaptar a escrita**: hoje só `service_role` escreve, e o backend não usa `service_role` |
| `api.tool_operational` | **reutilizar sem mudança** (DB-4). Filtro de operador ativo e `security_barrier` continuam valendo |
| `api.tool_movement_log` | **reutilizar sem mudança** (DB-4); sem operador, dispositivo ou IP |
| `api.tool_image` | **reutilizar sem mudança**; não exercitado pelo spike (coberto pelos testes do MIG-R3.1) |
| `authz.current_access_level` | **reutilizar**: é o passo 6 do fluxo (revalidação por requisição, K7) |
| `api.get_current_custodian` | hoje ninguém executa. Candidata a base da API nominal D3 (EXECUTE para `authenticated`, alcançável só pelo backend depois de desligar a Data API) **ou** substituição. Decisão pendente |
| `USAGE` de `anon` em `api` | removível **depois** de desligar a Data API (existia para produzir 42501 em vez de 404) |
| GRANTs de `service_role` em `api.tool` | removíveis se o backend nunca usar `service_role` |

Nada foi removido neste estudo. D3, D4, D5, D9, D10 e K1–K15 não foram alterados; nenhum GRANT em
`private` foi ampliado.

**Formato de data:** `pg` entrega `date`/`timestamptz` como `Date`. Depois de `Response.json` saem
como ISO 8601 UTC (`2026-09-27T02:15:12.123Z`), diferente do PostgREST
(`2026-09-27T02:15:12.123+00:00`; `date` como `2026-09-27`). Os contratos continuam válidos
(escalares); a serialização de `date` precisa ser decidida para não virar data-hora em UTC.

**Lacuna do MIG-R3.2-V (EXECUTE automático em funções de `supabase_admin` em `api`):** com a Data
API desligada, o vetor HTTP some. Ao nível SQL a lacuna continua, mas só seria alcançável se o
backend chamasse essa função, e o backend só emite SQL fixo. O risco cai de "exposição HTTP
latente" para "SQL latente". A lacuna **não foi corrigida**.

## 11. Impacto nos testes existentes

| Suíte | Data API ligada (antes) | Data API desligada | Restaurada (depois) |
| --- | --- | --- | --- |
| pgTAP | 179/179 | **179/179** | 179/179 |
| HTTP (`tests/integration`) | 16/16 | 4/16: **12 incompatíveis** | 16/16 |
| Unitários | 21/21 | 21/21 | 21/21 |
| Spike backend | 18/18 | **18/18** | 18/18 |
| Spike Data API | controle `on` 4/4 | **`off` 4/4** | controle `on` 4/4 |
| `tsc` / `eslint` | 0 / 0 | — | 0 / 0 |

Os 12 testes HTTP que falham com a Data API desligada afirmam comportamento **do PostgREST**
(códigos PGRST106/PGRST205/42501, leitura das projeções por HTTP). Não é falha de segurança: são
**incompatíveis com a arquitetura proposta**. Não foram apagados nem alterados. No Gate de
implementação devem ser migrados para a forma "pela conexão do backend" (DB-4..DB-7 já cobrem as
mesmas garantias), ou mantidos atrás de uma flag enquanto a Data API existir.

## 12. Riscos e limitações

1. **pg-meta local sem autenticação e com CORS aberto.** `POST http://127.0.0.1:40201/pg/query`
   executa SQL como `postgres` sem chave e responde `Access-Control-Allow-Origin: *`. Loopback não
   protege contra uma **página web** aberta nesta máquina, que pode fazer a requisição. Existe com
   ou sem Data API (API-3 caracteriza). Hoje não há dado real no banco local. Mitigações possíveis,
   **não aplicadas**: parar o stack quando não estiver em uso; `[studio] enabled = false` (a
   verificar se remove o pg-meta). Não há indício de que o hospedado exponha `/pg/` no domínio do
   projeto → NAO_COMPROVADO.
2. **`/rest-admin/v1/schema_cache` sem autenticação** enquanto a Data API está ligada (metadados,
   sem linhas). Some com a Data API desligada.
3. **SQL arbitrário = impersonação** (DB-8). `set_config` é executável por qualquer papel e o
   PostgreSQL não restringe GUCs customizados. Defesa: SQL fixo e parametrizado, sem SQL dinâmico
   com entrada do cliente, revisão e lint. Mesmo modelo de confiança do PostgREST.
4. **Janela de logout com `getClaims`** (AUTH-4): até `jwt_expiry`. Mitigado pela escolha de
   `getUser`.
5. **Bloqueio local por ausência de upstream** (seção 4), não por política do Kong.
6. **Conexão de sessão contaminada**: qualquer `SET`/`set_config` sem escopo local vaza (DB-10).
   Regra: só `SET LOCAL` e `set_config(..., true)`; descartar a conexão se o ROLLBACK falhar (já
   feito no helper).
7. **Hospedado não validado**: toggle da Data API, Auth sem Data API, Supavisor com papel
   customizado, IPv4, TLS e limites de conexão são NAO_COMPROVADO ou só documentados.
8. **Next.js real não executado** com `cookies()`; os testes usam um adaptador equivalente.
9. **`authenticated` é compartilhado** com Storage e Realtime. Hoje nenhum dos dois alcança dado de
   negócio (0 buckets, publicação vazia). Se passarem a ser usados, reavaliar ou migrar para um
   papel próprio (decisão pendente 3).
10. **`supabase_vector`** segue em `Restarting` (limitação ambiental conhecida, sem impacto).

## 13. Plano de implementação (MIG-R3.3, após revisão)

1. Migração criando `gf_app_backend` (seção 8); credencial só em variável de servidor, **nunca**
   `NEXT_PUBLIC_*`; estender o guard de isolamento para recusar `NEXT_PUBLIC_*DATABASE*`.
2. `src/infrastructure/db`: pool `pg` (`max` pequeno, TLS configurável) + `withOperator`
   promovido do spike, com testes DB-1..DB-11 migrados para `tests/integration`.
3. `src/authz`: verificação por `auth.getUser` + cliente `@supabase/ssr` com cookie `httpOnly`,
   `secure`, `sameSite=lax`; `proxy.ts` só para renovar sessão, sem regra de autorização.
4. Um Route Handler de leitura (`tool_operational`) como prova ponta a ponta com Next.js real.
5. Caminho de escrita: funções `SECURITY DEFINER` com checagem explícita de perfil **ou** GRANTs
   de escrita para `authenticated` sob RLS com políticas. Decidir antes de qualquer escrita.
6. Desligar a Data API em `config.toml`; migrar os 12 testes HTTP; remover `USAGE` de `anon` em
   `api`; decidir os GRANTs de `service_role`.
7. Validar em **projeto hospedado descartável, sem dados reais**, antes de qualquer Preview:
   toggle da Data API, Auth, Supavisor transaction mode com papel customizado, TLS `verify-full`.

## 14. Plano de reversão

- **Este estudo:** reverter é `git checkout -- supabase/config.toml` + `supabase stop` +
  `supabase start --network-id gf-supabase-loopback`. Executado e verificado: mesmos 12
  containers, rede com as mesmas opções, 216/216.
- **Implementação futura:** religar a Data API (`api.enabled = true` ou o toggle do Dashboard) só
  reabre o PostgREST com os **mesmos** GRANTs e RLS de hoje; nenhuma permissão é ampliada pela
  reversão. Remover `gf_app_backend` com `drop role` depois de terminar as conexões. Qualquer
  remoção de GRANT feita no passo 6 precisa da migração inversa revisada **antes**, para não
  reabrir acesso sem teste.

## 15. Decisões pendentes

1. `getUser` por requisição (proposto) × `getClaims` + checagem de sessão no banco.
2. Caminho de escrita: `SECURITY DEFINER` × GRANTs de escrita com políticas RLS.
3. Reutilizar `authenticated` (proposto, zero mudança nos GRANTs) × papel próprio (`app_operator`)
   para desacoplar de Storage/Realtime.
4. API nominal D3: reutilizar `api.get_current_custodian` × nova função com auditoria.
5. Serialização de `date` nas respostas.
6. Mitigação do pg-meta local (seção 12, item 1).
7. Destino dos 12 testes HTTP e do `USAGE` de `anon` em `api` após desligar a Data API.
8. Supavisor transaction mode × add-on IPv4 com conexão direta, após medir no hospedado.

## Reprodução

```
npm run test:spike:backend                        # vale com a Data API ligada ou desligada
EXPECT_DATA_API=on  npm run test:spike:data-api   # controle (Data API ligada)
EXPECT_DATA_API=off npm run test:spike:data-api   # exige [api] enabled = false + restart local
```

Somente local: nunca `--linked`, `link`, `login` ou `db push`.
