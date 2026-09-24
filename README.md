# Premios Dundies – Dirección de Aguas 💧🏆

Web para elegir categorías, nominar compañeros y votar a los ganadores,
inspirada en los Dundies de *The Office*.

- **Sitio:** páginas estáticas (HTML, CSS y JavaScript) publicadas gratis en GitHub Pages.
- **Base de datos y cuentas:** Supabase (gratis en el plan inicial).
- **Reglas anti-trampa:** todas viven dentro de la base de datos (archivo `supabase/schema.sql`).
  El navegador solo muestra botones; aunque alguien los manipule, la base de datos rechaza lo que no cumpla las reglas.

---

## Estado del proyecto

| Etapa | Qué incluye | Estado |
|---|---|---|
| 1 | Base de datos con todas las reglas + vista previa del diseño | ✅ Lista |
| 2 | Registro, inicio de sesión, recuperar contraseña, correo (SMTP), publicar en GitHub Pages | Pendiente |
| 3 | Pantallas de las fases 1, 2 y 3 | Pendiente |
| 4 | Ganadores (tarjeta descargable), panel del admin, lista de pruebas manuales | Pendiente |

---

## Paso 1 – Crear el proyecto en Supabase

1. Entre a <https://supabase.com> y haga clic en **Start your project**. Regístrese con su cuenta de GitHub o con un correo.
2. Haga clic en **New project**.
3. Llene el formulario:
   - **Name:** `premios-dundies`
   - **Database Password:** haga clic en **Generate a password** y **guárdela en un lugar seguro** (un gestor de contraseñas o un papel en un lugar seguro). Casi nunca la va a usar, pero si la pierde no se recupera.
   - **Region:** elija **East US (North Virginia)**, que es la más cercana a Costa Rica.
4. Haga clic en **Create new project** y espere 1–2 minutos mientras se prepara.

## Paso 2 – Pegar el script de la base de datos

1. En el menú de la izquierda de Supabase, haga clic en **SQL Editor** (ícono de una hoja con `>_`).
2. Haga clic en **New query** (o el botón **+**).
3. Abra el archivo [`supabase/schema.sql`](supabase/schema.sql) de este repositorio, haga clic en el botón **Copy raw file** (ícono de dos hojas, arriba a la derecha del archivo en GitHub) y péguelo completo en el editor de Supabase.
4. Haga clic en **Run** (o presione `Ctrl + Enter`).
5. Debe aparecer **Success. No rows returned**. Eso significa que todo se creó bien.

> ⚠️ **Ejecútelo una sola vez.** Si lo ejecuta de nuevo, va a dar errores del tipo
> *"already exists"* (ya existe). Eso no daña nada: simplemente significa que ya estaba creado.

Para comprobar: en el menú izquierdo, entre a **Table Editor**. Debe ver las tablas
`config`, `profiles`, `categories`, `category_votes`, `category_reports`,
`nominations`, `finalists`, `final_ballots` y `final_tally`.

## Paso 3 – Hacerse administrador

Mientras no exista la página de registro (Etapa 2), cree su usuario desde Supabase:

1. Menú izquierdo → **Authentication** → **Users** → botón **Add user** → **Create new user**.
2. Escriba su correo y una contraseña. **Marque la casilla _Auto Confirm User_** y haga clic en **Create user**.
3. Vuelva a **SQL Editor** → **New query**, pegue esto **cambiando el correo por el suyo**, y haga clic en **Run**:

   ```sql
   update public.profiles
   set is_admin = true
   where id = (select id from auth.users where email = 'SU_CORREO@ejemplo.com');
   ```

4. Debe decir **Success. 1 row affected** (1 fila modificada). Si dice *0 rows*, el correo no coincide exactamente: revíselo.

Cuando exista la página de registro, podrá cambiar su nombre visible desde la web.

## Paso 4 – Anotar dos datos para la Etapa 2

En Supabase, menú izquierdo → **Project Settings** (engranaje) → **API Keys** / **Data API**. Anote:

- **Project URL**: algo como `https://abcdxyz.supabase.co`
- **anon public key** (en proyectos nuevos puede llamarse **publishable key** y empezar con `sb_publishable_`).

Esas dos se pueden poner en el código sin problema: son públicas y solo permiten lo que las reglas dejan.

> 🚫 **Nunca copie la `service_role` key (o `secret key`) en ningún archivo de este repositorio.**
> Esa llave se salta todas las reglas. Si alguna vez se publica por error, vaya a
> **Project Settings → API Keys** y genere una nueva de inmediato.

---

## Reglas que ya aplica la base de datos

| Regla | Cómo se hace cumplir |
|---|---|
| Solo personas con correo confirmado participan | Cada función revisa `email_confirmed_at` |
| Solo correos de un dominio (opcional) | Un disparador (trigger) en el registro rechaza otros dominios. Se activa poniendo el dominio en la configuración |
| Máximo 15 propuestas por persona | La función `propose_category` cuenta y bloquea |
| Sin duplicados (sin mayúsculas ni tildes) | Índice único sobre el nombre normalizado: "El Más Café" = "el mas cafe!!" |
| Máximo 15 votos, 1 por categoría | La función `vote_category` + clave primaria (persona, categoría) |
| Quitar votos solo con la fase abierta | `unvote_category` revisa la fecha |
| Fechas de cada fase | Todas las funciones revisan la hora del servidor (no la del celular) |
| 15 categorías oficiales, empate lo decide el admin | `admin_close_phase1` + `admin_resolve_phase1_tie` |
| 1 nominación por categoría, sin nominarse a sí mismo | Clave primaria + restricción `no_autonominarse` |
| Top 3 pasan a la final | `admin_compute_finalists` |
| 1 voto final por categoría | Tabla de comprobantes con clave primaria |
| Voto secreto | Ver abajo |
| Resultados ocultos hasta publicar | `get_results` no devuelve nada hasta que el admin publique |
| Nadie escribe directo en las tablas | Row Level Security activado sin permisos de escritura; solo las funciones pueden escribir |
| Nadie se hace admin solo | La columna `is_admin` no se puede modificar desde la web |

### ¿Cómo funciona el voto secreto?

La base de datos guarda el voto final en **dos lugares separados que no se pueden unir**:

- `final_ballots`: dice **quién ya votó** en cada categoría, pero **no por quién**.
- `final_tally`: es un **contador** por finalista (ej. "Ana: 7 votos"), **sin nombres de votantes** y sin fecha ni hora.

Por eso nadie, ni el admin ni el dueño de la base de datos, puede consultar después quién votó por quién.
**Consecuencia:** el voto final **no se puede cambiar** una vez emitido (el sistema no sabe cuál quitar). La web lo advertirá antes de confirmar.

**Límite honesto:** quien tenga acceso al panel de Supabase podría, en teoría, quedarse mirando el contador en vivo
y ver qué sube justo después de que una persona vota. Eso requiere espiar en tiempo real; no queda ningún registro guardado que lo permita después.

### Decisiones que tomé (se pueden cambiar si no le gustan)

1. **Empate en el 3.er lugar de nominaciones:** pasan todos los empatados (puede haber 4 finalistas).
2. **Empate en el 1.er lugar de la votación final:** ganadores compartidos (dos tarjetas).
3. **No se vale nominarse a sí mismo.** Sí se vale votar por la categoría propia en la fase 1.
4. **Nominaciones:** se pueden cambiar mientras la fase 2 esté abierta.
5. **Ocultar una categoría** devuelve los votos a quienes la habían votado.
6. **Fusionar** una repetida pasa sus votos a la otra; si alguien votó por ambas, recupera un voto.
7. **Cerrar cada fase** lo hace el admin con un botón, una vez que pasó la fecha. Si quiere cerrar antes, adelanta la fecha.
8. Los **conteos de votos** de la fase 1 son visibles para todos. Los de nominaciones y la final, no.

---

## Pruebas automáticas (opcional, para quien sepa programar)

`supabase/tests/` tiene 70+ pruebas que simulan usuarios intentando hacer trampa
(votar 16 veces, votar dos veces en la final, escribir directo en las tablas, etc.).
Se corren contra un Postgres local, **no** contra Supabase:

```bash
psql -d una_base_vacia -f supabase/tests/00_supabase_stub.sql
psql -d una_base_vacia -f supabase/schema.sql
psql -d una_base_vacia -f supabase/tests/10_reglas.sql
```

## Vista previa del diseño

`vista-previa-diseno.html` muestra cómo se verán el encabezado, la cuenta regresiva y las tarjetas (datos de ejemplo).
