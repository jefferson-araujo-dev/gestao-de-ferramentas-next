-- MIG-R3.2 — Barreira estrutural contra os privilégios automáticos do Supabase.
-- As migrações MIG-R3 e MIG-R3.1 permanecem inalteradas; esta migração relocaliza e restringe.
--
-- PROBLEMA (comprovado no catálogo, não deduzido de texto de migração)
--   pg_default_acl tem DUAS entradas para o esquema public:
--     postgres       → corrigida pelo MIG-R3 (anon/authenticated removidos);
--     supabase_admin → INTACTA: GRANT ALL em tabelas, views, sequências e funções novas
--                      para anon, authenticated e service_role.
--   Um objeto criado por supabase_admin em public nasce legível E gravável por anon.
--
-- POR QUE NÃO SE CORRIGE A ACL
--   `alter default privileges for role supabase_admin ...` exige ser membro do papel. O papel
--   postgres não é SUPERUSER nem membro de supabase_admin (igual ao Supabase hospedado), então
--   a instrução falha com "permission denied to change default privileges". Alterar atributos ou
--   associações de supabase_admin está fora dos limites deste Gate e seria incompatível com o
--   ambiente hospedado. Event trigger que revogasse o GRANT depois da criação também não serve:
--   é reação, não prevenção, e postgres não pode revogar privilégios de objeto de outro dono.
--
-- BARREIRA ESCOLHIDA (mecanismo documentado do PostgreSQL, sem SUPERUSER)
--   O PostgreSQL exige USAGE no esquema para QUALQUER acesso a um objeto dele. Retirado o USAGE,
--   o GRANT automático continua no catálogo mas deixa de ser alcançável. Por isso o esquema public
--   fica sem nenhum objeto da aplicação e sem USAGE para os papéis da Data API, e as projeções
--   autorizadas passam a viver no esquema dedicado `api`, cujo pg_default_acl é vazio.
--
--   Consequência declarada: a ACL padrão de supabase_admin NÃO é eliminada (não há como). O que
--   este Gate garante é que ela deixa de produzir exposição efetiva.
--
-- RELOCALIZAÇÃO COM `SET SCHEMA`
--   `alter ... set schema` só troca o namespace: preserva ACL de tabela, GRANT por coluna, RLS,
--   políticas, triggers, índices e chaves estrangeiras. Nenhuma garantia do MIG-R3/R3.1 é
--   reescrita nem reconcedida aqui — é por isso que esta migração não repete GRANT algum.

create schema api;
comment on schema api is
  'Superfície autorizada da Data API. Único esquema exposto pelo PostgREST. Sem pg_default_acl: '
  'objeto novo aqui nasce sem privilégio para anon/authenticated até receber GRANT explícito.';

revoke all on schema api from public;
grant usage on schema api to anon, authenticated, service_role;

-- anon recebe USAGE e nada mais: o PostgREST monta a rota e a nega com 42501 por ausência de
-- GRANT no objeto. Sem USAGE a negação viraria 404, que não comprova ausência de privilégio.

-- ---------------------------------------------------------------------------------------------
-- 1. Relocalização da superfície autorizada (public → api)
-- ---------------------------------------------------------------------------------------------

alter table public.tool set schema api;
alter view public.tool_operational set schema api;
alter view public.tool_movement_log set schema api;
alter view public.tool_image set schema api;
-- Continua sem EXECUTE para qualquer papel de cliente (MIG-R3.1); só muda de esquema.
alter function public.get_current_custodian(uuid) set schema api;

-- ---------------------------------------------------------------------------------------------
-- 2. Funções internas que citam a tabela por nome
--
-- As views seguem a tabela automaticamente (dependência por OID), mas estes dois corpos têm
-- `search_path = ''` e referência literal `public.tool`, que deixaria de resolver. Somente a
-- referência de esquema muda; as regras D10, D5 e a trava `for update` são as do MIG-R3.
-- ---------------------------------------------------------------------------------------------

create or replace function private.guard_custody_open() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_complete boolean;
begin
  select t.is_complete into v_complete from api.tool t where t.id = new.tool_id for update;
  if not v_complete then
    raise exception 'ferramenta incompleta não recebe empréstimo (D10)' using errcode = 'check_violation';
  end if;
  if exists (select 1 from private.maintenance_record m where m.tool_id = new.tool_id and m.ended_at is null) then
    raise exception 'ferramenta em manutenção não recebe empréstimo' using errcode = 'check_violation';
  end if;
  if (select c.status from private.collaborator c where c.id = new.collaborator_id) <> 'active' then
    raise exception 'colaborador inativo não recebe novo empréstimo (D5)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function private.guard_maintenance_open() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform 1 from api.tool t where t.id = new.tool_id for update;
  if exists (select 1 from private.custody c where c.tool_id = new.tool_id and c.closed_at is null) then
    raise exception 'ferramenta emprestada não entra em manutenção' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. A barreira
--
-- Os dois REVOKE são indispensáveis e não se substituem: o esquema public concede USAGE a PUBLIC
-- (`=U/pg_database_owner`), logo revogar apenas dos papéis nomeados deixaria o USAGE de pé pela
-- via herdada. Comprovado: com o REVOKE de PUBLIC ausente, has_schema_privilege('authenticated',
-- 'public','USAGE') continua verdadeiro.
--
-- service_role também perde USAGE: depois da relocalização não existe objeto da aplicação em
-- public, e o servidor escreve em api.tool.
-- ---------------------------------------------------------------------------------------------

revoke usage on schema public from public;
revoke usage on schema public from anon, authenticated, service_role;

comment on schema public is
  'Sem objeto da aplicação e sem USAGE para anon/authenticated/service_role desde o MIG-R3.2. '
  'A ACL padrão de supabase_admin sobre public permanece (não é revogável por postgres): esta '
  'barreira impede a exposição efetiva, não a existência do GRANT. Não criar objeto aqui.';
