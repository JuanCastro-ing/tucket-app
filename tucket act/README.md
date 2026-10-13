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
- `css/base/` → variables (colores, sombras, z-index, motion, paleta de gráficas), reset y el mostrar/ocultar de vistas.
- `css/components/` → botones, formularios, tablas, tickets, marquesina, pie de página, WhatsApp, etc.
- `js/navigation.js` → `nav()` y el enlace «Saltar al contenido».
- `js/auth.js` → estado de sesión (`isLoggedIn`, `requireAuth`, `logout`).
- `js/validation.js` → validación de formularios en línea (`validarCampos`, `showFieldError`, `esCorreo`).
- `js/charts.js` → tooltip compartido por las gráficas del panel admin.
- `js/loader.js` → carga las vistas dentro de `#app`.

## Gráficas (panel admin)

Los SVG del panel usan la paleta categórica `--c1 … --c4` definida en `css/base/base.css`,
en **orden fijo** (el color identifica a la entidad, nunca su posición en el ranking).
Está validada para daltonismo y contraste sobre fondo claro; el rojo queda reservado
para estados (cancelado) y no se usa como color de serie. Las clases de las gráficas
(`.g-bar`, `.g-line`, `.g-grid`, …) viven en `css/views/admin-dashboard.css`: los SVG
no llevan colores escritos a mano.

## Cómo abrirlo

- **Desarrollo:** necesita un servidor local (Live Server de VS Code, o `python -m http.server` y abrir `http://localhost:8000`), porque cada vista se carga con `fetch`.
- **Un solo archivo:** `python build.py` genera `dist/tucket-app.html`, que abre con doble clic.

## Agregar una vista nueva

1. Crea `views/mi-vista.html` con `<div class="view" id="view-mi-vista"> … </div>`.
2. Agrega `"mi-vista"` a la lista `VIEWS` en `js/loader.js`.
3. (Opcional) `css/views/mi-vista.css` + su `<link>` en `index.html`.
4. Navega a ella con `nav('mi-vista')`.

> El orden de los `<link>` y `<script>` en `index.html` importa: es el mismo orden que tenía el CSS/JS original.
