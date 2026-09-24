# Premios Dundies – Dirección de Aguas 💧🏆

Web para proponer categorías, nominar compañeros y votar a los ganadores,
inspirada en los Dundies de *The Office*.

- **Web:** <https://amargorm.github.io/Dondies-/> (GitHub Pages, gratis).
- **Base de datos y cuentas:** Supabase (plan gratis).
- **Reglas anti-trampa:** viven dentro de la base de datos (`supabase/schema.sql`). Aunque alguien manipule la web, la base rechaza lo que no cumpla las reglas.

## Qué hace la web

| Pantalla | Qué se puede hacer |
|---|---|
| Inicio | Fase actual, cuenta regresiva, cómo funciona |
| Crear cuenta / Entrar | Registro con correo, contraseña y nombre visible; confirmación por correo; "¿Olvidaste tu contraseña?" |
| Categorías | Proponer (hasta 15), aviso de duplicados, votar (hasta 15), quitar voto, reportar. "Le quedan X propuestas / X votos" |
| Nominar | En cada categoría oficial, elegir a una persona registrada |
| Votar | Voto final secreto, 1 por categoría |
| Ganadores | Tarjeta por ganador, botón para descargarla como imagen |
| Admin | Participación, fechas, dominio permitido, cerrar fases, desempatar, reportes, editar/ocultar/fusionar categorías, publicar resultados |

---

# Instalación (una sola vez, ~30 minutos)

## Paso 1 – Crear el proyecto en Supabase

1. Entre a <https://supabase.com> → **Start your project**. Regístrese con GitHub o con un correo.
2. **New project**. Llene:
   - **Name:** `premios-dundies`
   - **Database Password:** clic en **Generate a password** y guárdela en un lugar seguro.
   - **Region:** **East US (North Virginia)** (la más cercana a Costa Rica).
3. **Create new project** y espere 1–2 minutos.

## Paso 2 – Pegar el script de la base de datos

1. Menú izquierdo → **SQL Editor** → **New query**.
2. Abra [`supabase/schema.sql`](supabase/schema.sql) en GitHub, clic en el botón **Copy raw file** (dos hojitas, arriba a la derecha) y péguelo completo en el editor.
3. Clic en **Run**. Debe decir **Success. No rows returned**.

> Ejecútelo **una sola vez**. Si lo corre otra vez dará errores *"already exists"*; no daña nada.

## Paso 3 – Conectar la web con Supabase

1. En Supabase: **Project Settings** (engranaje) → **API Keys** (o **Data API**). Copie:
   - **Project URL** (ej. `https://abcdxyz.supabase.co`)
   - **anon public key** (en proyectos nuevos se llama **publishable key** y empieza con `sb_publishable_`).
2. En GitHub abra [`js/config.js`](js/config.js) → ícono del lápiz (**Edit this file**).
3. Reemplace `PEGAR_AQUI_PROJECT_URL` y `PEGAR_AQUI_ANON_KEY` por esos dos valores (deje las comillas).
4. Clic en **Commit changes…** → **Commit changes**. En 1–2 minutos la web se actualiza.

> 🚫 **Nunca pegue la `service_role` key (o `secret key`) en ningún archivo.** Esa llave se salta todas
> las reglas. Si se publica por error: **Project Settings → API Keys** → genere una nueva de inmediato.

## Paso 4 – Decirle a Supabase cuál es la dirección de la web

Sin esto, los enlaces de los correos (confirmar cuenta, recuperar contraseña) llevan a una página que no existe.

1. Supabase → **Authentication** → **URL Configuration**.
2. **Site URL:** `https://amargorm.github.io/Dondies-/`
3. **Redirect URLs** → **Add URL** → `https://amargorm.github.io/Dondies-/` → **Save**.

## Paso 5 – Correo propio (SMTP) con Resend

El correo que trae Supabase solo manda **2–3 correos por hora** y únicamente a miembros del proyecto.
Para que le lleguen a todo el personal, hay que conectar un servicio de correo. Resend es gratis hasta 3 000 correos al mes.

**5.1 Crear la cuenta de Resend**
1. Entre a <https://resend.com> → **Sign up**.
2. **Domains** → **Add Domain** → escriba un dominio que usted controle (ej. `dundies.midominio.com`).
3. Resend le muestra 3–4 registros (tipo TXT y MX). Hay que agregarlos en el lugar donde se administra ese dominio
   (el proveedor del dominio o el departamento de TI). Cuando estén, clic en **Verify**. Puede tardar desde minutos hasta unas horas.
   - Si no tiene un dominio propio ni acceso al de la institución, pídale a TI que agregue esos registros, o use **Brevo** (abajo), que permite enviar verificando solo una dirección de correo.
4. **API Keys** → **Create API Key** → copie la llave (empieza con `re_`). Solo se muestra una vez.

**5.2 Conectarlo en Supabase**
1. Supabase → **Authentication** → **Emails** → pestaña **SMTP Settings** → activar **Enable Custom SMTP**.
2. Llene:
   - **Sender email:** `premios@dundies.midominio.com` (debe ser del dominio verificado)
   - **Sender name:** `Premios Dundies`
   - **Host:** `smtp.resend.com`
   - **Port:** `465`
   - **Username:** `resend`
   - **Password:** la llave `re_…`
3. **Save**.
4. En **Authentication → Rate Limits**, suba **Rate limit for sending emails** a unos 100 por hora.

**Alternativa: Brevo** (<https://www.brevo.com>, 300 correos al día gratis): **Senders, Domains & Dedicated IPs** → agregue y verifique su correo remitente;
**SMTP & API** → **SMTP** → copie el login y genere una **SMTP key**. En Supabase: Host `smtp-relay.brevo.com`, Port `587`, Username = el login de Brevo, Password = la SMTP key.

**5.3 (Opcional) Textos de los correos en español**
Supabase → **Authentication** → **Emails** → **Templates**:
- **Confirm signup** → Subject: `Confirme su cuenta – Premios Dundies`. En el cuerpo, deje el enlace `{{ .ConfirmationURL }}`.
- **Reset Password** → Subject: `Recuperar contraseña – Premios Dundies`, con `{{ .ConfirmationURL }}`.

## Paso 6 – Publicar en GitHub Pages

1. En GitHub, en su repositorio: **Settings** → **Pages**.
2. **Source:** *Deploy from a branch*. **Branch:** la rama donde está este código (hoy `claude/premios-dundies-supabase-yo986r`; si la une a `main`, elija `main`) y carpeta **/ (root)** → **Save**.
3. En 1–2 minutos la web queda en <https://amargorm.github.io/Dondies-/>.

## Paso 7 – Hacerse administrador

1. Entre a la web → **Crear cuenta**, confirme el correo.
2. Supabase → **SQL Editor** → **New query**, pegue esto **con su correo** y **Run**:

   ```sql
   update public.profiles
   set is_admin = true
   where id = (select id from auth.users where email = 'SU_CORREO@ejemplo.com');
   ```

3. Debe decir **1 row affected**. Recargue la web: aparece la pestaña **Admin**.

## Paso 8 – Ajustar fechas y dominio

En **Admin → Fechas y dominio**:
- Las fechas vienen puestas así: fase 1 empieza el día en que corrió el script y dura 3 semanas; luego 1 semana de nominaciones y 1 de votación final. Cámbielas y **Guardar**.
- **Dominio:** escriba por ejemplo `aya.go.cr` para aceptar solo esos correos. Vacío = cualquier correo.

---

# Cómo se usa durante el concurso (admin)

1. **Fase 1** corre sola. Revise **Reportes** en el panel; en **Categorías** cada tarjeta tiene botones **Editar / Fusionar / Ocultar**.
2. Cuando pase la fecha de cierre: **Admin → Cerrar fase 1 y elegir oficiales**. Si hay empate en el puesto 15, marque cuáles entran y **Confirmar**.
3. **Fase 2** corre sola en sus fechas. Al terminar: **Calcular finalistas**.
4. **Fase 3** corre sola. Al terminar: **Ganadores** muestra una vista previa con conteos (solo admin) → **Publicar resultados**.

Si quiere cerrar una fase antes, adelante su fecha de cierre en **Fechas** y luego use el botón.

# Reglas que aplica la base de datos

| Regla | Cómo se cumple |
|---|---|
| Solo correos confirmados participan | Cada función revisa la confirmación |
| Dominio permitido (opcional) | Un disparador en el registro rechaza otros dominios |
| Máx. 15 propuestas y 15 votos por persona, 1 voto por categoría | Funciones con conteo + clave única |
| Sin duplicados (sin mayúsculas ni tildes) | Índice único sobre el nombre normalizado |
| Fechas | Se usa la hora del servidor, no la del celular |
| 15 oficiales; empate lo decide el admin | `admin_close_phase1` + `admin_resolve_phase1_tie` |
| 1 nominación por categoría; no nominarse a sí mismo | Clave primaria + restricción |
| Top 3 a la final (empate en el 3.er lugar: pasan todos) | `admin_compute_finalists` |
| Voto final secreto, 1 por categoría | Ver abajo |
| Resultados ocultos hasta publicar | `get_results` no devuelve nada antes |
| Nadie escribe directo en las tablas ni se hace admin solo | Row Level Security sin permisos de escritura |

**Voto secreto:** se guarda en dos tablas que no se pueden unir: `final_ballots` (quién ya votó, sin decir por quién)
y `final_tally` (un contador por finalista, sin votantes ni horas). Por eso **el voto final no se puede cambiar**.
Límite honesto: alguien con acceso al panel de Supabase podría mirar el contador en vivo mientras una persona vota; no queda ningún registro que permita averiguarlo después.

**Empate en el 1.er lugar de la final:** ganadores compartidos (una tarjeta con ambos nombres).

# Pruebas

- Lista de pruebas manuales: [`docs/PRUEBAS.md`](docs/PRUEBAS.md).
- Pruebas automáticas de la base (para programadores), contra un Postgres local:

  ```bash
  psql -d base_vacia -f supabase/tests/00_supabase_stub.sql
  psql -d base_vacia -f supabase/schema.sql
  psql -d base_vacia -f supabase/tests/10_reglas.sql
  ```

# Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La página |
| `js/app.js` | Pantallas y lógica de la web |
| `js/config.js` | URL y llave pública de Supabase |
| `css/estilos.css` | Diseño |
| `img/gota.svg` | Mascota |
| `supabase/schema.sql` | Base de datos completa |
