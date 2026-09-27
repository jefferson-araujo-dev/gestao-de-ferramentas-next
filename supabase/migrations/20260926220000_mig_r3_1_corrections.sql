-- MIG-R3.1 — Correções da revisão do MIG-R3 e fechamento do modelo.
-- As migrações MIG-R3 permanecem inalteradas; esta migração só acrescenta e restringe.

-- ---------------------------------------------------------------------------------------------
-- 1. Consulta nominal (D3/K8): nenhum papel de cliente executa a RPC diretamente.
--    A consulta nominal passará por uma API de backend com política própria (Gate posterior).
-- ---------------------------------------------------------------------------------------------

revoke all on function public.get_current_custodian(uuid) from public, anon, authenticated, service_role;
comment on function public.get_current_custodian(uuid) is
  'Sem EXECUTE para PUBLIC/anon/authenticated/service_role desde o MIG-R3.1. Não expor ao navegador.';

-- ---------------------------------------------------------------------------------------------
-- 2. public.tool: SELECT por coluna. Coluna nova adicionada no futuro NÃO fica legível pelo
--    cliente até receber GRANT explícito (falha fechada).
-- ---------------------------------------------------------------------------------------------

revoke select on public.tool from authenticated;
grant select (id, code, name, category, condition, next_maintenance, is_complete, created_at)
  on public.tool to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Mídia das ferramentas (D9). Somente referências de armazenamento; nenhum upload, conteúdo
--    binário ou data URI. Imagem só entra na projeção operacional depois de verificada; manual
--    nunca entra (permanece protegido até um fluxo próprio ser aprovado).
-- ---------------------------------------------------------------------------------------------

create type private.media_kind as enum ('image', 'manual');

create table private.tool_media (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references public.tool (id),
  kind private.media_kind not null,
  -- Chave de objeto no Storage, não URL: recusa data URI (base64 legado) e endereços externos.
  storage_path text not null
    check (btrim(storage_path) <> '' and storage_path !~* '^(data|https?|javascript|file):'),
  verified_at timestamptz,
  verified_by uuid references private.app_user (id),
  created_at timestamptz not null default now(),
  check ((verified_at is null) = (verified_by is null))
);

create index tool_media_tool_idx on private.tool_media (tool_id);
-- Uma imagem verificada vigente por ferramenta: a projeção é determinística.
create unique index tool_media_one_verified_image
  on private.tool_media (tool_id) where kind = 'image' and verified_at is not null;

-- ---------------------------------------------------------------------------------------------
-- 4. Quarentena da migração (D10). Registra o motivo e os NOMES dos campos ausentes, nunca o
--    conteúdo do documento de origem (nenhum documento do Firestore é copiado).
-- ---------------------------------------------------------------------------------------------

create type private.quarantine_reason as enum (
  'missing_required_field',
  'duplicate_or_empty_badge',
  'borrowed_without_collaborator',
  'orphan_collaborator_reference',
  'history_without_collaborator_id',
  'homonym_without_discriminator',
  'duplicate_identity',
  'invalid_status',
  'corrupted_media'
);

create table private.migration_quarantine (
  id bigint generated always as identity primary key,
  source_collection text not null check (source_collection in ('users', 'collaborators', 'tools', 'history')),
  source_id text not null check (btrim(source_id) <> ''),
  reason private.quarantine_reason not null,
  missing_fields text[] not null default '{}',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references private.app_user (id),
  resolution text,
  check ((resolved_at is null) = (resolved_by is null)),
  check ((resolved_at is null) = (resolution is null)),
  check (resolved_at is null or resolved_at >= detected_at)
);

-- Reexecução idempotente da migração: um mesmo problema aberto não se duplica.
create unique index migration_quarantine_open_key
  on private.migration_quarantine (source_collection, source_id, reason) where resolved_at is null;

-- Registro com quarentena aberta não entra nas tabelas de destino até ser regularizado.
-- tg_argv: [0] coleção de origem, [1] coluna que guarda o id legado. SECURITY DEFINER porque o
-- servidor (service_role) escreve em public.tool sem acesso ao esquema private.
create function private.guard_not_quarantined() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_source_id text := to_jsonb(new) ->> tg_argv[1];
begin
  if v_source_id is not null and exists (
    select 1 from private.migration_quarantine q
    where q.source_collection = tg_argv[0] and q.source_id = v_source_id and q.resolved_at is null
  ) then
    raise exception 'registro em quarentena aberta (D10): %/%', tg_argv[0], v_source_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger tool_not_quarantined
  before insert or update of code on public.tool
  for each row execute function private.guard_not_quarantined('tools', 'code');
create trigger collaborator_not_quarantined
  before insert or update of legacy_doc_id on private.collaborator
  for each row execute function private.guard_not_quarantined('collaborators', 'legacy_doc_id');
create trigger app_user_not_quarantined
  before insert or update of legacy_firebase_uid on private.app_user
  for each row execute function private.guard_not_quarantined('users', 'legacy_firebase_uid');

-- ---------------------------------------------------------------------------------------------
-- 5. Acesso das novas estruturas: nenhum GRANT, RLS sem política.
-- ---------------------------------------------------------------------------------------------

revoke all on private.tool_media, private.migration_quarantine from public, anon, authenticated, service_role;
revoke all on function private.guard_not_quarantined() from public, anon, authenticated, service_role;
alter table private.tool_media enable row level security;
alter table private.migration_quarantine enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 6. Projeção de imagens verificadas. Mesmo modelo das demais views operacionais (ver
--    docs/mig-r3-modelo.md): privilégio do dono, colunas explícitas, security_barrier e filtro
--    de operador ativo dentro da própria view.
-- ---------------------------------------------------------------------------------------------

create view public.tool_image with (security_barrier = true) as
select m.tool_id, m.storage_path
from private.tool_media m
where m.kind = 'image'
  and m.verified_at is not null
  and (select authz.current_access_level()) is not null;

revoke all on public.tool_image from public, anon, authenticated, service_role;
grant select on public.tool_image to authenticated;
