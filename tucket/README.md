# TUCKET

Sistema web de publicación y reserva de eventos: conciertos, teatro, festivales
y comedia. Proyecto integrador de Programación en Ambiente Web I, UCEVA.

Tres tipos de cuenta:

| Rol | Qué hace |
|---|---|
| **Cliente** | Explora la cartelera, reserva entradas y gestiona sus reservas |
| **Agente** | Publica eventos, los edita, controla su estado y ve las reservas que recibe |
| **Administrador** | Aprueba las solicitudes de cuenta de agente y consulta los reportes del sistema |

---

## Arrancar el proyecto

Hacen falta dos cosas a la vez: el **servidor** (Node) y la **base de datos**
(PostgreSQL en Neon). El servidor sirve también las páginas, así que no hay que
levantar nada más.

```bash
cd backend
npm install
cp .env.example .env      # y completa DATABASE_URL y JWT_SECRET
npm run db:setup          # crea las tablas y carga los municipios
npm start                 # http://localhost:8000
```

El detalle de cada paso, cómo sacar la cadena de Neon y qué hacer si algo falla
está en **[backend/README.md](backend/README.md)**.

Para entender cómo está construido por dentro —y poder explicarlo— está
**[COMO-FUNCIONA.md](COMO-FUNCIONA.md)**.

---

## Estructura

```
tucket/
├── index.html              Única página real: carga el CSS, el JS y las vistas
├── views/                  Una vista = una pantalla
│   ├── partials/           Trozos de HTML compartidos (el pie de página)
│   └── *.html
├── css/
│   ├── base/               Variables de color, reset, mostrar/ocultar vistas
│   ├── components/         Piezas reutilizables: botones, tablas, formularios…
│   └── views/              Estilos propios de cada pantalla
├── js/                     Un archivo por pantalla, más los compartidos
├── img/events/             Afiches de los eventos de ejemplo
├── build.py                Genera dist/tucket-app.html (un solo archivo)
├── tools/                  Utilidades de desarrollo (generador de afiches)
└── backend/                Servidor Node + Express y la base de datos
    ├── src/
    │   ├── server.js       Arma la aplicación y monta las rutas
    │   ├── db.js           Conexión a PostgreSQL
    │   ├── auth.js         Sesión (JWT en cookie) y guardias por rol
    │   ├── images.js       Afiches: a Cloudinary o a disco
    │   └── routes/         Un archivo por área de la API
    ├── db/                 Esquema SQL, numerado por orden de creación
    └── scripts/            Puesta en marcha y mantenimiento
```

### Dónde está cada pantalla

| Pantalla | Vista | Estilos | Lógica |
|---|---|---|---|
| Inicio | `home.html` | `home.css` | `hero-slider.js`, `home-stats.js` |
| Inicio de sesión | `login.html` | `login.css` | `login.js` |
| Registro de cliente | `register.html` | `register.css` | `register.js`, `geo-selects.js` |
| Solicitud de agente | `agent-request.html` | `agent-request.css` | `agent-request.js` |
| Cartelera | `events.html` | `events.css` | `events.js` |
| Detalle de evento | `event-detail.html` | `event-detail.css` | `event-detail.js`, `events.js` |
| Mis reservas (cliente) | `reservations.html` | `reservations.css` | `reservations.js` |
| Mi perfil | `profile.html` | `profile.css` | `profile.js`, `profile-password.js` |
| Centro de ayuda | `ayuda.html` | `ayuda.css` | — (enlaces del pie, vía `irAAyuda()`) |
| Eventos (agente) | `agent-events.html` | `agent-events.css` | `agent-events.js` |
| Reservas (agente) | `agent-reservations.html` | `agent-reservations.css` | `agent-reservations.js` |
| Panel administrativo | `admin-dashboard.html` | `admin-dashboard.css` | `admin-dashboard.js`, `admin-stats.js` |

### Compartido entre pantallas

| Archivo | Para qué |
|---|---|
| `js/loader.js` | Carga las vistas y los parciales dentro de `#app` |
| `js/navigation.js` | `nav()`, el botón «Volver» y el enlace «Saltar al contenido» |
| `js/rutas.js` | Escribe la vista en la URL: recargar vuelve a ella y las flechas del navegador funcionan |
| `js/auth.js` | Estado de la sesión, permisos por rol, `logout()` |
| `js/api.js` | `tucketApi()`: todas las llamadas al servidor pasan por aquí |
| `js/validation.js` | Validación de formularios en línea |
| `js/estados.js` | Catálogo de estados: desplegables, colores y reglas, desde la base |
| `js/geo-selects.js` | Selector país → departamento → ciudad, con datos de la base |
| `js/home-featured.js` | Rellena las rejillas de eventos y el filtro de ciudades de la portada |
| `js/charts.js` | Tooltip compartido por las gráficas del panel |
| `css/components/cinta.css` | La cinta dorada y las facetas que encabezan las páginas |
| `css/base/` | Variables de diseño, reset y el mostrar/ocultar de vistas |
| `css/components/` | Botones, formularios, tablas, tickets, pie de página… |

---

## Cómo abrirlo

**Con el servidor** (lo normal): `npm start` en `backend/` y entrar a
`http://localhost:8000`. Hace falta un servidor porque cada vista se carga con
`fetch`, y también porque sin él no hay API ni base de datos.

**Un solo archivo**: `python build.py` genera `dist/tucket-app.html`, que abre
con doble clic. Sirve para ver el diseño sin levantar nada, pero no puede hablar
con la base de datos, así que la cartelera aparece vacía.

> `dist/` no se versiona a propósito. Es una copia de la aplicación y, si se
> subiera al repositorio, el servidor acabaría publicando dos versiones de la
> misma página. Quien lo necesite lo genera.

---

## Agregar una pantalla nueva

1. Crea `views/mi-vista.html` envuelta en `<div class="view" id="view-mi-vista">`.
2. Agrega `"mi-vista"` a la lista `VIEWS` de `js/loader.js`.
3. Si lleva estilos propios: `css/views/mi-vista.css` y su `<link>` en `index.html`.
4. Si debe ser privada, añádela a `VIEW_ROLES` en `js/auth.js`.
5. Navega a ella con `nav('mi-vista')`.

El orden de los `<link>` y `<script>` en `index.html` importa: es el orden en
que se cargan y algunos archivos dependen de otros.
