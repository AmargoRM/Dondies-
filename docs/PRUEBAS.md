# Lista de pruebas manuales

Hágalas con 2–3 cuentas de prueba (pueden ser correos personales si el dominio está vacío).
Para probar fases futuras sin esperar semanas, mueva las fechas en **Admin → Fechas**.
**Al terminar las pruebas, borre los datos de prueba** (ver final).

Marque ✅ si pasa lo que dice "Debe pasar".

## Cuentas

| # | Qué hacer | Debe pasar |
|---|---|---|
| 1 | Crear cuenta con nombre, correo y contraseña | "Revise su correo" y llega el correo |
| 2 | Intentar entrar sin confirmar | "Todavía no ha confirmado su correo" |
| 3 | Abrir el enlace del correo | Entra a la web con "¡Correo confirmado!" |
| 4 | Poner dominio `aya.go.cr` en Admin y registrarse con un @gmail.com | "Solo se permiten correos @aya.go.cr" |
| 5 | "¿Olvidaste tu contraseña?" → correo → enlace | Abre "Nueva contraseña"; al guardar, se puede entrar con la nueva |
| 6 | Entrar con contraseña equivocada | "Correo o contraseña incorrectos" |
| 7 | Cambiar el nombre visible en Mi perfil | El nombre nuevo aparece arriba |

## Fase 1 – Categorías

| # | Qué hacer | Debe pasar |
|---|---|---|
| 8 | Proponer una categoría | Aparece la tarjeta; "Le quedan 14 propuestas" |
| 9 | Escribir el mismo nombre con otras mayúsculas o sin tildes | Aviso "Ya existe…"; al enviar, lo rechaza |
| 10 | Proponer 15 categorías | Desaparece el formulario: "Ya usó sus 15 propuestas" |
| 11 | Votar 15 categorías | "Le quedan 0 votos"; los demás botones "Votar" quedan desactivados |
| 12 | Quitar un voto | "Le quedan 1 votos" y se puede votar otra |
| 13 | Reportar una categoría | "Gracias. El admin lo revisará"; aparece en Admin → Reportes |
| 14 | (Admin) Editar, fusionar y ocultar categorías | Cambian; al fusionar, los votos pasan a la otra |
| 15 | Cambiar la fecha de cierre de fase 1 a una hora pasada e intentar votar | "La votación de categorías no está abierta" |
| 16 | (Admin) Cerrar fase 1 | Quedan 15 oficiales; si hay empate, pide elegir |

## Fase 2 – Nominaciones

| # | Qué hacer | Debe pasar |
|---|---|---|
| 17 | Abrir Nominar | Una tarjeta por categoría oficial; usted no aparece en la lista |
| 18 | Nominar y luego cambiar de persona | Queda solo la última; "Nominó en X de 15" |
| 19 | (Admin) Tras el cierre, Calcular finalistas | Mensaje con la cantidad de finalistas |

## Fase 3 – Votación final

| # | Qué hacer | Debe pasar |
|---|---|---|
| 20 | Votar en una categoría | Pide confirmar; luego "Ya votó en esta categoría" |
| 21 | Recargar la página | Sigue "Ya votó" y no hay forma de volver a votar ni de ver por quién votó |
| 22 | Abrir Ganadores antes de publicar (usuario normal) | "Los ganadores se publicarán…" |
| 23 | Supabase → Table Editor → `final_ballots` y `final_tally` | Ninguna tabla une a una persona con su voto |

## Fase 4 – Ganadores

| # | Qué hacer | Debe pasar |
|---|---|---|
| 24 | (Admin) Tras el cierre, Ganadores → vista previa → Publicar | Aparecen las tarjetas |
| 25 | Abrir Ganadores sin sesión (ventana de incógnito) | Se ven los ganadores, sin número de votos |
| 26 | Descargar imagen en el celular | Se guarda un PNG con la tarjeta |

## Pruebas de trampa (opcional, para alguien técnico)

Con la sesión abierta, en la consola del navegador (F12):

```js
// Votar 16 veces saltándose la web
const { data: { session } } = await sb.auth.getSession();
for (const c of (await sb.rpc('list_categories')).data) console.log(await sb.rpc('vote_category', { p_category_id: c.id }));
// Debe dar "Ya usó sus 15 votos" a partir del voto 16.

// Escribir directo en la tabla
await sb.from('category_votes').insert({ user_id: session.user.id, category_id: 1 });   // → permission denied
await sb.from('profiles').update({ is_admin: true }).eq('id', session.user.id);          // → permission denied
await sb.from('final_tally').select('*');                                                // → permission denied
```

## Borrar datos de prueba antes del concurso real

⚠️ **Esto borra TODO lo que se haya propuesto, votado y nominado. No se puede deshacer.**
Supabase → SQL Editor → pegar y **Run**:

```sql
truncate public.final_tally, public.final_ballots, public.finalists, public.nominations,
         public.category_reports, public.category_votes, public.categories restart identity cascade;
update public.config set phase1_closed = false, officials_ready = false,
       finalists_ready = false, results_published = false where id = 1;
```

Las cuentas de usuario no se borran. Para borrar cuentas de prueba: **Authentication → Users** → los tres puntos → **Delete user**.
