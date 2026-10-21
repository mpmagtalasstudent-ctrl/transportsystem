create table if not exists public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	email text not null default '',
	full_name text not null default '',
	mobile text not null default '',
	municipality text not null default '',
	barangay text not null default '',
	created_at timestamptz not null default now()
);

create table if not exists public.trips (
	id uuid primary key default gen_random_uuid(),
	passenger_id uuid not null references auth.users (id) on delete cascade,
	pickup text not null,
	destination text not null,
	pickup_at timestamptz not null,
	ride_type text not null check (ride_type in ('Standard', 'Shared', 'Private')),
	notes text not null default '',
	status text not null default 'upcoming' check (status in ('upcoming', 'cancelled', 'completed')),
	fare numeric(10, 2) not null default 0 check (fare >= 0),
	created_at timestamptz not null default now()
);

create table if not exists public.notifications (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users (id) on delete cascade,
	title text not null,
	message text not null,
	is_read boolean not null default false,
	created_at timestamptz not null default now()
);

create index if not exists trips_passenger_pickup_idx
	on public.trips (passenger_id, pickup_at desc);
create index if not exists notifications_user_created_idx
	on public.notifications (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.notifications enable row level security;

revoke all on public.profiles, public.trips, public.notifications from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, mobile, municipality, barangay) on public.profiles to authenticated;
grant select, insert on public.trips to authenticated;
grant update (status) on public.trips to authenticated;
grant select, insert on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
	on public.profiles for select to authenticated
	using (id = (select auth.uid()));

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
	on public.profiles for update to authenticated
	using (id = (select auth.uid()))
	with check (id = (select auth.uid()));

drop policy if exists "Users can read their trips" on public.trips;
create policy "Users can read their trips"
	on public.trips for select to authenticated
	using (passenger_id = (select auth.uid()));

drop policy if exists "Users can create their trips" on public.trips;
create policy "Users can create their trips"
	on public.trips for insert to authenticated
	with check (
		passenger_id = (select auth.uid())
		and status = 'upcoming'
		and fare = 0
	);

drop policy if exists "Users can cancel their upcoming trips" on public.trips;
create policy "Users can cancel their upcoming trips"
	on public.trips for update to authenticated
	using (passenger_id = (select auth.uid()) and status = 'upcoming')
	with check (passenger_id = (select auth.uid()) and status = 'cancelled');

drop policy if exists "Users can read their notifications" on public.notifications;
create policy "Users can read their notifications"
	on public.notifications for select to authenticated
	using (user_id = (select auth.uid()));

drop policy if exists "Users can create their notifications" on public.notifications;
create policy "Users can create their notifications"
	on public.notifications for insert to authenticated
	with check (user_id = (select auth.uid()));

drop policy if exists "Users can mark their notifications read" on public.notifications;
create policy "Users can mark their notifications read"
	on public.notifications for update to authenticated
	using (user_id = (select auth.uid()))
	with check (user_id = (select auth.uid()));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.profiles (id, email, full_name, mobile, municipality, barangay)
	values (
		new.id,
		coalesce(new.email, ''),
		coalesce(new.raw_user_meta_data ->> 'full_name', ''),
		coalesce(new.raw_user_meta_data ->> 'mobile', ''),
		coalesce(new.raw_user_meta_data ->> 'municipality', ''),
		coalesce(new.raw_user_meta_data ->> 'barangay', '')
	)
	on conflict (id) do nothing;
	return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
	after insert on auth.users
	for each row execute function public.handle_new_user();
