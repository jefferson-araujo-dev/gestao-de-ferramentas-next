# MIG-R3.2 — Barreira contra os privilégios automáticos do Supabase

Fecha a ressalva deixada pelo MIG-R3.1: os privilégios padrão de `supabase_admin` no esquema
`public` concediam acesso automático a `anon` e `authenticated` em qualquer objeto novo criado por
esse papel, e os testes de inventário apenas **detectavam** a situação depois do fato.

| Arquivo | Conteúdo |
| --- | --- |
| `supabase/migrations/20260927000000_mig_r3_2_api_schema_barrier.sql` | esquema `api`, relocalização da superfície autorizada, retirada de USAGE em `public` |
| `supabase/config.toml` | `[api].schemas = ["api", "graphql_public"]`, `extra_search_path = ["extensions"]`, `auto_expose_new_tables = false` |
| `supabase/tests/mig_r3_2.test.sql` | 31 testes pgTAP da barreira, incluindo mutação |
| `tests/integration/mig-r3-2-barrier.test.ts` | 7 testes com objeto criado **realmente** por `supabase_admin` |

## O problema, comprovado no catálogo

`pg_default_acl` tem duas entradas para `public`, não uma:

| Papel criador | Tabelas/views | Sequências | Funções |
| --- | --- | --- | --- |
| `postgres` | corrigido pelo MIG-R3 | corrigido | corrigido |
| `supabase_admin` | **GRANT ALL para anon, authenticated, service_role** | idem | **EXECUTE para os três** |

O MIG-R3 revogou apenas o lado `postgres`. Uma tabela criada por `supabase_admin` em `public`
nasce legível **e gravável** por `anon`, sem RLS e sem nenhum GRANT explícito — verificado criando
o objeto e lendo `relacl` e `has_table_privilege`.

## Por que a ACL padrão não é eliminável

`alter default privileges for role supabase_admin ...` exige ser membro do papel. No banco local,
como no Supabase hospedado:

- `postgres` não é `SUPERUSER` (`rolsuper = f`);
- `postgres` não é membro de `supabase_admin` (`pg_has_role(...) = f`).

A instrução falha com `permission denied to change default privileges`. Alterar atributos, senha
ou associações de `supabase_admin` está fora dos limites do Gate e seria incompatível com o
ambiente hospedado.

Alternativa descartada: *event trigger* que revogasse o GRANT após cada `CREATE`. É reação, não
prevenção, e `postgres` não pode revogar privilégios de objeto pertencente a outro dono — a
revogação falharia justamente nos objetos de `supabase_admin`, que são o caso a proteger.

## Configuração oficial avaliada: `auto_expose_new_tables`

A chave **existe** na CLI 2.118.0 (confirmado no binário, não por suposição de versão). Descrição
da própria CLI:

> Controls whether newly-created tables, views, sequences and functions in the `public` schema **by
> `postgres`** are reachable through the Data API roles … Set to `false` to revoke the default Data
> API privileges so new entities require explicit GRANTs.

A CLI também avisa que a chave é depreciada e será removida em **2026-10-30**, quando `false` passa
a ser o padrão — o aviso recomenda exatamente este valor.

Efeito medido com `false` após reset: a ACL padrão de `postgres` em `public` perdeu `a/r/w/d` para
os três papéis da Data API. A ACL padrão de `supabase_admin` **ficou intacta**. Ou seja: a
configuração oficial é correta e foi adotada, mas **não resolve** a ressalva — o alcance dela é o
papel `postgres`, que o MIG-R3 já tratava.

## A barreira escolhida

O PostgreSQL exige `USAGE` no esquema para qualquer acesso a um objeto dele. Retirado o `USAGE`, o
GRANT automático permanece no catálogo e deixa de produzir acesso. Então:

1. **Esquema dedicado `api`**, sem nenhuma entrada em `pg_default_acl` — objeto novo nele nasce sem
   privilégio até receber GRANT explícito.
2. **Relocalização com `ALTER ... SET SCHEMA`** dos cinco objetos da aplicação (`tool`,
   `tool_operational`, `tool_movement_log`, `tool_image`, `get_current_custodian`). `SET SCHEMA` só
   troca o namespace: ACL de tabela, GRANT por coluna, RLS, políticas, triggers, índices e chaves
   estrangeiras vêm intactos. Nenhum GRANT é reconcedido pela migração do MIG-R3.2.
3. **`public` sem objeto algum e sem `USAGE`** para `anon`, `authenticated` e `service_role`.

Os dois `REVOKE` são indispensáveis e não se substituem:

```sql
revoke usage on schema public from public;                       -- PUBLIC tinha =U/pg_database_owner
revoke usage on schema public from anon, authenticated, service_role;
```

Sem o primeiro, `has_schema_privilege('authenticated','public','USAGE')` continua verdadeiro pela
via herdada de `PUBLIC` — a barreira seria falsa. Isso está comprovado em `S4` e foi verificado
isoladamente antes de escrever a migração.

Duas funções internas (`private.guard_custody_open`, `private.guard_maintenance_open`) têm
`search_path = ''` e citavam `public.tool` literalmente; foram substituídas para citar `api.tool`.
Somente a referência de esquema mudou — as regras D10, D5 e a trava `for update` são as do MIG-R3.

## O que mudou para o cliente: nada

`api` é o primeiro esquema exposto, então os caminhos REST são os mesmos (`/rest/v1/tool`,
`/rest/v1/tool_operational`, …). As 9 asserções HTTP do MIG-R3/R3.1 passaram **sem alteração de
expectativa** — só as fixtures SQL trocaram `public.tool` por `api.tool`. Nenhum teste negativo foi
removido ou enfraquecido.

`anon` recebeu `USAGE` em `api` de propósito: assim a negação continua sendo `42501` por ausência de
GRANT no objeto (prova de privilégio) em vez de `404` por rota inexistente (que não prova nada
sobre privilégios).

Distinção de status HTTP registrada nos testes: sem JWT o PostgREST responde **401**; com JWT
válido e sem privilégio, **403**. O código SQL é `42501` nos dois casos.

## Resultado, sem ambiguidade

| | |
| --- | --- |
| `ACL_PADRAO_ELIMINADA` | **NÃO** — a entrada de `supabase_admin` em `pg_default_acl` continua existindo e concedendo ALL. Não é revogável por `postgres`. |
| `EXPOSICAO_EFETIVA_BLOQUEADA` | **SIM para `public`** — sem `USAGE`, nenhum papel da Data API alcança o objeto, por SQL ou por HTTP. Ver a lacuna conhecida abaixo: funções criadas por `supabase_admin` em `api`/`authz` ficam fora desta garantia. |

Os testes `S1`/`S2` afirmam positivamente que a ACL **ainda existe**: se um dia ela desaparecer, eles
falham e obrigam a revisão deste documento. Não se troca "caminho bloqueado" por "privilégio
eliminado".

## Teste de mutação

Com `grant usage on schema public to anon, authenticated, service_role` aplicado fora da migração:

- `mig_r3_2.test.sql`: 11 de 31 falham (`S5`–`S7`, `B2`–`B9`);
- `mig_r3_1.test.sql`: `D15` (inventário de USAGE) falha.

Duas suítes independentes detectam a remoção da barreira. `M1` fecha o raciocínio ao provar, dentro
da própria transação, que o objeto auto-exposto **passa** a ser legível quando o `USAGE` volta —
logo é o `USAGE` que bloqueia, e não outro fator acidental.

## Lacuna conhecida (MIG-R3.2-V): funções criadas por `supabase_admin` em `api`

A barreira acima cobre **relações** (tabelas, views, sequências) em qualquer esquema e **tudo** em
`public`. Ela **não** cobre um caso: função criada por `supabase_admin` dentro de um esquema onde o
cliente tem `USAGE` — hoje `api` (`anon` e `authenticated`) e `authz` (`authenticated`).

Causa: o `acldefault` embutido do PostgreSQL para funções é `{=X/owner, owner=X/owner}` — `=X` é
`EXECUTE` para `PUBLIC`. Tabelas e sequências não concedem nada a `PUBLIC`. O papel `postgres` está
protegido porque o MIG-R3 emitiu `alter default privileges for role postgres revoke execute on
functions from public` **global** (todos os esquemas). `supabase_admin` não tem entrada global nem
para `api` em `pg_default_acl`, então o padrão embutido vale — e `postgres` não pode alterar a ACL
padrão de `supabase_admin` (mesma parede descrita acima).

Reproduzido no MIG-R3.2-V: função criada por `supabase_admin` em `api`, sem GRANT explícito, ficou
com `EXECUTE` para `PUBLIC` e respondeu **HTTP 200** em `POST /rest/v1/rpc/<fn>` a um chamador **sem
JWT**. Tabelas e sequências criadas do mesmo modo em `api` seguiram inacessíveis.

Estado atual e contenção:

- **Não há exposição ativa.** A única função com `EXECUTE` para cliente nos esquemas do projeto é
  `authz.current_access_level` → `authenticated`, autorizada pelo MIG-R3. A lacuna é **latente**.
- **Só SUPERUSER cria em `api`**: `postgres` (DDL da aplicação) é seguro pelo revoke global;
  `anon`, `authenticated`, `service_role` e `authenticator` não têm `CREATE`.
- **A detecção existe e foi comprovada**: com tal função presente, `D14` (`mig_r3_1.test.sql`) e
  `A15` (`mig_r3_access.test.sql`) falham. `A4`/`A5` de `mig_r3_2.test.sql` **não** detectam, porque
  criam a sonda como `postgres` — lacuna de cobertura registrada, correção pendente de revisão.

Dentro dos limites do Gate não existe correção plenamente preventiva para este vetor: só o dono do
objeto, um SUPERUSER ou um membro do papel pode alterar a ADP ou revogar o `EXECUTE`. Alternativas
levantadas e **não implementadas** (aguardando decisão): retirar `USAGE` de `anon` em `api` (fecha a
via não autenticada, ao custo de negações 404/PGRST205 em vez de 401/42501); retirar `USAGE` de
`authenticated` em `authz`; e criar a sonda como `supabase_admin` nos testes. Nenhuma delas cobre
`authenticated` em `api`.

## Riscos e limitações residuais

- **A ACL padrão de `supabase_admin` continua lá.** Qualquer mudança futura que devolva `USAGE` em
  `public` a um papel da Data API reabre a exposição. Os testes acima são o guarda dessa mudança.
- **Esquemas internos não foram tocados** (proibido pelo Gate): `storage`, `auth`, `realtime`,
  `extensions`, `graphql_public`. Registre-se que a ACL padrão de `postgres` em `storage` concede
  ALL a `anon`/`authenticated`, e que `graphql_public` tem a mesma ACL de `supabase_admin` que
  `public` tinha. Nenhum dos dois é exposto como superfície da aplicação nem recebe objeto do
  projeto, mas são o próximo lugar a auditar se a aplicação passar a criar objetos lá.
- **`pg_graphql`** segue desabilitado; `graphql_public` contém apenas a função de plataforma (`D16`).
- **Validação em Supabase hospedado não foi feita** — nenhuma conexão remota é autorizada neste
  Gate. A solução usa apenas mecanismos que não dependem de `SUPERUSER` nem de alteração de papel
  interno, justamente para ser aplicável lá, mas isso permanece **não comprovado**.
- **`supabase_vector`** continua em `Restarting` por depender de `host.docker.internal:2375`
  (limitação ambiental conhecida do MIG-R2, não alterada aqui).
