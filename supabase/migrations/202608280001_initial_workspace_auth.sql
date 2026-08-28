create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.projects (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  url text not null check (char_length(url) <= 2048),
  lifecycle_status text not null default 'evidence_review' check (
    lifecycle_status in ('evidence_review', 'approved', 'draft_ready', 'submitted', 'published', 'failed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, url)
);

create table public.brand_profiles (
  id bigint generated always as identity primary key,
  project_id bigint not null unique references public.projects(id) on delete cascade,
  company text not null,
  product text not null,
  audience text not null,
  positioning text not null,
  source_url text not null,
  readiness_score smallint not null check (readiness_score between 0 and 100),
  readiness_label text not null,
  story_angle text not null,
  rationale jsonb not null default '[]'::jsonb check (jsonb_typeof(rationale) = 'array'),
  missing_information jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_information) = 'array'),
  version integer not null default 1 check (version > 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.claims (
  id bigint generated always as identity primary key,
  brand_profile_id bigint not null references public.brand_profiles(id) on delete cascade,
  stable_key text not null,
  claim_text text not null,
  source_url text not null,
  evidence_state text not null check (evidence_state in ('VERIFIED', 'INFERRED', 'ASSUMED', 'UNKNOWN')),
  approved boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_profile_id, stable_key),
  check ((approved = false) or (approved_by is not null and approved_at is not null))
);

create table public.campaigns (
  id bigint generated always as identity primary key,
  project_id bigint not null unique references public.projects(id) on delete cascade,
  status text not null default 'evidence_review' check (status in ('evidence_review', 'approved', 'draft_ready')),
  approved_at timestamptz,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.evidence_items (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  source_url text not null,
  evidence_type text not null check (evidence_type in ('source', 'placement', 'directory', 'backlink', 'indexing')),
  state text not null check (state in ('observed', 'submitted', 'published', 'indexed', 'pending', 'failed', 'removed')),
  excerpt text,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  observed_at timestamptz not null default now(),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, source_url, evidence_type)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);
create index workspaces_created_by_idx on public.workspaces (created_by);
create index projects_workspace_updated_idx on public.projects (workspace_id, updated_at desc);
create index projects_created_by_idx on public.projects (created_by);
create index claims_brand_profile_id_idx on public.claims (brand_profile_id);
create index claims_approved_by_idx on public.claims (approved_by) where approved_by is not null;
create index evidence_items_project_state_idx on public.evidence_items (project_id, state);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces
for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger brand_profiles_set_updated_at before update on public.brand_profiles
for each row execute function public.set_updated_at();
create trigger claims_set_updated_at before update on public.claims
for each row execute function public.set_updated_at();
create trigger campaigns_set_updated_at before update on public.campaigns
for each row execute function public.set_updated_at();

create or replace function public.is_workspace_member(target_workspace_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function public.can_access_project(target_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id bigint, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = (select auth.uid())
      and role = any(allowed_roles)
  );
$$;

create or replace function public.can_manage_project(target_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin', 'member')
  );
$$;

create or replace function public.can_access_brand_profile(target_profile_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.brand_profiles bp
    join public.projects p on p.id = bp.project_id
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where bp.id = target_profile_id
      and wm.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_manage_brand_profile(target_profile_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.brand_profiles bp
    join public.projects p on p.id = bp.project_id
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where bp.id = target_profile_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin', 'member')
  );
$$;

create or replace function public.ensure_personal_workspace()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  workspace_id bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtext(current_user_id::text));
  select wm.workspace_id into workspace_id
  from public.workspace_members wm
  where wm.user_id = current_user_id
  order by wm.created_at
  limit 1;

  if workspace_id is not null then return workspace_id; end if;

  insert into public.profiles (user_id) values (current_user_id)
  on conflict (user_id) do nothing;

  insert into public.workspaces (name, slug, created_by)
  values ('My Launch Workspace', 'workspace-' || left(replace(current_user_id::text, '-', ''), 16), current_user_id)
  returning id into workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace_id, current_user_id, 'owner');
  return workspace_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.brand_profiles enable row level security;
alter table public.claims enable row level security;
alter table public.campaigns enable row level security;
alter table public.evidence_items enable row level security;

create policy profiles_own_rows on public.profiles for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy workspaces_member_select on public.workspaces for select to authenticated
using ((select public.is_workspace_member(id)));
create policy workspaces_member_update on public.workspaces for update to authenticated
using ((select public.has_workspace_role(id, array['owner', 'admin'])))
with check ((select public.has_workspace_role(id, array['owner', 'admin'])));

create policy workspace_members_member_select on public.workspace_members for select to authenticated
using ((select public.is_workspace_member(workspace_id)));

create policy projects_member_select on public.projects for select to authenticated
using ((select public.is_workspace_member(workspace_id)));
create policy projects_member_insert on public.projects for insert to authenticated
with check ((select public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])) and created_by = (select auth.uid()));
create policy projects_member_update on public.projects for update to authenticated
using ((select public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])))
with check ((select public.has_workspace_role(workspace_id, array['owner', 'admin', 'member'])));
create policy projects_member_delete on public.projects for delete to authenticated
using ((select public.has_workspace_role(workspace_id, array['owner', 'admin'])));

create policy brand_profiles_project_select on public.brand_profiles for select to authenticated
using ((select public.can_access_project(project_id)));
create policy brand_profiles_project_insert on public.brand_profiles for insert to authenticated
with check ((select public.can_manage_project(project_id)));
create policy brand_profiles_project_update on public.brand_profiles for update to authenticated
using ((select public.can_manage_project(project_id))) with check ((select public.can_manage_project(project_id)));
create policy brand_profiles_project_delete on public.brand_profiles for delete to authenticated
using ((select public.can_manage_project(project_id)));

create policy claims_profile_select on public.claims for select to authenticated
using ((select public.can_access_brand_profile(brand_profile_id)));
create policy claims_profile_insert on public.claims for insert to authenticated
with check ((select public.can_manage_brand_profile(brand_profile_id)));
create policy claims_profile_update on public.claims for update to authenticated
using ((select public.can_manage_brand_profile(brand_profile_id))) with check ((select public.can_manage_brand_profile(brand_profile_id)));
create policy claims_profile_delete on public.claims for delete to authenticated
using ((select public.can_manage_brand_profile(brand_profile_id)));

create policy campaigns_project_select on public.campaigns for select to authenticated
using ((select public.can_access_project(project_id)));
create policy campaigns_project_insert on public.campaigns for insert to authenticated
with check ((select public.can_manage_project(project_id)));
create policy campaigns_project_update on public.campaigns for update to authenticated
using ((select public.can_manage_project(project_id))) with check ((select public.can_manage_project(project_id)));
create policy campaigns_project_delete on public.campaigns for delete to authenticated
using ((select public.can_manage_project(project_id)));

create policy evidence_items_project_select on public.evidence_items for select to authenticated
using ((select public.can_access_project(project_id)));
create policy evidence_items_project_insert on public.evidence_items for insert to authenticated
with check ((select public.can_manage_project(project_id)));
create policy evidence_items_project_update on public.evidence_items for update to authenticated
using ((select public.can_manage_project(project_id))) with check ((select public.can_manage_project(project_id)));
create policy evidence_items_project_delete on public.evidence_items for delete to authenticated
using ((select public.can_manage_project(project_id)));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.workspaces, public.workspace_members,
  public.projects, public.brand_profiles, public.claims, public.campaigns, public.evidence_items to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.ensure_personal_workspace() to authenticated;
grant execute on function public.is_workspace_member(bigint) to authenticated;
grant execute on function public.has_workspace_role(bigint, text[]) to authenticated;
grant execute on function public.can_access_project(bigint) to authenticated;
grant execute on function public.can_manage_project(bigint) to authenticated;
grant execute on function public.can_access_brand_profile(bigint) to authenticated;
grant execute on function public.can_manage_brand_profile(bigint) to authenticated;

revoke all on function public.ensure_personal_workspace() from public, anon;
revoke all on function public.is_workspace_member(bigint) from public, anon;
revoke all on function public.has_workspace_role(bigint, text[]) from public, anon;
revoke all on function public.can_access_project(bigint) from public, anon;
revoke all on function public.can_manage_project(bigint) from public, anon;
revoke all on function public.can_access_brand_profile(bigint) from public, anon;
revoke all on function public.can_manage_brand_profile(bigint) from public, anon;
revoke all on function public.set_updated_at() from public, anon;
revoke all on function public.handle_new_user() from public, anon;
