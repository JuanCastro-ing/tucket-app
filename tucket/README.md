# TUCKET — estructura del proyecto

Antes todo estaba en un solo archivo de ~2200 líneas. Ahora cada sección vive en su propio archivo.

## ¿Dónde está cada cosa?

| Sección | HTML (`views/`) | CSS (`css/views/`) | JS (`js/`) |
|---|---|---|---|
| Inicio | `home.html` | `home.css` | — |
| **Inicio de sesión** | `login.html` | `login.css` | `login.js` |
| **Registro** | `register.html` | `register.css` | `register.js` |
| Explorar eventos | `events.html` | `events.css` | `events.js` |
| Detalle de evento | `event-detail.html` | `event-detail.css` | `event-detail.js` |
| Mis reservas (cliente) | `reservations.html` | `reservations.css` | `reservations.js` |
| Eventos (agente) | `agent-events.html` | `agent-events.css` | — |
| Reservas (agente) | `agent-reservations.html` | `agent-reservations.css` | `agent-reservations.js` |
| Panel admin | `admin-dashboard.html` | `admin-dashboard.css` | — |

Compartido:
- `css/base/` → variables, reset y el mostrar/ocultar de vistas.
- `css/components/` → botones, formularios, tablas, tickets, marquesina, pie de página, WhatsApp, etc.
- `js/navigation.js` → `nav()`; `js/auth.js` → estado de sesión (`isLoggedIn`, `requireAuth`, `logout`).
- `js/loader.js` → carga las vistas dentro de `#app`.

## Cómo abrirlo

- **Desarrollo:** necesita un servidor local (Live Server de VS Code, o `python -m http.server` y abrir `http://localhost:8000`), porque cada vista se carga con `fetch`.
- **Un solo archivo:** `python build.py` genera `dist/tucket-app.html`, que abre con doble clic.

## Agregar una vista nueva

1. Crea `views/mi-vista.html` con `<div class="view" id="view-mi-vista"> … </div>`.
2. Agrega `"mi-vista"` a la lista `VIEWS` en `js/loader.js`.
3. (Opcional) `css/views/mi-vista.css` + su `<link>` en `index.html`.
4. Navega a ella con `nav('mi-vista')`.

> El orden de los `<link>` y `<script>` en `index.html` importa: es el mismo orden que tenía el CSS/JS original.
