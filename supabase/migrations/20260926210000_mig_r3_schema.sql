-- MIG-R3 (1/2) — Modelo PostgreSQL: esquemas, tipos, tabelas e invariantes de integridade.
-- Controle de acesso (GRANTs, RLS, projeções) fica em 20260926210100_mig_r3_access.sql.
--
-- Separação física (K13):
--   public  → somente dados operacionais, sem nome, crachá, observações, IP ou id de colaborador.
--   private → identidade de operadores e colaboradores, crachá protegido, custódia, observações
--             administrativas, histórico bruto, tentativas/contadores K4 e auditoria de segurança.
--             Não exposto pela API (config.toml [api].schemas) e sem USAGE para anon/authenticated.
--   authz   → somente funções de autorização usadas pelas políticas RLS (sem tabelas).
--
-- Nenhum documento do Firestore é copiado; nenhum dado real é inserido por esta migração.

create schema private;
create schema authz;

-- O Supabase concede, por padrão, ALL em tabelas e EXECUTE em funções novas de public para
-- anon/authenticated. Aqui isso deixa de valer: todo acesso é concedido explicitamente.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------------------------

create type private.access_level as enum ('admin', 'standard', 'restricted');
create type private.account_status as enum ('active', 'inactive');
create type private.movement_kind as enum ('out', 'in', 'maintenance');
create type private.close_kind as enum ('common', 'exceptional', 'admin_correction');
create type private.security_event_kind as enum (
  'badge_attempt_failed', 'throttle_block', 'exceptional_return', 'custody_correction'
);

-- ---------------------------------------------------------------------------------------------
-- Operadores (usuários do aplicativo). Status 'inactive' = USUÁRIO INATIVO: sem autorização para
-- usar o aplicativo. Não confundir com colaborador inativo (private.collaborator.status).
-- ---------------------------------------------------------------------------------------------

create table private.app_user (
  id uuid primary key references auth.users (id),
  name text not null check (btrim(name) <> ''),
  access_level private.access_level not null,
  status private.account_status not null default 'active',
  legacy_firebase_uid text unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Colaboradores (identidade protegida). Status 'inactive' = COLABORADOR INATIVO: não recebe novos
-- empréstimos, mas pode devolver o que já retirou (D5; conferência K1/K3-C/K4 é do MIG-R6).
-- ---------------------------------------------------------------------------------------------

create table private.collaborator (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  job_title text,
  phone text,
  status private.account_status not null default 'active',
  legacy_doc_id text unique,
  created_at timestamptz not null default now()
);

-- Referência protegida do crachá (K3-C). Nunca o valor em claro: HMAC com chave (pepper) mantida
-- fora do banco e versionada. Algoritmo e gestão da chave: decisão pendente para o MIG-R5.
create table private.collaborator_badge (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references private.collaborator (id),
  badge_hmac bytea not null check (octet_length(badge_hmac) >= 32),
  key_version integer not null check (key_version > 0),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= issued_at)
);

-- Um mesmo crachá ativo não pode identificar dois colaboradores.
create unique index collaborator_badge_active_hmac_key
  on private.collaborator_badge (badge_hmac) where revoked_at is null;
create index collaborator_badge_collaborator_idx on private.collaborator_badge (collaborator_id);

-- ---------------------------------------------------------------------------------------------
-- Ferramentas — dados operacionais (única tabela de negócio em public).
-- Sem notes, IP, nome/função de colaborador ou id interno de colaborador.
-- O status (disponível/emprestada/manutenção) NÃO é armazenado: é derivado em
-- public.tool_operational, o que torna impossível "disponível com empréstimo aberto".
-- ---------------------------------------------------------------------------------------------

create table public.tool (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = btrim(code) and code <> ''),
  name text not null check (btrim(name) <> ''),
  category text,
  condition text,
  next_maintenance date,
  -- D10: ferramenta incompleta fica isolada de novos empréstimos. Padrão fechado (false):
  -- a ferramenta precisa ser marcada completa explicitamente.
  is_complete boolean not null default false,
  created_at timestamptz not null default now()
);

-- Observações administrativas separadas dos dados operacionais.
create table private.tool_admin_note (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references public.tool (id),
  note text not null check (btrim(note) <> ''),
  created_by uuid not null references private.app_user (id),
  created_at timestamptz not null default now()
);
create index tool_admin_note_tool_idx on private.tool_admin_note (tool_id);

-- ---------------------------------------------------------------------------------------------
-- Custódia protegida (K13)
-- ---------------------------------------------------------------------------------------------

create table private.custody (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references public.tool (id),
  collaborator_id uuid not null references private.collaborator (id),
  -- K3-C: referência do crachá no momento da retirada. Nula somente para empréstimo legado sem
  -- referência confiável — nunca inventada.
  pickup_badge_hmac bytea check (octet_length(pickup_badge_hmac) >= 32),
  pickup_badge_key_version integer check (pickup_badge_key_version > 0),
  opened_at timestamptz not null default now(),
  opened_by uuid references private.app_user (id),
  closed_at timestamptz,
  closed_by uuid references private.app_user (id),
  close_kind private.close_kind,
  check ((pickup_badge_hmac is null) = (pickup_badge_key_version is null)),
  check ((closed_at is null) = (close_kind is null)),
  check (closed_by is null or closed_at is not null),
  check (closed_at is null or closed_at >= opened_at)
);

-- Impede duas custódias abertas para a mesma ferramenta.
create unique index custody_one_open_per_tool on private.custody (tool_id) where closed_at is null;
create index custody_open_by_collaborator_idx on private.custody (collaborator_id) where closed_at is null;

create table private.maintenance_record (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references public.tool (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  description text,
  actor_user_id uuid not null references private.app_user (id),
  check (ended_at is null or ended_at >= started_at)
);
create unique index maintenance_one_open_per_tool on private.maintenance_record (tool_id) where ended_at is null;

-- Histórico bruto (contém operador, dispositivo e IP). Projeção sanitizada: public.tool_movement_log.
create table private.movement (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references public.tool (id),
  custody_id uuid references private.custody (id),
  kind private.movement_kind not null,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references private.app_user (id),
  device text,
  ip inet,
  -- Retirada/devolução sempre ligadas a uma custódia; manutenção nunca.
  check ((kind = 'maintenance') = (custody_id is null))
);
create index movement_tool_occurred_idx on private.movement (tool_id, occurred_at desc);
create index movement_occurred_idx on private.movement (occurred_at desc);

-- ---------------------------------------------------------------------------------------------
-- K4 — estrutura inicial apenas. O algoritmo (janela de 15 min, limites 5/10, bloqueio de 30 min,
-- concorrência) é do MIG-R6. Nenhuma regra aqui presume que sucesso zera contador.
-- ---------------------------------------------------------------------------------------------

-- Trilha de tentativas. NUNCA armazena o crachá informado.
create table private.badge_attempt (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references private.app_user (id),
  tool_id uuid references public.tool (id),
  operation text not null check (operation in ('loan', 'return')),
  succeeded boolean not null,
  occurred_at timestamptz not null default now()
);
create index badge_attempt_actor_occurred_idx on private.badge_attempt (actor_user_id, occurred_at desc);

-- Contador por operador e ferramenta: chave composta real, sem COALESCE.
create table private.operator_tool_throttle (
  actor_user_id uuid not null references private.app_user (id),
  tool_id uuid not null references public.tool (id),
  window_started_at timestamptz not null,
  failure_count integer not null default 0 check (failure_count >= 0),
  blocked_until timestamptz,
  primary key (actor_user_id, tool_id)
);

-- Contador global por operador (todas as ferramentas): tabela própria, chave = operador.
create table private.operator_global_throttle (
  actor_user_id uuid primary key references private.app_user (id),
  window_started_at timestamptz not null,
  failure_count integer not null default 0 check (failure_count >= 0),
  blocked_until timestamptz
);

-- ---------------------------------------------------------------------------------------------
-- Auditoria de segurança (K9/K10): somente inserção.
-- ---------------------------------------------------------------------------------------------

create table private.security_event (
  id bigint generated always as identity primary key,
  kind private.security_event_kind not null,
  actor_user_id uuid not null references private.app_user (id),
  tool_id uuid references public.tool (id),
  target_collaborator_id uuid references private.collaborator (id),
  occurred_at timestamptz not null default now(),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object')
);
create index security_event_occurred_idx on private.security_event (occurred_at desc);

-- ---------------------------------------------------------------------------------------------
-- Invariantes que dependem de mais de uma tabela
-- ---------------------------------------------------------------------------------------------

create function private.reject_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% é somente inserção', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

-- ponytail: bloqueia também o dono da tabela; a política de retenção (a definir) precisará de um
-- procedimento administrativo que desabilite o trigger de forma auditada.
create trigger security_event_append_only
  before update or delete on private.security_event
  for each row execute function private.reject_mutation();
create trigger security_event_no_truncate
  before truncate on private.security_event
  for each statement execute function private.reject_mutation();

-- Abertura de custódia: trava a linha da ferramenta (serializa movimentos concorrentes da mesma
-- ferramenta) e exige ferramenta completa (D10), sem manutenção aberta e colaborador ativo (D5).
create function private.guard_custody_open() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_complete boolean;
begin
  select t.is_complete into v_complete from public.tool t where t.id = new.tool_id for update;
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

create trigger custody_guard_open
  before insert on private.custody
  for each row when (new.closed_at is null)
  execute function private.guard_custody_open();

-- Custódia não troca de ferramenta, colaborador ou crachá de retirada, e não reabre depois de
-- fechada — caso contrário as regras de abertura seriam contornáveis por UPDATE.
-- Correção administrativa de custódia = fechar (admin_correction) e abrir outra.
create function private.guard_custody_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tool_id <> old.tool_id
     or new.collaborator_id <> old.collaborator_id
     or new.pickup_badge_hmac is distinct from old.pickup_badge_hmac
     or new.pickup_badge_key_version is distinct from old.pickup_badge_key_version
     or new.opened_at <> old.opened_at
     or (old.closed_at is not null and new.closed_at is distinct from old.closed_at) then
    raise exception 'custódia: campos de identidade imutáveis e custódia fechada não reabre'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger custody_guard_update
  before update on private.custody
  for each row execute function private.guard_custody_update();

-- Abertura de manutenção: mesma trava da ferramenta; recusa ferramenta com custódia aberta.
create function private.guard_maintenance_open() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.tool t where t.id = new.tool_id for update;
  if exists (select 1 from private.custody c where c.tool_id = new.tool_id and c.closed_at is null) then
    raise exception 'ferramenta emprestada não entra em manutenção' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger maintenance_guard_open
  before insert on private.maintenance_record
  for each row when (new.ended_at is null)
  execute function private.guard_maintenance_open();
