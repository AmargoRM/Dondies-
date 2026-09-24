-- Pruebas automáticas de las reglas de schema.sql (Postgres local).
-- Cada línea "OK" es una regla que funcionó. Si una regla falla, el
-- script se detiene con "FALLA: ...".
\set QUIET on
set client_min_messages = notice;

-- ---------- utilidades de prueba ----------
create function public.t_login(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims',
    coalesce(json_build_object('sub', (select id from auth.users where email = p_email))::text, ''), false);
end $$;

create function public.t_fail(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then
      raise notice 'OK bloqueado: %  →  %', p_sql, sqlerrm;
      return;
    end if;
    raise exception 'FALLA: "%" dio un error inesperado: %', p_sql, sqlerrm;
  end;
  raise exception 'FALLA: se esperaba un error en "%"', p_sql;
end $$;

create function public.t_eq(p_actual anyelement, p_expected anyelement, p_label text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALLA: % (obtuvo %, esperaba %)', p_label, p_actual, p_expected;
  end if;
  raise notice 'OK: %', p_label;
end $$;

-- Fechas relativas a "ahora" (en horas) para abrir/cerrar fases.
create function public.t_dates(a int, b int, c int, d int, e int, f int) returns void language sql as $$
  update public.config set
    f1_start = now() + make_interval(hours => a), f1_end = now() + make_interval(hours => b),
    f2_start = now() + make_interval(hours => c), f2_end = now() + make_interval(hours => d),
    f3_start = now() + make_interval(hours => e), f3_end = now() + make_interval(hours => f)
  where id = 1
$$;

create function public.cat(p_name text) returns bigint language sql security definer as $$
  select id from public.categories where name = p_name
$$;
create function public.uid_of(p_email text) returns uuid language sql security definer as $$
  select id from auth.users where email = p_email
$$;

-- ---------- usuarios ----------
insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values
  ('admin@x.com', now(), '{"display_name":"Jefa Admin"}'),
  ('ana@x.com',   now(), '{"display_name":"Ana"}'),
  ('beto@x.com',  now(), '{"display_name":"Beto"}'),
  ('carla@x.com', now(), '{"display_name":"Carla"}'),
  ('eve@x.com',   null,  '{"display_name":"Eve sin confirmar"}');
insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
select 'v' || g || '@x.com', now(), json_build_object('display_name', 'Votante ' || g)::jsonb
from generate_series(1, 20) g;

select t_eq((select count(*) from public.profiles)::int, 25, 'El perfil se crea solo al registrarse');
update public.profiles set is_admin = true where id = uid_of('admin@x.com');

-- =====================================================================
-- SEGURIDAD BÁSICA
-- =====================================================================
select t_dates(-1, 24, 24, 48, 48, 72);   -- fase 1 abierta

set role anon;
select t_login('');
select t_fail($$select public.propose_category('Anónima','nadie','gota')$$, 'permission denied');
select t_fail($$select * from public.profiles$$, 'permission denied');
select t_eq((select (public.get_state() ->> 'phase')), 'categorias', 'Visitante sin sesión ve la fase actual');
reset role;

set role authenticated;
select t_login('eve@x.com');
select t_fail($$select public.propose_category('De Eve','porque sí','gota')$$, 'confirmar su correo');

select t_login('ana@x.com');
select t_fail($$insert into public.categories (name, reason, icon) values ('Directa','trampa','gota')$$, 'permission denied');
select t_fail($$update public.profiles set is_admin = true$$, 'permission denied');
select t_fail($$insert into public.category_votes values (auth.uid(), 1)$$, 'permission denied');
select t_fail($$select * from public.final_tally$$, 'permission denied');
select t_fail($$select public._require_user()$$, 'permission denied');
select t_fail($$select public.admin_close_phase1()$$, 'Solo el administrador');
select t_fail($$select public.admin_update_config(now(), now()+'1d', now()+'1d', now()+'2d', now()+'2d', now()+'3d', null)$$, 'Solo el administrador');
reset role;

-- =====================================================================
-- FASE 1: PROPUESTAS
-- =====================================================================
set role authenticated;
select t_login('ana@x.com');
select public.propose_category('El Más Café', 'nunca suelta la taza', 'cafe');
select public.propose_category('Ana ' || g, 'motivo ' || g, 'gota') from generate_series(2, 15) g;
select t_eq((public.get_state() -> 'me' ->> 'proposals_used')::int, 15, 'Ana usó 15 propuestas');
select t_fail($$select public.propose_category('La 16', 'una de más', 'gota')$$, 'Ya usó sus 15 propuestas');

select t_login('beto@x.com');
select t_fail($$select public.propose_category('  el MAS  cafe!! ', 'repetida', 'cafe')$$, 'Ya existe una categoría igual');
select t_fail($$select public.propose_category('Ícono raro', 'x y z', 'dinosaurio')$$, 'Elija un ícono');
select t_fail($$select public.propose_category('ab', 'nombre muy corto', 'gota')$$, 'entre 3 y 60');
select public.propose_category('Beto ' || g, 'motivo ' || g, 'sol') from generate_series(1, 3) g;
reset role;

-- =====================================================================
-- FASE 1: VOTOS
-- =====================================================================
set role authenticated;
select t_login('beto@x.com');
select public.vote_category(cat('Ana ' || g)) from generate_series(2, 15) g;   -- 14 votos
select public.vote_category(cat('Beto 1'));                                    -- 15
select t_fail($$select public.vote_category(public.cat('El Más Café'))$$, 'Ya usó sus 15 votos');
select t_fail($$select public.vote_category(public.cat('Beto 1'))$$, 'Ya votó por esta categoría');
select public.unvote_category(cat('Beto 1'));
select t_eq((public.get_state() -> 'me' ->> 'votes_used')::int, 14, 'Quitar un voto devuelve el voto');
select public.vote_category(cat('El Más Café'));
select t_eq((public.get_state() -> 'me' ->> 'votes_used')::int, 15, 'Puede votar otra después de quitar uno');

select t_login('ana@x.com');
select t_eq((select count(*) from public.category_votes)::int, 0, 'Ana no ve los votos de Beto');
select t_eq((select votes from public.list_categories() where name = 'El Más Café'), 1, 'El conteo público sí suma el voto de Beto');

-- Reportes
select public.report_category(cat('Beto 3'), 'ofensiva');
select public.report_category(cat('Beto 3'), 'otra vez');
reset role;
select t_eq((select count(*) from public.category_reports)::int, 1, 'Un reporte por persona y categoría');

-- =====================================================================
-- MODERACIÓN
-- =====================================================================
set role authenticated;
select t_login('admin@x.com');
select t_eq((select count(*) from public.admin_list_reports())::int, 1, 'El admin ve el reporte');
select public.admin_set_category_hidden(cat('Beto 3'), true);
select t_eq((select count(*) from public.admin_list_reports())::int, 0, 'Ocultar resuelve el reporte');
select public.admin_edit_category(cat('Beto 2'), 'Beto dos', 'editada por admin', 'estrella');
select t_fail($$select public.admin_edit_category(public.cat('Beto dos'), 'el más CAFÉ', 'x y z', 'gota')$$, 'Ya existe otra');

-- Fusionar "Beto 1" (sin votos de Beto) dentro de "Ana 2" (votada por Beto)
select t_login('carla@x.com');
select public.vote_category(cat('Beto 1'));
select public.vote_category(cat('Ana 2'));
select t_login('admin@x.com');
select public.admin_merge_categories(cat('Beto 1'), cat('Ana 2'));
select t_login('carla@x.com');
select t_eq((public.get_state() -> 'me' ->> 'votes_used')::int, 1, 'Al fusionar, quien votó ambas recupera un voto');
select t_eq((select votes from public.list_categories() where name = 'Ana 2'), 2, 'Ana 2 conserva sus votos tras la fusión');
select t_eq((select count(*) from public.list_categories() where name = 'Beto 1')::int, 0, 'La categoría fusionada ya no aparece');
reset role;

-- =====================================================================
-- CIERRE DE FASE 1 CON EMPATE
-- Activas: El Más Café, Ana 2..15, Beto dos = 16. Oficiales: 15.
-- =====================================================================
-- Borramos votos y armamos un empate: 14 categorías con muchos votos y
-- 2 empatadas en el puesto 15.
delete from public.category_votes;
do $$
declare g int; c text;
begin
  for g in 1..20 loop
    perform set_config('request.jwt.claims', json_build_object('sub', uid_of('v' || g || '@x.com'))::text, false);
    foreach c in array array['Ana 2','Ana 3','Ana 4','Ana 5','Ana 6','Ana 7','Ana 8','Ana 9','Ana 10','Ana 11','Ana 12','Ana 13','Ana 14','Ana 15'] loop
      perform public.vote_category(public.cat(c));
    end loop;
    if g <= 3 then perform public.vote_category(public.cat('El Más Café')); end if;
    if g between 4 and 6 then perform public.vote_category(public.cat('Beto dos')); end if;
  end loop;
end $$;

set role authenticated;
select t_login('admin@x.com');
select t_fail($$select public.admin_close_phase1()$$, 'todavía no termina');
reset role;
select t_dates(-48, -1, 1, 48, 48, 72);   -- fase 1 terminó; fase 2 aún no empieza
set role authenticated;
select t_login('beto@x.com');
select t_fail($$select public.vote_category(public.cat('Ana 3'))$$, 'no está abierta');
select t_fail($$select public.unvote_category(public.cat('Ana 3'))$$, 'ya cerró');
select t_fail($$select public.propose_category('Tardía', 'fuera de tiempo', 'reloj')$$, 'no está abierta');

select t_login('admin@x.com');
select t_eq((public.admin_close_phase1() ->> 'slots_to_choose')::int, 1, 'Empate en el puesto 15: queda 1 cupo para decidir');
select t_eq((select count(*) from public.categories where tie_candidate)::int, 2, 'Hay 2 categorías empatadas');
select t_fail($$select public.admin_resolve_phase1_tie(array[public.cat('El Más Café'), public.cat('Beto dos')])$$, 'exactamente 1');
select t_fail($$select public.admin_resolve_phase1_tie(array[public.cat('Ana 2')])$$, 'exactamente 1');
select public.admin_resolve_phase1_tie(array[cat('Beto dos')]);
select t_eq((select count(*) from public.categories where is_official)::int, 15, 'Quedan exactamente 15 oficiales');
select t_fail($$select public.admin_set_category_hidden(public.cat('Ana 2'), true)$$, 'ya cerró');
reset role;

-- =====================================================================
-- FASE 2: NOMINACIONES
-- =====================================================================
set role authenticated;
select t_login('ana@x.com');
select t_fail($$select public.nominate(public.cat('Ana 2'), public.uid_of('beto@x.com'))$$, 'no está abierta');
reset role;
select t_dates(-72, -48, -1, 24, 24, 48);   -- fase 2 abierta
set role authenticated;
select t_login('ana@x.com');
select t_fail($$select public.nominate(public.cat('El Más Café'), public.uid_of('beto@x.com'))$$, 'no es oficial');
select t_fail($$select public.nominate(public.cat('Ana 2'), public.uid_of('ana@x.com'))$$, 'nominarse a sí mismo');
select t_fail($$select public.nominate(public.cat('Ana 2'), public.uid_of('eve@x.com'))$$, 'no está registrada');
select t_fail($$select public.nominate(public.cat('Ana 2'), gen_random_uuid())$$, 'no está registrada');
select t_eq((select count(*) from public.list_people() where display_name like 'Eve%')::int, 0, 'Personas sin confirmar no aparecen para nominar');
select public.nominate(cat('Ana 2'), uid_of('carla@x.com'));
select public.nominate(cat('Ana 2'), uid_of('beto@x.com'));   -- cambia de opinión
select t_eq((select count(*) from public.my_nominations())::int, 1, 'Una sola nominación por categoría (la segunda reemplaza)');
select t_eq((select nominee_name from public.my_nominations()), 'Beto', 'Queda la última nominación');
reset role;

-- Nominaciones en "Ana 2": Beto 6, Carla 4, Votante 1: 2, Votante 2: 2, Votante 3: 1
-- → finalistas: Beto, Carla, Votante 1 y Votante 2 (empate en 3.er lugar).
do $$
declare g int;
begin
  for g in 1..14 loop
    perform set_config('request.jwt.claims', json_build_object('sub', uid_of('v' || (g + 4) || '@x.com'))::text, false);
    perform public.nominate(public.cat('Ana 2'), uid_of(case
      when g <= 5  then 'beto@x.com'
      when g <= 9  then 'carla@x.com'
      when g <= 11 then 'v1@x.com'
      when g <= 13 then 'v2@x.com'
      else 'v3@x.com' end));
  end loop;
end $$;

set role authenticated;
select t_login('admin@x.com');
select t_fail($$select public.admin_compute_finalists()$$, 'todavía no termina');
reset role;
select t_dates(-96, -72, -48, -1, 1, 48);
set role authenticated;
select t_login('ana@x.com');
select t_fail($$select public.nominate(public.cat('Ana 3'), public.uid_of('beto@x.com'))$$, 'no está abierta');
select t_login('admin@x.com');
select public.admin_compute_finalists();
select t_eq((select string_agg(nominee_name, ', ' order by nominee_name) from public.list_finalists() where category_id = cat('Ana 2')),
            'Beto, Carla, Votante 1, Votante 2', 'Top 3 con empate en el 3.er lugar (pasan los empatados)');
reset role;

-- =====================================================================
-- FASE 3: VOTACIÓN FINAL SECRETA
-- =====================================================================
set role authenticated;
select t_login('ana@x.com');
select t_fail($$select public.cast_final_vote(public.cat('Ana 2'), public.uid_of('beto@x.com'))$$, 'no está abierta');
reset role;
select t_dates(-120, -96, -72, -48, -1, 24);
set role authenticated;
select t_login('ana@x.com');
select t_fail($$select public.cast_final_vote(public.cat('Ana 2'), public.uid_of('v3@x.com'))$$, 'no es finalista');
select public.cast_final_vote(cat('Ana 2'), uid_of('beto@x.com'));
select t_fail($$select public.cast_final_vote(public.cat('Ana 2'), public.uid_of('beto@x.com'))$$, 'Ya votó');
select t_fail($$select public.cast_final_vote(public.cat('Ana 2'), public.uid_of('carla@x.com'))$$, 'Ya votó');
select t_eq((select i_already_voted from public.list_finalists() where category_id = cat('Ana 2') limit 1), true, 'La web sabe que Ana ya votó (pero no por quién)');
select t_login('carla@x.com');
select public.cast_final_vote(cat('Ana 2'), uid_of('carla@x.com'));
select t_eq((select count(*) from public.final_ballots)::int, 1, 'Carla solo ve su propio comprobante');
select t_fail($$select * from public.final_tally$$, 'permission denied');
select t_eq((select count(*) from public.get_results())::int, 0, 'Resultados ocultos para usuarios antes de publicar');
select t_login('admin@x.com');
select t_eq((select count(*) from public.get_results())::int, 0, 'Resultados ocultos incluso para el admin mientras se vota');
select t_fail($$select public.admin_publish_results(true)$$, 'todavía no ha terminado');
reset role;

-- La tabla de comprobantes NO tiene ninguna columna que diga por quién se votó.
select t_eq((select string_agg(column_name, ',' order by column_name) from information_schema.columns
             where table_schema = 'public' and table_name = 'final_ballots'),
            'category_id,user_id', 'final_ballots no guarda la elección');
select t_eq((select string_agg(column_name, ',' order by column_name) from information_schema.columns
             where table_schema = 'public' and table_name = 'final_tally'),
            'category_id,nominee_id,votes', 'final_tally no guarda quién votó');

-- Cierra la votación final.
select t_dates(-144, -120, -96, -72, -48, -1);
set role authenticated;
select t_login('beto@x.com');
select t_fail($$select public.cast_final_vote(public.cat('Ana 3'), null)$$, 'no está abierta');
select t_eq((select count(*) from public.get_results())::int, 0, 'Sin publicar, los usuarios no ven nada');
select t_login('admin@x.com');
select t_eq((select string_agg(nominee_name, ', ' order by nominee_name) from public.get_results() where category_id = cat('Ana 2') and is_winner),
            'Beto, Carla', 'Empate en el 1.er lugar = ganadores compartidos (vista previa del admin)');
select public.admin_publish_results(true);
reset role;
set role anon;
select t_login('');
select t_eq((select count(*) from public.get_results() where votes is not null)::int, 0, 'Al publicar, el público ve ganadores sin número de votos');
select t_eq((select count(*) from public.get_results())::int, 2, 'El público ve los 2 ganadores compartidos');
reset role;

-- =====================================================================
-- DOMINIO DE CORREO Y FECHAS
-- =====================================================================
set role authenticated;
select t_login('admin@x.com');
select t_fail($$select public.admin_update_config(now(), now()-'1d'::interval, now(), now()+'1d', now()+'1d', now()+'2d', null)$$, 'deben ir en orden');
select public.admin_update_config(now()-'10d'::interval, now()-'9d'::interval, now()-'8d'::interval, now()-'7d'::interval, now()-'6d'::interval, now()-'5d'::interval, '@AyA.go.cr');
reset role;
select t_eq((select allowed_domain from public.config), 'aya.go.cr', 'El dominio se guarda limpio');
select t_fail($$insert into auth.users (email, email_confirmed_at) values ('intruso@gmail.com', now())$$, 'Solo se permiten correos @aya.go.cr');
insert into auth.users (email) values ('Funcionaria@AYA.go.cr');
select t_eq((select count(*) from public.profiles p join auth.users u on u.id = p.id where u.email = 'Funcionaria@AYA.go.cr')::int, 1, 'Correo del dominio permitido sí entra');
select t_fail($$update auth.users set email = 'fuga@gmail.com' where email = 'Funcionaria@AYA.go.cr'$$, 'Solo se permiten correos');

\echo
\echo '=========== TODAS LAS PRUEBAS PASARON ==========='
