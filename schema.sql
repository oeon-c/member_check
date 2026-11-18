begin;

create table public.club_workspace (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id),
  revision integer not null default 0,
  state jsonb not null default '{"semesters":[],"events":[],"templates":[],"profile":{}}'
);

create table public.club_handover (
  club_id uuid primary key references public.club_workspace(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null
);

alter table public.club_workspace enable row level security;
alter table public.club_handover enable row level security;
revoke all on public.club_workspace, public.club_handover from anon, authenticated;
grant select (id, state, revision) on public.club_workspace to authenticated;
create policy current_owner_can_read on public.club_workspace
  for select to authenticated using (owner_id = (select auth.uid()));

create function public.save_club(club_id uuid, expected_revision integer, next_state jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare updated_revision integer;
begin
  update public.club_workspace
    set state = next_state, revision = revision + 1
    where id = club_id and owner_id = (select auth.uid()) and revision = expected_revision
    returning revision into updated_revision;
  if updated_revision is null then
    raise exception '저장 권한이 없거나 기록이 바뀌었어요. 새로고침 후 확인해 주세요.';
  end if;
  return updated_revision;
end;
$$;

create function public.create_handover(club_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invite uuid;
begin
  perform 1 from public.club_workspace where id = club_id and owner_id = (select auth.uid()) for update;
  if not found then raise exception '현 총무만 인수인계 링크를 만들 수 있어요.'; end if;
  insert into public.club_handover (club_id, expires_at)
    values (club_id, now() + interval '24 hours')
    on conflict on constraint club_handover_pkey do update set token = gen_random_uuid(), expires_at = excluded.expires_at
    returning token into invite;
  return invite;
end;
$$;

create function public.accept_handover(invite_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target uuid;
declare recipient uuid := auth.uid();
begin
  if recipient is null then raise exception '로그인이 필요해요.'; end if;
  select club_id into target from public.club_handover where token = invite_token and expires_at > now();
  if target is null then raise exception '만료되었거나 이미 사용한 링크예요.'; end if;
  perform 1 from public.club_workspace where id = target and owner_id <> recipient for update;
  if not found then raise exception '후임 계정으로 로그인해 주세요.'; end if;
  delete from public.club_handover where club_id = target and token = invite_token and expires_at > now();
  if not found then raise exception '만료되었거나 이미 사용한 링크예요.'; end if;
  update public.club_workspace set owner_id = recipient, revision = revision + 1,
    state = jsonb_set(state, '{profile}', '{}'::jsonb) where id = target;
end;
$$;

revoke all on function public.save_club(uuid, integer, jsonb), public.create_handover(uuid), public.accept_handover(uuid) from public, anon;
grant execute on function public.save_club(uuid, integer, jsonb), public.create_handover(uuid), public.accept_handover(uuid) to authenticated;
commit;
