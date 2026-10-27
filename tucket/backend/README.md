# TUCKET — Backend y base de datos

API en Node + Express sobre **PostgreSQL alojado en Neon**.

## 1. Crear la base en Neon

1. Entra a <https://neon.com> y crea una cuenta (el plan gratuito alcanza de sobra).
2. **Create project**: nombre `tucket`, región la más cercana (`AWS us-east-2` para Colombia).
3. En el proyecto, botón **Connect** → pestaña **Connection string** → elige
   **Pooled connection** y marca **Node.js**.
4. Copia la cadena. Se ve así:

   ```
   postgresql://tucket_owner:npg_XXXXXXXX@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/tucket?sslmode=require
   ```

> **Pooled** (la que dice `-pooler`) y no la directa: Neon limita las conexiones
> directas, y el pool de `pg` abre varias. Con la directa se cae bajo carga.

## 2. Configurar el proyecto

```bash
cd backend
cp .env.example .env
```

Edita `backend/.env`:

```env
PORT=8000
DATABASE_URL=   # ← pega aquí la cadena de Neon, completa, con ?sslmode=require
JWT_SECRET=     # ← genera uno con el comando de abajo
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

El TLS no se configura a mano: `src/db.js` detecta que el host es de Neon y
activa el cifrado solo.

## 3. Instalar y arrancar

```bash
npm install
npm run setup    # hace todo: conecta, crea las tablas, el agente y los eventos
npm start        # http://localhost:8000
```

`npm run setup` verifica la conexión y explica el fallo si algo está mal, instala
el esquema, carga los 1.122 municipios del DANE, pide los datos del primer agente
(solo si todavía no hay ninguno) y carga los 7 eventos de ejemplo con sus afiches.
Es idempotente: se puede repetir sin borrar nada.

Si prefieres ir paso a paso:

| Comando | Qué hace |
|---|---|
| `npm run db:check` | Solo prueba la conexión y diagnostica el problema |
| `npm run db:setup` | Crea las tablas y carga la geografía |
| `npm run agent:create` | Crea una cuenta de agente |
| `npm run db:seed` | Carga los 7 eventos de ejemplo |
| `npm run agent:check` | Lista los agentes registrados |

Para comprobar la conexión con el servidor arriba: <http://localhost:8000/api/health>
debe responder `{"status":"ok","database":"connected","host":"neon"}`.

## 4. Estructura

```
backend/
├── db/                        Esquema SQL, un archivo por módulo
│   ├── 01-geografia.sql       countries · departments · cities
│   ├── 02-agentes.sql         agents
│   ├── 03-eventos.sql         events (incluye el afiche)
│   ├── 04-clientes.sql        clients
│   ├── 05-reservas.sql        reservations · tickets · vista y triggers
│   └── colombia-divipola.json Catálogo DANE
├── scripts/
│   ├── bootstrap.js           npm run setup: la puesta en marcha completa
│   ├── diagnostico.js         Prueba la conexión y traduce los errores
│   ├── setup-db.js            Instala el esquema y carga la geografía
│   ├── seed-events.js         Carga los 7 eventos de ejemplo
│   ├── create-agent.js        Crea una cuenta de agente
│   └── check-agents.js        Lista los agentes registrados
├── src/
│   ├── server.js              Solo arma la app y monta los routers
│   ├── db.js                  Pool de PostgreSQL (detecta Neon y TLS)
│   ├── auth.js                Sesión JWT en cookie + guardias de rol
│   ├── images.js              Afiches: validación y guardado en disco
│   └── routes/
│       ├── auth.routes.js         /api/auth
│       ├── geography.routes.js    /api/geography
│       ├── events.routes.js       /api/events
│       ├── clients.routes.js      /api/clients
│       └── reservations.routes.js /api/reservations
└── uploads/events/            Afiches subidos por los agentes (no va al repo)
```

## 5. Modelo relacional

```
countries(code PK, name)
departments(code PK, country_code FK, name)
cities(id PK, dane_code, country_code FK, department_code FK, name)
agents(id PK, full_name, email, password_hash, active, created_at)
clients(id PK, document_type, document_number, full_name, email, password_hash, phone, address, country_code FK, department_code FK, city_id FK, accepted_terms, active, created_at)
events(id PK, code, name, description, venue, starts_at, ends_at, total_capacity, base_price, observations, image_path, image_alt, status, cancellation_reason, status_updated_at, country_code FK, department_code FK, city_id FK, agent_id FK, created_at)
reservations(id PK, code, client_id FK, event_id FK, quantity, unit_price, total_amount, status, cancellation_reason, created_at, status_updated_at)
tickets(id PK, reservation_id FK, serial, holder_name, seat_label, used_at, created_at)
```

Vista `event_availability(event_id, event_code, total_capacity, reserved_seats, available_seats)`.

Reglas que vive la base, no solo la API:

| Regla | Dónde |
|---|---|
| La ciudad debe pertenecer al departamento y país indicados | FK compuesta `events_city_matches_location` (y la misma en `clients`) |
| Fin posterior al inicio | `events_end_after_start` |
| Cancelar un evento exige motivo de 10 a 500 caracteres | `events_cancel_reason` |
| `total_amount = unit_price × quantity` | `reservations_total_matches` |
| No se puede sobrevender un evento | Trigger `reservations_capacity_guard` |
| Las reservas canceladas liberan el cupo | Vista `event_availability` |

## 6. API

| Método y ruta | Quién | Para qué |
|---|---|---|
| `GET /api/health` | — | Estado de la conexión |
| `POST /api/auth/login` | — | Inicia sesión (agente o cliente) |
| `POST /api/auth/logout` | — | Cierra sesión |
| `GET /api/auth/me` | sesión | Quién soy y con qué rol |
| `GET /api/geography/...` | — | Países, departamentos, ciudades |
| `GET /api/events` | — | Catálogo con afiche y disponibilidad |
| `GET /api/events/:code` | — | Detalle de un evento |
| `GET /api/events/mine` | agente | Mis eventos |
| `POST /api/events` | agente | Crear evento (afiche opcional) |
| `PUT /api/events/:code/image` | agente | Cambiar o quitar el afiche |
| `PATCH /api/events/:code/status` | agente | Ciclo de vida del evento |
| `GET /api/events/:code/reservations` | agente | Reservas de mi evento |
| `POST /api/clients/register` | — | Registro de cliente |
| `GET /api/clients/me` | cliente | Mis datos |
| `POST /api/reservations` | cliente | Reservar entradas |
| `GET /api/reservations/mine` | cliente | Mis reservas |
| `GET /api/reservations/:code` | cliente | Detalle con las boletas |
| `PATCH /api/reservations/:code/cancel` | cliente | Cancelar una reserva |

## 7. Afiches

El navegador lee el archivo y lo manda en base64 dentro del JSON:

```json
{ "code": "EVT-2026-01", "name": "…",
  "image": { "data": "data:image/jpeg;base64,/9j/4AA…", "alt": "Afiche del evento" } }
```

El servidor valida la **firma binaria** del archivo (no el tipo que declara el
navegador, que se puede falsificar), acepta JPG, PNG y WEBP de hasta 4 MB, lo
guarda en `backend/uploads/events/` con un nombre aleatorio y deja en la base
solo la ruta (`image_path`). Los binarios no entran a la base: en Neon se paga
por almacenamiento y transferencia, y cada consulta del catálogo se volvería lenta.

Los 7 afiches de los eventos de ejemplo están en `img/events/` y se regeneran con:

```bash
python3 tools/generar-afiches.py
```

## 8. Si algo falla

| Síntoma | Causa | Solución |
|---|---|---|
| `Falta DATABASE_URL` | No existe `backend/.env` | `cp .env.example .env` y pega la cadena |
| `password authentication failed` | Cadena incompleta o clave rotada | Vuelve a copiarla desde Neon |
| `no pg_hba.conf entry … SSL off` | Falta `?sslmode=require` | Agrégalo al final de la cadena |
| `too many connections` | Estás usando la cadena directa | Usa la **pooled** (`-pooler`) |
| La primera petición tarda ~5 s | Neon suspende el proyecto sin tráfico | Normal: despierta sola |
| `Configura JWT_SECRET…` | Sigue el valor de ejemplo | Genera uno con el comando de arriba |
