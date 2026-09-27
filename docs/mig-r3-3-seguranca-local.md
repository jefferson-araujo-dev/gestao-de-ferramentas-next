# MIG-R3.3-S — Segurança dos serviços administrativos locais

Gate de contenção executado **somente no Supabase local** (CLI 2.118.0, Docker Desktop, rede
`gf-supabase-loopback`). Nada foi publicado, nenhum ambiente hospedado foi acessado e nenhum dado
real foi usado (banco local vazio; contas de teste `@example.test`, criadas e apagadas pelos
testes). Nenhuma sonda executou algo além de `select 1` / `select '<marcador>'` ou leitura de
catálogo (`pg_roles`, `current_user`). Nenhuma senha, JWT ou chave está registrada aqui.

MIG-R3.3 (implementação), UX-0 e MIG-R4 **não** foram iniciados.

## 1. Resultado

| Item | Antes (estado original) | Depois (configuração versionada) |
| --- | --- | --- |
| `/pg/query` (Kong → pg-meta) | executa SQL como `postgres` sem chave, CORS `*` | **503**, pg-meta não existe |
| `/rest-admin/v1/schema_cache` (Kong → PostgREST admin) | 200 sem chave, CORS `*` | **503**, PostgREST não existe |
| `/mcp` (Kong → Studio) | `execute_sql` / `apply_migration` sem chave, CORS `*` | **503**, Studio não existe |
| Studio `:40203` (`/api/platform/pg-meta/*/query`, `/api/mcp`) | executa SQL sem chave | porta **não publicada** |
| Logflare `:40207` e `/analytics/v1` | sessão do painel sem credencial | porta **não publicada**, rota 503 |
| Data API (`/rest/v1`, `/graphql/v1`) | ligada | **desligada** (503) |
| Supabase Auth | funcional | **funcional** |
| PostgreSQL `:40202` | funcional | **funcional** |
| Portas publicadas | 40201, 40202, 40203, 40204, 40207 (loopback) | **40201, 40202, 40204** (loopback) |

Configuração escolhida (`supabase/config.toml`, com comentário em cada chave):

```toml
[api]
enabled = false        # PostgREST + GraphQL + porta admin (/rest-admin)
[studio]
enabled = false        # Studio + pg-meta (/pg, /mcp, :40203)
[analytics]
enabled = false        # Logflare + Vector (/analytics, :40207)
```

`[auth]` e `[db]` não foram tocados. Nenhum arquivo gerado pela CLI, nenhum template do Kong e
nenhum papel interno do Supabase foi modificado.

## 2. Diagnóstico

### 2.1 Gateway

O Kong local (`kong:2.8.1`, `KONG_DATABASE=off`) lê um `kong.yml` declarativo que a CLI grava
dentro do container a cada `supabase start`. O template é **fixo**: todas as rotas existem
sempre, qualquer que seja a configuração; o que muda é só a existência do container de destino.
Nenhuma rota administrativa tem plugin de autenticação — só `cors` (o próprio template marca
`/rest-admin` com `# TODO: validate apikey`).

| Rota Kong | Upstream | Plugins | Container |
| --- | --- | --- | --- |
| `/pg/` | `supabase_pg_meta_…:8080/` | `cors` | `supabase_pg_meta` (postgres-meta v0.99.0) |
| `/rest-admin/v1/` | `supabase_rest_…:3001/` | `cors` | `supabase_rest` (porta admin do PostgREST) |
| `/mcp` | `supabase_studio_…:3000/api/mcp` | `cors` | `supabase_studio` |
| `/analytics/v1/` | `supabase_analytics_…:4000/` | `cors` | `supabase_analytics` (Logflare 1.50.12) |
| `/pooler/v2/` | `supabase_pooler_…:4000/v2` | `cors` | não existe (`[db.pooler] enabled = false`) |

Porta publicada para todas: **40201** (a do Kong), em `127.0.0.1` e `[::1]`. pg-meta e PostgREST
não publicam porta própria; Studio publica 40203 e Logflare 40207.

### 2.2 `/pg/query` — causa comprovada

- Serviço: **pg-meta** (`supabase_pg_meta`), não o Studio nem o PostgREST.
- Conecta ao banco como `postgres` (`PG_META_DB_USER=postgres`). `postgres` local:
  `rolsuper = f`, **`rolbypassrls = t`, `rolcreaterole = t`** — ignora RLS em todas as tabelas.
- Autenticação exigida: **nenhuma**. Sem chave, com `apikey`/`Authorization` fictícios e com
  `Origin` estranha → `200 [{"ok":1}]`, `current_user = postgres`.
- CORS: `Access-Control-Allow-Origin: *`; preflight `OPTIONS` com `content-type` → 200,
  `Allow-Headers: content-type`, `Allow-Methods` inclui `POST`.
- Dependência do Studio: **total**. Na CLI 2.118.0 o pg-meta só sobe quando `studio.enabled`
  é verdadeiro. Trecho do binário: `pgMeta: h && !u("postgres-meta"), studio: h && !u("studio")`
  com `h = Jt("SUPABASE_STUDIO_ENABLED", n.studio.enabled, "studio.enabled")`. Comprovado nos
  cenários B e D.
- Dependência da Data API: **nenhuma**. Com `[api] enabled = false` (cenário C) continua
  executando.

### 2.3 `/rest-admin/v1/schema_cache` — causa comprovada

- Serviço: **porta administrativa (3001) do PostgREST** (`supabase_rest`). É outro serviço,
  diferente do `/pg/query`.
- Autenticação: **nenhuma** (o Kong não valida `apikey` nessa rota). `schema_cache`, `ready`,
  `live` e `metrics` → 200 sem chave, com chave fictícia e de outra origem; `config` → 404.
- Conteúdo: metadados do cache de esquema (nomes de views, colunas e RPCs expostas em `api`),
  sem linhas de dados.
- CORS: `*`; preflight `GET` → 200.
- Dependência da Data API: **total** (`api.enabled` controla o container `supabase_rest`).
  Cenários C e D.
- Dependência do Studio: **nenhuma**. Com `[studio] enabled = false` (cenário B) continua 200.

### 2.4 Caminhos equivalentes identificados

| Caminho | Situação original | O que fecha |
| --- | --- | --- |
| `POST :40201/mcp` (`tools/call execute_sql`) | executa SQL sem chave, CORS `*`; também oferece `apply_migration` | `[studio] enabled = false` |
| `POST :40203/api/platform/pg-meta/default/query` | executa SQL sem chave; sem cabeçalho CORS; preflight → 405 | `[studio] enabled = false` |
| `POST :40203/api/mcp` | executa SQL sem chave | `[studio] enabled = false` |
| `GET :40207/auth/login/single_tenant` | 302 + cookie de sessão do painel **sem credencial** (Logflare single tenant, banco como `supabase_admin`); `/dashboard` respondeu 500 | `[analytics] enabled = false` |
| `GET :40201/analytics/v1/health` | 200 sem chave, CORS `*` (API de consulta exige chave: 401) | `[analytics] enabled = false` |
| `GET :40201/rest/v1/` (sem chave) | 200: documento OpenAPI da superfície `api` | `[api] enabled = false` |

Examinados e **não** administrativos-abertos: `/auth/v1/admin/*` (401 sem Bearer válido),
`/storage/v1/*` (403 `Invalid Compact JWS`), `/realtime/v1/api/*` (403), `/functions/v1/*`
(404, sem funções), `/pooler/v2/*` (503, sem upstream), Mailpit `:40204/api/v1/*` (403 para
`Origin` estranha; ver limitações).

## 3. Autenticação e CORS

Classificação (A inacessível · B autenticado · C acessível sem autenticação · D só por origem):

| Endpoint | Sem chave | Chave fictícia | Outra origem | Preflight | Classe original | Classe final |
| --- | --- | --- | --- | --- | --- | --- |
| Kong `/pg/query` | 200 executa | 200 executa | 200 executa, ACAO `*` | 200 | **C** | **A** (503) |
| Kong `/rest-admin/v1/schema_cache` | 200 | 200 | 200, ACAO `*` | 200 | **C** | **A** (503) |
| Kong `/mcp` | 200 executa | 200 executa | 200 executa, ACAO `*` | 200 | **C** | **A** (503) |
| Studio `:40203` query | 200 executa | 200 executa | 200 executa, sem ACAO | 405 | **C** (bloqueado ao navegador) | **A** (porta fechada) |
| Logflare `:40207` login | 302 + sessão | 302 + sessão | 302 + sessão | — | **C** | **A** (porta fechada) |

**Prova em navegador** (Chromium via `playwright-cli`, página servida em
`http://localhost:5555`, origem distinta do gateway `http://127.0.0.1:40201`):

- estado original: `fetch` a `/pg/query` → `200 [{"ok":1}]`; `/rest-admin/v1/schema_cache` → 200
  com o cache; `/mcp execute_sql` → 200 com o resultado; Studio `:40203` → `Failed to fetch`
  (bloqueado pelo CORS) e, em `no-cors` com `text/plain`, o servidor não interpreta o corpo (500)
  — não executa;
- configuração final: as três rotas do Kong → 503; Studio `:40203` → `Failed to fetch` (porta
  fechada); `/auth/v1/health` → 200.

Comprovado: **uma página de outra origem local** conseguia executar SQL como `postgres`.
**Não comprovado:** uma página da internet pública — navegadores recentes aplicam proteções de
acesso à rede local (Private/Local Network Access) que não foram testadas aqui. O risco foi
tratado como real mesmo assim.

**CORS não é autenticação:** na configuração final o Kong ainda responde 200 ao preflight
`OPTIONS` dessas rotas (o plugin `cors` responde sem consultar o upstream); a requisição real
recebe 503. O fechamento vem da **ausência do serviço**, não de uma política de origem.

## 4. Matriz de configurações

Cada cenário: edição de `supabase/config.toml`, `supabase stop` + `supabase start --network-id
gf-supabase-loopback` (só o stack Supabase), sondas sem chave com `Origin` estranha,
`npm run test:security` (modo `closed`). A rede manteve as mesmas opções em todos
(`host_binding_ipv4 = 127.0.0.1`, IPv6 desabilitado). PostgreSQL (`select 1`) e Auth
(`/auth/v1/health` 200 + AUTH-1) funcionaram em **todos**.

| | A. original | B. só Studio off | C. só Data API off | D. Studio + Data API off | **E. D + analytics off (final)** |
| --- | --- | --- | --- | --- | --- |
| `studio` / `api` / `analytics` | on/on/on | off/on/on | on/off/on | off/off/on | **off/off/off** |
| Containers | 12 (vector em restart) | 10 | 11 | 9 | **7** |
| Portas publicadas | 40201-40204, 40207 | 40201, 40202, 40204, 40207 | 40201-40204, 40207 | 40201, 40202, 40204, 40207 | **40201, 40202, 40204** |
| `/pg/query` | 200 executa | 503 | 200 executa | 503 | **503** |
| `/rest-admin/v1/schema_cache` | 200 | 200 | 503 | 503 | **503** |
| `/mcp execute_sql` | 200 executa | 503 | 200 executa | 503 | **503** |
| Studio `:40203` | executa | recusada | executa | recusada | **recusada** |
| Logflare `:40207` / `/analytics/v1` | 200 / 302 | 200 / 302 | 200 / 302 | 200 / 302 | **recusada / 503** |
| `/rest/v1/` | 200 | 200 | 503 | 503 | **503** |
| Auth / PostgreSQL | ok / ok | ok / ok | ok / ok | ok / ok | **ok / ok** |
| `test:security` (closed) | 2/6 | 2/6 | 3/6 | 3/6 | **6/6** |
| `test:integration` | 16/16 | 16/16 | — | — | **4/16** (esperado, §7) |

Conclusões:

- `[studio] enabled = false` **desativa também o pg-meta** (e com ele `/pg/*` e `/mcp`). Não
  desativa `/rest-admin`.
- `[api] enabled = false` remove `/rest/v1`, `/graphql/v1` **e** `/rest-admin/v1`, mas **não**
  mexe no pg-meta.
- Nenhuma das duas remove rotas do Kong: o gateway continua com todas e responde
  `503 name resolution failed`.
- Só a combinação E elimina todos os caminhos administrativos identificados.

## 5. Por que esta correção é suportada e reproduzível

- As três chaves são opções documentadas da CLI instalada (descrições do binário: *"Enable the
  local PostgREST service."*, *"Enable the local Supabase Studio dashboard."*, *"Enable the local
  Logflare service."*) e vivem no `config.toml` versionado.
- Não houve edição de arquivo temporário, template do Kong, proxy, autenticação improvisada nem
  alteração do Docker Desktop.
- Reprodução comprovada: após restaurar a configuração final, `supabase stop` +
  `supabase start --network-id gf-supabase-loopback` → mesmos 7 containers, mesmas portas,
  `test:security` 6/6. `supabase db reset --local` com essa configuração reaplicou as 4 migrações
  sem recriar nenhum serviço administrativo.
- `npm run supabase:start` passou a incluir `--network-id gf-supabase-loopback` (antes o script
  subia o stack fora da rede dedicada).

## 6. Auth e PostgreSQL na configuração final

| Verificação | Resultado |
| --- | --- |
| `/auth/v1/health` | 200 |
| Login por senha, validação (`/user`), renovação com refresh token, logout, sessão encerrada recusada, token inválido recusado | AUTH-1 ok |
| Suíte do MIG-R3.3-P (`test:spike:backend`): AUTH-1..7, SSR-1..4, DB-1..11, NET-1 | **18/18** |
| Conexão PostgreSQL local pelo papel mínimo proposto (DB-1..DB-11, SCRAM, loopback) | ok (dentro dos 18) |
| RLS transacional (`SET LOCAL ROLE` + `set_config(..., true)`), reutilização e concorrência | ok (DB-9..DB-11) |
| Migrações locais (`supabase db reset --local`) | 4/4 aplicadas |
| pgTAP (`npm run test:db`) | **179/179** |

O desenho de backend do MIG-R3.3-P não muda: o backend usa conexão direta com papel próprio
(NOINHERIT, sem BYPASSRLS) e não depende de Studio, pg-meta, PostgREST ou Logflare. `postgres`
continua sendo usado só por `psql`/pgTAP de preparação e teste, nunca como conexão do backend.
Nenhum login definitivo do aplicativo foi implementado.

## 7. Testes

### 7.1 Novos — `tests/security/mig-r3-3-local-admin.test.ts` (`npm run test:security`)

| Teste | Garante |
| --- | --- |
| ADM-1 | 10 caminhos administrativos × 3 variações (sem chave, chave fictícia, outra origem): nenhum 2xx/3xx e o marcador `select '<marcador>'` nunca aparece na resposta |
| ADM-2 | containers `studio`, `pg_meta`, `rest`, `analytics`, `vector` ausentes |
| DATA-1 | `/rest/v1/`, `/rest/v1/tool_operational`, `/graphql/v1` sem 2xx mesmo com a chave anon |
| AUTH-1 | login, sessão, renovação, logout e rejeições |
| PG-1 | `select 1` e todas as migrações do repositório registradas no banco local |
| NET-1 | toda porta publicada só em `127.0.0.1`/`[::1]`; 40203 e 40207 não publicadas; nenhuma porta alcançável pelos IPs não loopback da máquina |

`EXPECT_ADMIN_SURFACE=open` é o **controle** (exige que `/pg/query` e `/mcp` executem).

### 7.2 Mutação (proteção retirada temporariamente)

Studio religado **sem editar arquivo**, só com `SUPABASE_STUDIO_ENABLED=true npx supabase start
--network-id gf-supabase-loopback`:

- `test:security` (closed) → **3/6, falha** em ADM-1 (`/pg/query`, `/pg/tables`, `/mcp`, Studio
  query e MCP executando), ADM-2 e NET-1;
- `EXPECT_ADMIN_SURFACE=open` → 4/4 (2 ignorados): o controle vê a exposição;
- API-3 do spike (§7.3) → **falha**.

Depois o stack foi reiniciado sem a variável e voltou a 6/6. A configuração insegura não foi
mantida. Também o cenário A original rodado em modo closed falha (2/6) e em modo open passa.

### 7.3 Suítes antigas

| Suíte | Configuração final | Observação |
| --- | --- | --- |
| Unitários | 21/21 | |
| pgTAP | 179/179 | |
| Spike backend | 18/18 | |
| Spike Data API `EXPECT_DATA_API=off` | 4/4 | **API-3 invertido**: antes caracterizava o `/pg/query` aberto (afirmava 200 e `postgres`); agora falha se ele voltar a executar |
| Spike Data API `EXPECT_DATA_API=on` | requer `[api] enabled = true` | controle do MIG-R3.3-P; não se aplica à configuração final |
| `tests/integration` | 4/16 | **12 dependem intencionalmente da Data API ligada** |

Os 12 testes de `tests/integration` que exigem `[api] enabled = true` afirmam comportamento do
PostgREST (códigos PGRST106/PGRST205/42501 e leitura por HTTP):

- `mig-r3-2-barrier.test.ts`: objeto de `supabase_admin` em `public` não roteado (PGRST205);
  `public` não selecionável por `Accept-Profile` (PGRST106); objeto de `supabase_admin` em `api`
  sem GRANT automático; contrato operacional do perfil autenticado preservado.
- `mig-r3-access.test.ts`: anon negado em `api.tool`/projeções/RPC; `private`/`authz` não
  expostos; tabelas protegidas fora da API; `authenticated` sem escrita em `api.tool`; RPC nominal
  não executável; perfis ativos leem as projeções conforme o contrato; inativo/sem perfil sem
  linhas; `service_role` sem acesso de operador.

Passaram 16/16 no cenário B (Data API ligada, Studio desligado): **o fechamento do pg-meta não
quebra nenhum deles**; só o desligamento da Data API os torna inaplicáveis. Não foram apagados
nem alterados. Para executá-los: `[api] enabled = true` temporariamente + restart. A migração para
a forma "pela conexão do backend" continua no plano do MIG-R3.3 (DB-4..DB-7 já cobrem as mesmas
garantias).

## 8. Impacto

- **Studio:** indisponível localmente. Inspeção e SQL passam a ser feitos por `psql`
  (`docker exec supabase_db_gestao-de-ferramentas-next psql -U postgres`), pgTAP e CLI
  (`migration list --local`, `db reset --local`). Religar o Studio reabre SQL sem autenticação;
  se for indispensável, fazê-lo só com o banco vazio e parar o stack logo depois.
- **Logs:** sem Logflare/Vector não há coleta local de logs no painel; `docker logs` continua
  disponível. O `supabase_vector` estava em crash-loop (Docker Engine API indisponível em modo
  Local only) e **não foi corrigido**: deixou de existir porque só é criado com `[analytics]`.
- **Data API:** desligada; ver §7.3.

## 9. Limitações residuais

1. **Rotas do Kong permanecem.** `/pg/`, `/rest-admin/v1/`, `/mcp`, `/analytics/v1/` e
   `/pooler/v2/` continuam no gateway, sem autenticação, apontando para hostnames inexistentes.
   Um container com um desses nomes na rede `gf-supabase-loopback` voltaria a receber tráfego.
   Exige acesso ao Docker (já equivalente a administrador local). ADM-1 detectaria.
2. **Variáveis de ambiente sobrepõem o `config.toml`.** `SUPABASE_STUDIO_ENABLED`,
   `SUPABASE_API_ENABLED` e `SUPABASE_ANALYTICS_ENABLED` religam os serviços (comprovado na
   mutação). Não definir; `npm run test:security` detecta.
3. **Preflight CORS continua 200** no Kong para essas rotas (§3). Sem efeito enquanto o upstream
   não existir.
4. **Mailpit (`:40204`)** continua publicado em loopback, sem autenticação para clientes locais
   não-navegador (recusa `Origin` estranha com 403). Permite ler e-mails de teste locais, por
   exemplo links de recuperação de senha de contas fictícias. Não é serviço SQL; desligá-lo
   (`[local_smtp] enabled = false`) afetaria fluxos de e-mail do Auth não exercitados aqui →
   decisão pendente.
5. **Hospedado não verificado.** Nada aqui prova como o Supabase hospedado expõe (ou não) pg-meta,
   `/rest-admin` ou MCP no domínio do projeto → NAO_COMPROVADO.
6. **Internet pública não testada** (§3): comprovado só para outra origem local.

## 10. Implicações para o MIG-R3.3

- O item 6 do plano (desligar a Data API em `config.toml`) **já está aplicado** localmente por
  este Gate; resta migrar os 12 testes HTTP e decidir `USAGE` de `anon` em `api` e os GRANTs de
  `service_role`.
- A decisão pendente 6 do planejamento (mitigação do pg-meta local) está resolvida: Studio
  desligado.
- O backend não depende de nenhum serviço desligado; `npm run test:security` deve continuar
  verde em todo Gate seguinte.
- No hospedado, repetir a verificação equivalente (Data API desligada, ausência de rotas
  administrativas públicas) em projeto descartável antes de qualquer Preview.

## Reprodução

```
npm run supabase:start                              # rede gf-supabase-loopback
npm run test:security                               # regressão (configuração final)
EXPECT_ADMIN_SURFACE=open npm run test:security     # controle: exige Studio ligado
EXPECT_DATA_API=off npm run test:spike:data-api
npm run test:spike:backend
npm run test:db
```

Somente local: nunca `--linked`, `link`, `login`, `db push` ou `config push`.
