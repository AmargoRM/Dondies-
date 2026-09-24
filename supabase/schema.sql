-- =====================================================================
--  PREMIOS DUNDIES – Dirección de Aguas
--  Script completo de base de datos para Supabase.
--
--  Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO este
--  archivo → Run. Se ejecuta una sola vez en un proyecto nuevo.
--
--  Principio: el navegador NO decide nada. Todas las reglas (límites,
--  fechas, un voto por persona, voto secreto) se validan aquí, dentro
--  de la base de datos. Las tablas no aceptan escrituras directas: solo
--  se puede escribir llamando a las funciones de este archivo, y cada
--  función revisa las reglas antes de tocar nada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. CONFIGURACIÓN GENERAL (una sola fila)
-- ---------------------------------------------------------------------
create table public.config (
  id                 int primary key default 1 check (id = 1),
  -- Dominio permitido para registrarse (ej. 'aya.go.cr'). NULL = cualquiera.
  allowed_domain     text,
  -- Fechas de cada fase (se guardan en UTC; la web las muestra en hora local).
  f1_start           timestamptz not null,
  f1_end             timestamptz not null,
  f2_start           timestamptz not null,
  f2_end             timestamptz not null,
  f3_start           timestamptz not null,
  f3_end             timestamptz not null,
  -- Límites del concurso.
  max_proposals      int not null default 15 check (max_proposals between 1 and 100),
  max_votes          int not null default 15 check (max_votes between 1 and 100),
  official_count     int not null default 15 check (official_count between 1 and 100),
  finalists_count    int not null default 3  check (finalists_count between 1 and 10),
  -- Banderas de avance (las cambia el admin con botones).
  phase1_closed      boolean not null default false,
  officials_ready    boolean not null default false,
  finalists_ready    boolean not null default false,
  results_published  boolean not null default false,
  updated_at         timestamptz not null default now(),
  constraint fechas_en_orden check (
        f1_start < f1_end
    and f1_end   <= f2_start
    and f2_start < f2_end
    and f2_end   <= f3_start
    and f3_start < f3_end
  )
);

-- Fechas iniciales: fase 1 empieza ya y dura 3 semanas; luego 1 + 1 semana.
-- El admin las puede cambiar desde la web.
insert into public.config (id, f1_start, f1_end, f2_start, f2_end, f3_start, f3_end)
values (
  1,
  now(),
  now() + interval '21 days',
  now() + interval '21 days',
  now() + interval '28 days',
  now() + interval '28 days',
  now() + interval '35 days'
);


-- ---------------------------------------------------------------------
-- 2. TABLAS
-- ---------------------------------------------------------------------

-- Normaliza texto para detectar duplicados: minúsculas, sin tildes,
-- sin signos, espacios simples. "¡El Más Café!" → "el mas cafe".
create or replace function public.normalize_text(t text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
    lower(translate(
      coalesce(t, ''),
      'ÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛÄËÏÖÑÇáéíóúüàèìòùâêîôûäëïöñç',
      'AEIOUUAEIOUAEIOUAEIONCaeiouuaeiouaeiouaeionc'
    )),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;

-- Perfil de cada persona registrada (se crea solo al registrarse).
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(btrim(display_name)) between 2 and 40),
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Categorías propuestas en la fase 1.
create table public.categories (
  id              bigint generated always as identity primary key,
  name            text not null check (char_length(btrim(name)) between 3 and 60),
  reason          text not null check (char_length(btrim(reason)) between 3 and 140),
  icon            text not null check (icon in (
                    'gota','trofeo','ola','cafe','risa','estrella','fiesta','cerebro',
                    'rayo','corazon','reloj','telefono','llave','grafico','micro',
                    'tortuga','cohete','pizza','sol','planta','camion','casco')),
  name_norm       text generated always as (public.normalize_text(name)) stored,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  status          text not null default 'active' check (status in ('active','hidden','merged')),
  merged_into     bigint references public.categories (id),
  is_official     boolean not null default false,
  tie_candidate   boolean not null default false,
  final_votes     int  -- foto de los votos al cerrar la fase 1
);
-- No puede haber dos categorías activas con el mismo nombre normalizado.
create unique index categories_nombre_unico
  on public.categories (name_norm) where status = 'active';
create index categories_created_by on public.categories (created_by);

-- Votos de la fase 1 (1 por persona y categoría, gracias a la clave primaria).
create table public.category_votes (
  user_id      uuid   not null references public.profiles (id) on delete cascade,
  category_id  bigint not null references public.categories (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, category_id)
);
create index category_votes_category on public.category_votes (category_id);

-- Reportes de categorías ofensivas o repetidas.
create table public.category_reports (
  id           bigint generated always as identity primary key,
  category_id  bigint not null references public.categories (id) on delete cascade,
  reported_by  uuid   not null references public.profiles (id) on delete cascade,
  reason       text check (reason is null or char_length(reason) <= 200),
  resolved     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (category_id, reported_by)
);

-- Nominaciones de la fase 2 (1 por persona y categoría).
create table public.nominations (
  user_id      uuid   not null references public.profiles (id) on delete cascade,
  category_id  bigint not null references public.categories (id) on delete cascade,
  nominee_id   uuid   not null references public.profiles (id) on delete cascade,
  updated_at   timestamptz not null default now(),
  primary key (user_id, category_id),
  constraint no_autonominarse check (user_id <> nominee_id)
);
create index nominations_category on public.nominations (category_id, nominee_id);

-- Finalistas de cada categoría (se calculan al cerrar la fase 2).
create table public.finalists (
  category_id  bigint not null references public.categories (id) on delete cascade,
  nominee_id   uuid   not null references public.profiles (id) on delete cascade,
  nominations  int    not null,
  primary key (category_id, nominee_id)
);

-- VOTO SECRETO (fase 3). Se guarda en DOS tablas que no se pueden cruzar:
--  * final_ballots: QUIÉN ya votó en qué categoría (sin decir por quién).
--  * final_tally:   CUÁNTOS votos tiene cada finalista (un contador, sin nombres).
-- Ninguna fila une a un votante con su elección, y no hay fechas ni horas
-- que permitan emparejarlas.
create table public.final_ballots (
  user_id      uuid   not null references public.profiles (id) on delete cascade,
  category_id  bigint not null references public.categories (id) on delete cascade,
  primary key (user_id, category_id)
);

create table public.final_tally (
  category_id  bigint not null,
  nominee_id   uuid   not null,
  votes        int    not null default 0 check (votes >= 0),
  primary key (category_id, nominee_id),
  foreign key (category_id, nominee_id)
    references public.finalists (category_id, nominee_id) on delete cascade
);


-- ---------------------------------------------------------------------
-- 3. FUNCIONES AUXILIARES
-- ---------------------------------------------------------------------

-- ¿La persona conectada es admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- Exige una persona conectada, con correo confirmado. Devuelve su id.
create or replace function public._require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Debe iniciar sesión.';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = v_uid and u.email_confirmed_at is not null
  ) then
    raise exception 'Debe confirmar su correo antes de participar.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Su perfil no existe. Cierre sesión y vuelva a entrar.';
  end if;
  return v_uid;
end;
$$;

create or replace function public._require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_user();
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede hacer esto.';
  end if;
  return v_uid;
end;
$$;

-- ¿Está abierta la fase N (1, 2 o 3) en este momento?
create or replace function public._phase_open(p int)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p
    when 1 then now() >= c.f1_start and now() < c.f1_end and not c.phase1_closed
    when 2 then now() >= c.f2_start and now() < c.f2_end and c.officials_ready and not c.finalists_ready
    when 3 then now() >= c.f3_start and now() < c.f3_end and c.finalists_ready and not c.results_published
    else false
  end
  from public.config c where c.id = 1
$$;

-- Nombre de la fase actual, para que la web sepa qué mostrar.
create or replace function public.current_phase()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when c.results_published                              then 'ganadores'
    when now() < c.f1_start                               then 'espera'
    when now() < c.f1_end and not c.phase1_closed         then 'categorias'
    when not c.officials_ready                            then 'cierre_categorias'
    when now() < c.f2_start                               then 'pausa_1_2'
    when now() < c.f2_end and not c.finalists_ready       then 'nominaciones'
    when not c.finalists_ready                            then 'cierre_nominaciones'
    when now() < c.f3_start                               then 'pausa_2_3'
    when now() < c.f3_end                                 then 'final'
    else                                                       'resultados_pendientes'
  end
  from public.config c where c.id = 1
$$;


-- ---------------------------------------------------------------------
-- 4. REGISTRO DE USUARIOS
-- ---------------------------------------------------------------------

-- Bloquea registros con correos de otro dominio (si se configuró uno).
create or replace function public._check_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_domain text;
begin
  select lower(btrim(ltrim(btrim(c.allowed_domain), '@'))) into v_domain
  from public.config c where c.id = 1;

  if v_domain is not null and v_domain <> ''
     and lower(split_part(coalesce(new.email, ''), '@', 2)) <> v_domain then
    raise exception 'Solo se permiten correos @%', v_domain;
  end if;
  return new;
end;
$$;

create trigger dundies_check_email_domain
  before insert or update of email on auth.users
  for each row execute function public._check_email_domain();

-- Crea el perfil automáticamente al registrarse, con el nombre visible.
create or replace function public._handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  v_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if char_length(v_name) < 2 then
    v_name := split_part(coalesce(new.email, 'persona'), '@', 1);
  end if;
  v_name := left(v_name, 40);
  if char_length(v_name) < 2 then
    v_name := v_name || '__';
  end if;
  insert into public.profiles (id, display_name) values (new.id, v_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger dundies_on_auth_user_created
  after insert on auth.users
  for each row execute function public._handle_new_user();

-- Cambiar el nombre visible propio.
create or replace function public.update_my_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_user();
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 40 then
    raise exception 'El nombre debe tener entre 2 y 40 caracteres.';
  end if;
  update public.profiles set display_name = btrim(p_name) where id = v_uid;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. ESTADO GENERAL (lo que la web pide al cargar)
-- ---------------------------------------------------------------------
create or replace function public.get_state()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select json_build_object(
    'phase',             public.current_phase(),
    'server_now',        now(),
    'allowed_domain',    c.allowed_domain,
    'f1_start', c.f1_start, 'f1_end', c.f1_end,
    'f2_start', c.f2_start, 'f2_end', c.f2_end,
    'f3_start', c.f3_start, 'f3_end', c.f3_end,
    'max_proposals',     c.max_proposals,
    'max_votes',         c.max_votes,
    'official_count',    c.official_count,
    'finalists_count',   c.finalists_count,
    'phase1_closed',     c.phase1_closed,
    'officials_ready',   c.officials_ready,
    'finalists_ready',   c.finalists_ready,
    'results_published', c.results_published,
    'me', case when auth.uid() is null then null else (
      select json_build_object(
        'id', p.id,
        'display_name', p.display_name,
        'is_admin', p.is_admin,
        'proposals_used', (select count(*) from public.categories x where x.created_by = p.id),
        'votes_used',     (select count(*) from public.category_votes v where v.user_id = p.id)
      )
      from public.profiles p where p.id = auth.uid()
    ) end
  )
  from public.config c where c.id = 1
$$;


-- ---------------------------------------------------------------------
-- 6. FASE 1 – CATEGORÍAS
-- ---------------------------------------------------------------------

-- Revisa nombre, frase e ícono de una categoría con mensajes claros.
create or replace function public._validate_category(p_name text, p_reason text, p_icon text)
returns void
language plpgsql
immutable
as $$
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 60 then
    raise exception 'El nombre debe tener entre 3 y 60 caracteres.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 140 then
    raise exception 'La frase "Porque…" debe tener entre 3 y 140 caracteres.';
  end if;
  if p_icon is null or p_icon not in (
       'gota','trofeo','ola','cafe','risa','estrella','fiesta','cerebro',
       'rayo','corazon','reloj','telefono','llave','grafico','micro',
       'tortuga','cohete','pizza','sol','planta','camion','casco') then
    raise exception 'Elija un ícono de la lista.';
  end if;
end;
$$;

-- Proponer una categoría (máximo 15 por persona, sin duplicados).
create or replace function public.propose_category(p_name text, p_reason text, p_icon text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := public._require_user();
  v_cfg   public.config;
  v_used  int;
  v_dup   text;
  v_id    bigint;
begin
  select * into v_cfg from public.config where id = 1;
  if not public._phase_open(1) then
    raise exception 'La fase de proponer categorías no está abierta.';
  end if;
  perform public._validate_category(p_name, p_reason, p_icon);

  -- Bloquea el perfil para que dos envíos simultáneos no se salten el límite.
  perform 1 from public.profiles where id = v_uid for update;

  select count(*) into v_used from public.categories where created_by = v_uid;
  if v_used >= v_cfg.max_proposals then
    raise exception 'Ya usó sus % propuestas.', v_cfg.max_proposals;
  end if;

  select name into v_dup from public.categories
  where status = 'active' and name_norm = public.normalize_text(p_name);
  if v_dup is not null then
    raise exception 'Ya existe una categoría igual: "%". Mejor vote por esa.', v_dup;
  end if;

  insert into public.categories (name, reason, icon, created_by)
  values (btrim(p_name), btrim(p_reason), p_icon, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- Votar por una categoría (máximo 15 votos, 1 por categoría).
create or replace function public.vote_category(p_category_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := public._require_user();
  v_max   int;
  v_used  int;
begin
  if not public._phase_open(1) then
    raise exception 'La votación de categorías no está abierta.';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id and status = 'active') then
    raise exception 'Esa categoría no existe o fue ocultada.';
  end if;

  perform 1 from public.profiles where id = v_uid for update;

  if exists (select 1 from public.category_votes where user_id = v_uid and category_id = p_category_id) then
    raise exception 'Ya votó por esta categoría.';
  end if;

  select max_votes into v_max from public.config where id = 1;
  select count(*) into v_used from public.category_votes where user_id = v_uid;
  if v_used >= v_max then
    raise exception 'Ya usó sus % votos. Quite uno para votar por otra.', v_max;
  end if;

  insert into public.category_votes (user_id, category_id) values (v_uid, p_category_id);
end;
$$;

-- Quitar un voto (solo mientras la fase 1 esté abierta).
create or replace function public.unvote_category(p_category_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_user();
begin
  if not public._phase_open(1) then
    raise exception 'La fase 1 ya cerró: los votos no se pueden cambiar.';
  end if;
  delete from public.category_votes where user_id = v_uid and category_id = p_category_id;
end;
$$;

-- Lista de categorías con conteo de votos y si yo voté.
create or replace function public.list_categories()
returns table (
  id bigint, name text, reason text, icon text, status text,
  author_name text, is_mine boolean, votes int, voted_by_me boolean,
  is_official boolean, tie_candidate boolean, open_reports int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := public._require_user();
  v_admin boolean := public.is_admin();
begin
  return query
  select c.id, c.name, c.reason, c.icon, c.status,
         p.display_name,
         c.created_by = v_uid,
         coalesce(c.final_votes, (select count(*) from public.category_votes v where v.category_id = c.id))::int,
         exists (select 1 from public.category_votes v where v.category_id = c.id and v.user_id = v_uid),
         c.is_official,
         c.tie_candidate,
         case when v_admin
              then (select count(*) from public.category_reports r where r.category_id = c.id and not r.resolved)::int
              else null end
  from public.categories c
  left join public.profiles p on p.id = c.created_by
  where c.status = 'active' or (v_admin and c.status = 'hidden')
  order by c.is_official desc, 8 desc, c.created_at;
end;
$$;

-- Reportar una categoría (una vez por persona y categoría).
create or replace function public.report_category(p_category_id bigint, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_user();
begin
  if not exists (select 1 from public.categories where id = p_category_id and status = 'active') then
    raise exception 'Esa categoría no existe.';
  end if;
  insert into public.category_reports (category_id, reported_by, reason)
  values (p_category_id, v_uid, nullif(left(btrim(coalesce(p_reason, '')), 200), ''))
  on conflict (category_id, reported_by) do nothing;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. FASE 2 – NOMINACIONES
-- ---------------------------------------------------------------------

-- Personas registradas y confirmadas (para elegir a quién nominar).
create or replace function public.list_people()
returns table (id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_user();
  return query
  select p.id, p.display_name
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email_confirmed_at is not null
  order by public.normalize_text(p.display_name);
end;
$$;

-- Nominar a una persona en una categoría oficial (se puede cambiar mientras
-- la fase esté abierta; no se vale nominarse a sí mismo).
create or replace function public.nominate(p_category_id bigint, p_nominee_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_user();
begin
  if not public._phase_open(2) then
    raise exception 'La fase de nominaciones no está abierta.';
  end if;
  if not exists (select 1 from public.categories
                 where id = p_category_id and is_official and status = 'active') then
    raise exception 'Esa categoría no es oficial.';
  end if;
  if p_nominee_id = v_uid then
    raise exception 'No se vale nominarse a sí mismo.';
  end if;
  if not exists (select 1 from public.profiles p join auth.users u on u.id = p.id
                 where p.id = p_nominee_id and u.email_confirmed_at is not null) then
    raise exception 'Esa persona no está registrada.';
  end if;

  insert into public.nominations (user_id, category_id, nominee_id)
  values (v_uid, p_category_id, p_nominee_id)
  on conflict (user_id, category_id)
  do update set nominee_id = excluded.nominee_id, updated_at = now();
end;
$$;

create or replace function public.remove_nomination(p_category_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_user();
begin
  if not public._phase_open(2) then
    raise exception 'La fase de nominaciones no está abierta.';
  end if;
  delete from public.nominations where user_id = v_uid and category_id = p_category_id;
end;
$$;

-- Mis nominaciones (solo las propias).
create or replace function public.my_nominations()
returns table (category_id bigint, nominee_id uuid, nominee_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_user();
begin
  return query
  select n.category_id, n.nominee_id, p.display_name
  from public.nominations n join public.profiles p on p.id = n.nominee_id
  where n.user_id = v_uid;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. FASE 3 – VOTACIÓN FINAL (SECRETA)
-- ---------------------------------------------------------------------

-- Finalistas de cada categoría + si yo ya voté en esa categoría
-- (NO dice por quién voté: eso no se guarda en ningún lado).
create or replace function public.list_finalists()
returns table (category_id bigint, nominee_id uuid, nominee_name text, i_already_voted boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_user();
begin
  if not (select finalists_ready from public.config where id = 1) then
    return;
  end if;
  return query
  select f.category_id, f.nominee_id, p.display_name,
         exists (select 1 from public.final_ballots b
                 where b.user_id = v_uid and b.category_id = f.category_id)
  from public.finalists f join public.profiles p on p.id = f.nominee_id
  order by f.category_id, public.normalize_text(p.display_name);
end;
$$;

-- Emitir el voto final. Una vez emitido NO se puede cambiar
-- (porque el sistema no sabe por quién votó usted).
create or replace function public.cast_final_vote(p_category_id bigint, p_nominee_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_user();
begin
  if not public._phase_open(3) then
    raise exception 'La votación final no está abierta.';
  end if;
  if not exists (select 1 from public.finalists
                 where category_id = p_category_id and nominee_id = p_nominee_id) then
    raise exception 'Esa persona no es finalista en esta categoría.';
  end if;

  begin
    insert into public.final_ballots (user_id, category_id) values (v_uid, p_category_id);
  exception when unique_violation then
    raise exception 'Ya votó en esta categoría.';
  end;

  update public.final_tally set votes = votes + 1
  where category_id = p_category_id and nominee_id = p_nominee_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 9. FASE 4 – RESULTADOS
-- ---------------------------------------------------------------------
-- Público (incluso sin sesión) SOLO cuando el admin publica: devuelve los
-- ganadores sin número de votos. El admin puede ver los conteos (nunca quién
-- votó por quién) cuando la votación final ya cerró.
-- Empate en el primer lugar = ganadores compartidos.
create or replace function public.get_results()
returns table (
  category_id bigint, category_name text, category_reason text, category_icon text,
  nominee_id uuid, nominee_name text, votes int, is_winner boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg   public.config;
  v_admin boolean := public.is_admin();
begin
  select * into v_cfg from public.config where id = 1;

  if v_admin and v_cfg.finalists_ready and now() >= v_cfg.f3_end then
    return query
    select c.id, c.name, c.reason, c.icon, t.nominee_id, p.display_name, t.votes,
           t.votes > 0 and t.votes = max(t.votes) over (partition by t.category_id)
    from public.final_tally t
    join public.categories c on c.id = t.category_id
    join public.profiles  p on p.id = t.nominee_id
    order by c.final_votes desc nulls last, c.id, t.votes desc;
    return;
  end if;

  if v_cfg.results_published then
    return query
    select x.id, x.name, x.reason, x.icon, x.nominee_id, x.display_name, null::int, true
    from (
      select c.id, c.name, c.reason, c.icon, c.final_votes, t.nominee_id, p.display_name, t.votes,
             max(t.votes) over (partition by t.category_id) as top
      from public.final_tally t
      join public.categories c on c.id = t.category_id
      join public.profiles  p on p.id = t.nominee_id
    ) x
    where x.votes > 0 and x.votes = x.top
    order by x.final_votes desc nulls last, x.id;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 10. FUNCIONES DEL ADMINISTRADOR
-- ---------------------------------------------------------------------

-- Cambiar fechas y dominio permitido.
create or replace function public.admin_update_config(
  p_f1_start timestamptz, p_f1_end timestamptz,
  p_f2_start timestamptz, p_f2_end timestamptz,
  p_f3_start timestamptz, p_f3_end timestamptz,
  p_allowed_domain text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  update public.config set
    f1_start = p_f1_start, f1_end = p_f1_end,
    f2_start = p_f2_start, f2_end = p_f2_end,
    f3_start = p_f3_start, f3_end = p_f3_end,
    allowed_domain = nullif(lower(btrim(ltrim(btrim(coalesce(p_allowed_domain, '')), '@'))), ''),
    updated_at = now()
  where id = 1;
exception when check_violation then
  raise exception 'Las fechas deben ir en orden: cada fase termina antes de que empiece la siguiente.';
end;
$$;

-- Editar nombre, frase o ícono de una categoría.
create or replace function public.admin_edit_category(
  p_category_id bigint, p_name text, p_reason text, p_icon text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  perform public._validate_category(p_name, p_reason, p_icon);
  update public.categories
     set name = btrim(p_name), reason = btrim(p_reason), icon = p_icon
   where id = p_category_id;
  if not found then
    raise exception 'Esa categoría no existe.';
  end if;
exception when unique_violation then
  raise exception 'Ya existe otra categoría activa con ese nombre.';
end;
$$;

-- Ocultar o mostrar una categoría. Al ocultarla se devuelven los votos a
-- quienes la habían votado (solo antes de cerrar la fase 1).
create or replace function public.admin_set_category_hidden(p_category_id bigint, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if (select phase1_closed from public.config where id = 1) then
    raise exception 'La fase 1 ya cerró: no se pueden ocultar categorías.';
  end if;
  if p_hidden then
    update public.categories set status = 'hidden'
     where id = p_category_id and status = 'active';
    if not found then raise exception 'Esa categoría no está activa.'; end if;
    delete from public.category_votes where category_id = p_category_id;
  else
    update public.categories set status = 'active'
     where id = p_category_id and status = 'hidden';
    if not found then raise exception 'Esa categoría no está oculta.'; end if;
  end if;
  update public.category_reports set resolved = true where category_id = p_category_id;
exception when unique_violation then
  raise exception 'No se puede mostrar: ya existe otra categoría activa con ese nombre.';
end;
$$;

-- Fusionar una categoría repetida (p_from) dentro de otra (p_into).
-- Los votos pasan a la categoría que queda; si alguien había votado por
-- ambas, se le devuelve un voto.
create or replace function public.admin_merge_categories(p_from bigint, p_into bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if (select phase1_closed from public.config where id = 1) then
    raise exception 'La fase 1 ya cerró: no se pueden fusionar categorías.';
  end if;
  if p_from = p_into then
    raise exception 'Elija dos categorías distintas.';
  end if;
  if (select count(*) from public.categories
      where id in (p_from, p_into) and status = 'active') <> 2 then
    raise exception 'Ambas categorías deben estar activas.';
  end if;

  insert into public.category_votes (user_id, category_id, created_at)
  select v.user_id, p_into, v.created_at
  from public.category_votes v where v.category_id = p_from
  on conflict (user_id, category_id) do nothing;

  delete from public.category_votes where category_id = p_from;

  update public.categories set status = 'merged', merged_into = p_into where id = p_from;
  update public.category_reports set resolved = true where category_id = p_from;
end;
$$;

-- Ver reportes pendientes.
create or replace function public.admin_list_reports()
returns table (report_id bigint, category_id bigint, category_name text,
               reported_by_name text, reason text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select r.id, r.category_id, c.name, p.display_name, r.reason, r.created_at
  from public.category_reports r
  join public.categories c on c.id = r.category_id
  join public.profiles  p on p.id = r.reported_by
  where not r.resolved
  order by r.created_at;
end;
$$;

create or replace function public.admin_resolve_report(p_report_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  update public.category_reports set resolved = true where id = p_report_id;
end;
$$;

-- Cerrar la fase 1: las 15 más votadas quedan oficiales.
-- Si hay empate en el puesto 15, las empatadas quedan como "candidatas"
-- y el admin elige con admin_resolve_phase1_tie.
create or replace function public.admin_close_phase1()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg     public.config;
  v_total   int;
  v_cut     int;
  v_above   int;
  v_at      int;
begin
  perform public._require_admin();
  select * into v_cfg from public.config where id = 1 for update;
  if v_cfg.phase1_closed then
    raise exception 'La fase 1 ya fue cerrada.';
  end if;
  if now() < v_cfg.f1_end then
    raise exception 'La fase 1 todavía no termina. Si quiere cerrarla antes, adelante la fecha de cierre.';
  end if;

  -- Foto de los votos de cada categoría activa.
  update public.categories c
     set final_votes = (select count(*) from public.category_votes v where v.category_id = c.id),
         is_official = false, tie_candidate = false
   where c.status = 'active';

  select count(*) into v_total from public.categories where status = 'active';

  if v_total <= v_cfg.official_count then
    update public.categories set is_official = true where status = 'active';
    update public.config set phase1_closed = true, officials_ready = true where id = 1;
    return json_build_object('officials', v_total, 'tie', false);
  end if;

  select final_votes into v_cut from public.categories
   where status = 'active'
   order by final_votes desc
   offset v_cfg.official_count - 1 limit 1;

  select count(*) filter (where final_votes > v_cut),
         count(*) filter (where final_votes = v_cut)
    into v_above, v_at
    from public.categories where status = 'active';

  if v_above + v_at = v_cfg.official_count then
    update public.categories set is_official = true
     where status = 'active' and final_votes >= v_cut;
    update public.config set phase1_closed = true, officials_ready = true where id = 1;
    return json_build_object('officials', v_cfg.official_count, 'tie', false);
  end if;

  update public.categories set is_official = true
   where status = 'active' and final_votes > v_cut;
  update public.categories set tie_candidate = true
   where status = 'active' and final_votes = v_cut;
  update public.config set phase1_closed = true, officials_ready = false where id = 1;

  return json_build_object(
    'officials', v_above,
    'tie', true,
    'slots_to_choose', v_cfg.official_count - v_above,
    'tied_candidates', v_at,
    'tied_votes', v_cut
  );
end;
$$;

-- Desempatar: el admin elige cuáles de las empatadas completan las 15.
create or replace function public.admin_resolve_phase1_tie(p_category_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg    public.config;
  v_slots  int;
  v_valid  int;
begin
  perform public._require_admin();
  select * into v_cfg from public.config where id = 1 for update;
  if not v_cfg.phase1_closed or v_cfg.officials_ready then
    raise exception 'No hay ningún empate pendiente.';
  end if;

  v_slots := v_cfg.official_count
           - (select count(*) from public.categories where is_official and status = 'active');

  select count(distinct id) into v_valid from public.categories
   where id = any(p_category_ids) and tie_candidate and status = 'active';

  if coalesce(array_length(p_category_ids, 1), 0) <> v_slots
     or v_valid <> v_slots then
    raise exception 'Debe elegir exactamente % categoría(s) entre las empatadas.', v_slots;
  end if;

  update public.categories set is_official = true where id = any(p_category_ids);
  update public.config set officials_ready = true where id = 1;
end;
$$;

-- Deshacer el cierre de la fase 1 (solo si nadie ha nominado todavía).
-- Útil si se cerró por error. Después hay que mover la fecha de cierre.
create or replace function public.admin_reopen_phase1()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if exists (select 1 from public.nominations) then
    raise exception 'Ya hay nominaciones: la fase 1 no se puede reabrir.';
  end if;
  update public.categories set is_official = false, tie_candidate = false, final_votes = null;
  update public.config set phase1_closed = false, officials_ready = false where id = 1;
end;
$$;

-- Cerrar la fase 2: los 3 más nominados de cada categoría pasan a la final.
-- Si hay empate en el 3.er lugar, pasan todos los empatados.
create or replace function public.admin_compute_finalists()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg public.config;
  v_n   int;
begin
  perform public._require_admin();
  select * into v_cfg from public.config where id = 1 for update;
  if not v_cfg.officials_ready then
    raise exception 'Primero cierre la fase 1.';
  end if;
  if v_cfg.finalists_ready then
    raise exception 'Los finalistas ya fueron calculados.';
  end if;
  if now() < v_cfg.f2_end then
    raise exception 'La fase 2 todavía no termina. Si quiere cerrarla antes, adelante la fecha de cierre.';
  end if;

  delete from public.finalists;

  insert into public.finalists (category_id, nominee_id, nominations)
  select category_id, nominee_id, n
  from (
    select n.category_id, n.nominee_id, count(*)::int as n,
           rank() over (partition by n.category_id order by count(*) desc) as pos
    from public.nominations n
    join public.categories c on c.id = n.category_id
    where c.is_official and c.status = 'active'
    group by n.category_id, n.nominee_id
  ) ranked
  where pos <= v_cfg.finalists_count;

  insert into public.final_tally (category_id, nominee_id, votes)
  select category_id, nominee_id, 0 from public.finalists;

  get diagnostics v_n = row_count;
  update public.config set finalists_ready = true where id = 1;
  return json_build_object('finalists', v_n);
end;
$$;

-- Deshacer el cálculo de finalistas (solo si nadie ha votado en la final).
create or replace function public.admin_reset_finalists()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if exists (select 1 from public.final_ballots) then
    raise exception 'Ya hay votos finales: los finalistas no se pueden recalcular.';
  end if;
  delete from public.finalists;
  update public.config set finalists_ready = false where id = 1;
end;
$$;

-- Publicar (o despublicar) los resultados.
create or replace function public.admin_publish_results(p_publish boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg public.config;
begin
  perform public._require_admin();
  select * into v_cfg from public.config where id = 1;
  if p_publish and (not v_cfg.finalists_ready or now() < v_cfg.f3_end) then
    raise exception 'La votación final todavía no ha terminado.';
  end if;
  update public.config set results_published = p_publish where id = 1;
end;
$$;

-- Estadísticas de participación (solo números, nunca quién votó por quién).
create or replace function public.admin_stats()
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return json_build_object(
    'people',            (select count(*) from public.profiles),
    'categories',        (select count(*) from public.categories where status = 'active'),
    'category_votes',    (select count(*) from public.category_votes),
    'nominations',       (select count(*) from public.nominations),
    'final_voters',      (select count(distinct user_id) from public.final_ballots),
    'final_ballots',     (select count(*) from public.final_ballots),
    'open_reports',      (select count(*) from public.category_reports where not resolved)
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 11. SEGURIDAD: Row Level Security y permisos
-- ---------------------------------------------------------------------
-- RLS activado en TODAS las tablas. Solo hay políticas de LECTURA; no hay
-- ninguna de escritura, así que nadie puede insertar/editar/borrar
-- directamente. Toda escritura pasa por las funciones de arriba.

alter table public.config            enable row level security;
alter table public.profiles          enable row level security;
alter table public.categories        enable row level security;
alter table public.category_votes    enable row level security;
alter table public.category_reports  enable row level security;
alter table public.nominations       enable row level security;
alter table public.finalists         enable row level security;
alter table public.final_ballots     enable row level security;
alter table public.final_tally       enable row level security;

-- Quitar todos los permisos por defecto sobre las tablas...
revoke all on table
  public.config, public.profiles, public.categories, public.category_votes,
  public.category_reports, public.nominations, public.finalists,
  public.final_ballots, public.final_tally
from public, anon, authenticated;

-- ...y devolver solo lectura donde tiene sentido.
grant select on public.config to anon, authenticated;
create policy "config: todos leen" on public.config
  for select to anon, authenticated using (true);

grant select on public.profiles to authenticated;
create policy "profiles: personas conectadas leen" on public.profiles
  for select to authenticated using (true);

grant select on public.categories to authenticated;
create policy "categories: activas, propias o admin" on public.categories
  for select to authenticated
  using (status = 'active' or created_by = auth.uid() or public.is_admin());

grant select on public.category_votes to authenticated;
create policy "category_votes: solo los propios" on public.category_votes
  for select to authenticated using (user_id = auth.uid());

grant select on public.category_reports to authenticated;
create policy "category_reports: propios o admin" on public.category_reports
  for select to authenticated using (reported_by = auth.uid() or public.is_admin());

grant select on public.nominations to authenticated;
create policy "nominations: solo las propias" on public.nominations
  for select to authenticated using (user_id = auth.uid());

grant select on public.finalists to authenticated;
create policy "finalists: visibles cuando están listos" on public.finalists
  for select to authenticated
  using ((select finalists_ready from public.config where id = 1));

grant select on public.final_ballots to authenticated;
create policy "final_ballots: solo los propios" on public.final_ballots
  for select to authenticated using (user_id = auth.uid());

-- final_tally: SIN permisos ni políticas. Nadie la lee desde la web;
-- los resultados salen solo por get_results().

-- Funciones: quitar el permiso de ejecutar a todos y darlo solo a las
-- que la web necesita.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.normalize_text(text)  to anon, authenticated;
grant execute on function public.is_admin()            to anon, authenticated;
grant execute on function public.current_phase()       to anon, authenticated;
grant execute on function public.get_state()           to anon, authenticated;
grant execute on function public.get_results()         to anon, authenticated;

grant execute on function public.update_my_name(text)                    to authenticated;
grant execute on function public.propose_category(text, text, text)      to authenticated;
grant execute on function public.vote_category(bigint)                   to authenticated;
grant execute on function public.unvote_category(bigint)                 to authenticated;
grant execute on function public.list_categories()                       to authenticated;
grant execute on function public.report_category(bigint, text)           to authenticated;
grant execute on function public.list_people()                           to authenticated;
grant execute on function public.nominate(bigint, uuid)                  to authenticated;
grant execute on function public.remove_nomination(bigint)               to authenticated;
grant execute on function public.my_nominations()                        to authenticated;
grant execute on function public.list_finalists()                        to authenticated;
grant execute on function public.cast_final_vote(bigint, uuid)           to authenticated;

grant execute on function public.admin_update_config(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.admin_edit_category(bigint, text, text, text) to authenticated;
grant execute on function public.admin_set_category_hidden(bigint, boolean)    to authenticated;
grant execute on function public.admin_merge_categories(bigint, bigint)        to authenticated;
grant execute on function public.admin_list_reports()                          to authenticated;
grant execute on function public.admin_resolve_report(bigint)                  to authenticated;
grant execute on function public.admin_close_phase1()                          to authenticated;
grant execute on function public.admin_resolve_phase1_tie(bigint[])            to authenticated;
grant execute on function public.admin_reopen_phase1()                         to authenticated;
grant execute on function public.admin_compute_finalists()                     to authenticated;
grant execute on function public.admin_reset_finalists()                       to authenticated;
grant execute on function public.admin_publish_results(boolean)                to authenticated;
grant execute on function public.admin_stats()                                 to authenticated;
-- (Las funciones admin_* revisan por dentro que quien llama sea admin.)

-- Las funciones que empiezan con "_" son internas: nadie de afuera las llama.

-- =====================================================================
--  FIN. Siguiente paso: hacerse admin (ver README, paso 3).
-- =====================================================================
