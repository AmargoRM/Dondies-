# Premios Dundies – Dirección de Aguas 💧🏆

Web para proponer categorías, nominar compañeros y votar a los ganadores,
inspirada en los Dundies de *The Office*.

**Web:** <https://amargorm.github.io/Dondies-/>

- **Sin registro ni correos.** Cada celular o computadora es un "dispositivo" y los límites se cuentan por dispositivo.
- **Límites:** 15 propuestas por dispositivo, **5 votos por día** por dispositivo, 1 voto por categoría en la final.
- **Datos:** se guardan como mensajes firmados en 6 servidores públicos y gratuitos de la red [Nostr](https://nostr.com) a la vez (no requiere cuenta). Si algunos servidores fallan, la web sigue funcionando con los demás.

## Cómo empezar (una sola vez)

1. Abra <https://amargorm.github.io/Dondies-/> en **su** celular o computadora.
2. Toque **Crear concurso**. Ese dispositivo queda como organizador.
3. En **Organizador → Enlaces** aparecen dos enlaces:
   - **Para compartir con todos**: mándelo por WhatsApp o correo.
   - **Su enlace de organizador**: guárdelo en privado. Sirve para entrar como organizador desde otro dispositivo.
4. Ajuste las **fechas** de cada fase en el mismo panel.
5. Para avanzar sin esperar las fechas, use el botón **➡️ Siguiente fase** que aparece solo al organizador en **Inicio** y en **Organizador**. Cierra la fase actual y abre la siguiente en ese momento (pide confirmación). Cerrar la votación final antes de tiempo **no** revela los ganadores; para eso hay un paso aparte, **Revelar los ganadores ahora**.

## Fases

| Fase | Qué pasa | Qué hace el organizador |
|---|---|---|
| 1. Categorías | Cada dispositivo propone hasta 15 categorías (nombre, "Porque…", ícono) y vota hasta 5 por día. Aviso de duplicados. Se puede quitar un voto del día | Editar, fusionar u ocultar categorías; revisar reportes |
| Cierre fase 1 | Las 15 más votadas quedan oficiales, automáticamente | Si hay empate en el puesto 15, elegir cuáles entran |
| 2. Nominaciones | Los jugadores **solo eligen de una lista desplegable** con los participantes que cargó el organizador, y pueden nominar a 1, 2 o a todos los que quieran en cada categoría (cada persona suma 1 por dispositivo). Se puede quitar una nominación mientras la fase esté abierta | Cargar la **lista de participantes** al inicio de la pantalla Nominar (un nombre por línea; se puede editar cuando quiera). Si hace falta, **Organizador → Unir nominados** junta nombres que son la misma persona |
| 3. Votación final | Los 3 más nominados de cada categoría son finalistas (empate en el 3.er lugar: pasan todos). 1 voto por categoría, máximo 5 por día. Solo se ve **cuántos votos se emitieron** en cada categoría, nunca quién va ganando | Nada |
| 4. Ganadores | Se revelan **a todos, automáticamente, en la fecha y hora de "Revelación de ganadores"** (si no se fija, al cierre de la fase 3). Tarjeta por ganador, descargable como imagen. **Empate en el 1.er lugar:** aparece la **Ruleta de retos**, que elige uno de 4 retos tontos (el mismo en todos los celulares); los empatados lo hacen en vivo | Fijar la hora en **Fechas**. Editar los 4 retos en **Organizador → Ruleta de retos**. Después del reto, en **Ganadores** tocar **"Ganó …"** para el que ganó |

## Límites de esta versión (importante)

Esta versión funciona sin cuentas, a cambio de estas limitaciones:

- **El límite por dispositivo se puede saltar.** Quien abra la web en modo incógnito, borre los datos del navegador o use otro navegador cuenta como un dispositivo nuevo.
- **Los datos no son secretos.** Los mensajes son públicos para quien conozca el código del concurso; alguien con conocimientos técnicos podría leer los conteos antes de tiempo.
- **Nadie puede cambiar los datos de otro.** Cada dispositivo firma sus propios votos con una llave que solo él tiene, y solo la llave del organizador puede cambiar fechas, categorías o publicar resultados.
- **El voto no es anónimo frente a alguien técnico:** cada voto queda asociado a un identificador de dispositivo, aunque ese identificador no dice de quién es.
- **La hora es la de cada dispositivo.** Si alguien tiene mal la hora del celular, puede ver una fase distinta. El "día" de los 5 votos usa la fecha de Costa Rica.
- **Depende de servidores públicos gratuitos sin garantías.** Por eso se guarda en 6 a la vez y cada visita vuelve a enviar los datos. Si todos fallaran, la web muestra "No hay conexión con los servidores".

Si más adelante quiere reglas a prueba de trampas (cuentas, voto secreto real), la versión con Supabase está en el historial del repositorio (commit `79328e3`).

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La página |
| `js/app.js` | Pantallas, reglas y conexión con los servidores |
| `js/vendor/nostr-tools-2.25.2.js` | Librería para firmar y enviar los mensajes (licencia en `js/vendor/`) |
| `js/tarjeta.js` | Dibuja la imagen descargable del ganador |
| `js/config.js` | Código del concurso (opcional; si está vacío, se usa el del enlace) |
| `css/estilos.css` | Diseño |
| `img/gota.svg` | Mascota |
| `docs/PRUEBAS.md` | Lista de pruebas |
