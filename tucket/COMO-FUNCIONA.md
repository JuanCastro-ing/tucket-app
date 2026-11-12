# Cómo funciona TUCKET

Guía para entender el proyecto por dentro y poder explicarlo. No repite lo que
ya está en el [README](README.md) (estructura de carpetas) ni en
[backend/README.md](backend/README.md) (instalación y endpoints): aquí está el
**porqué** de las decisiones y el **recorrido** de los datos.

---

## 1. La idea en una frase

Es una **aplicación de una sola página**: el navegador carga `index.html` una
vez, y a partir de ahí nunca vuelve a recargar. Todas las pantallas ya están en
el documento, ocultas, y moverse entre ellas es mostrar una y esconder las demás.
Los datos los pide al servidor con `fetch`, y el servidor los saca de PostgreSQL.

```
Navegador                     Servidor (Node + Express)          Base de datos
─────────                     ─────────────────────────          ─────────────
index.html ──carga──► views/*.html
    │
    └── nav('events') ──► muestra #view-events
            │
            └── tucketApi('/api/events') ──► events.routes.js ──► SELECT ──► PostgreSQL (Neon)
                                                    │
                        ◄────────────── JSON ───────┘
```

## 2. Por qué una sola página

La alternativa era un archivo HTML por pantalla, con enlaces normales. Se
descartó porque cada clic recargaría todo —menú, estilos, sesión— y porque
compartir código entre pantallas obligaría a repetirlo.

El precio de esta decisión es que **todas las vistas conviven en el mismo
documento**, y de ahí salen dos reglas que hay que respetar:

- **Los `id` no se pueden repetir entre vistas.** Dos pantallas con un
  `id="total"` se pisan, y `getElementById` devuelve siempre el primero.
- **Lo que el HTML trae escrito se queda escrito.** Si una vista dice
  `AGENTE` en su cabecera y entra un cliente, hay que repintarlo con JavaScript.
  Eso lo hace `pintarPastillasDeRol()` en `js/auth.js`.

### Cómo se cargan las vistas

`js/loader.js` pide los once archivos de `views/` a la vez, sustituye los
marcadores de los parciales y lo inserta todo en `#app` de una sola vez:

```js
<div data-parcial="footer"></div>   →   el contenido de views/partials/footer.html
```

El pie de página estaba copiado tal cual en siete vistas. Un parcial lo deja en
un solo archivo: se cambia una vez y cambia en todas.

### El carrusel de la portada

Pasa solo cada 5 segundos, pero se detiene mientras el cursor está encima o el
foco está dentro, cuando la pestaña no se está viendo, y si el sistema operativo
pide reducir el movimiento. Un carrusel que cambia mientras alguien lee, o que
mueve el botón justo cuando van a pulsarlo, estorba más de lo que aporta.

### Cómo se cambia de pantalla

Todo pasa por `nav(viewId)` en `js/navigation.js`. Es **la única puerta**: no
hay enlaces que muestren una vista por su cuenta. Eso permite que el permiso se
compruebe en un solo punto:

```js
function nav(viewId){
  if(!canAccess(viewId)) return denyAccess(viewId);   // ← el control, una sola vez
  ...
}
```

`nav()` además apila la vista anterior, para que el botón «Volver» funcione, y
llama a la inicialización de la pantalla que abre (`initAgentEvents()`,
`initReservations()`, …).

---

## 3. Sesión y permisos

### Cómo se guarda la sesión

Al iniciar sesión, el servidor firma un **JWT** y lo manda en una cookie
`HttpOnly`. Esto importa y conviene saber explicarlo:

- **HttpOnly** significa que JavaScript no puede leerla. Si alguien lograra
  inyectar código en la página, no podría robar la sesión.
- El token va **firmado** con `JWT_SECRET`: el servidor no necesita guardar
  sesiones en la base, le basta con verificar la firma.
- Dentro del token va el rol, así que cada petición ya sabe quién la hace sin
  volver a consultar la base.

### Qué protege al servidor

| Qué | Dónde | Para qué |
|---|---|---|
| Cabeceras de seguridad | `backend/src/seguridad.js` | Le dicen al navegador qué permitir: nada de iframes ajenos, nada de adivinar tipos de archivo, y una política que impide cargar scripts de otros dominios |
| Límite de intentos | `backend/src/seguridad.js` | 8 fallos de login por IP cada 15 minutos. Sin esto, probar contraseñas a ciegas no cuesta nada |
| Correo único entre roles | `backend/src/correos.js` | El `UNIQUE` es por tabla; esto impide el mismo correo como cliente y como agente, que dejaría una de las dos cuentas inaccesible |

### Las dos barreras, y cuál es la de verdad

| Dónde | Qué hace | ¿Es segura? |
|---|---|---|
| `VIEW_ROLES` en `js/auth.js` | Evita que la interfaz muestre pantallas que no corresponden | **No.** Es comodidad: vive en el navegador y se puede saltar |
| `requireAgent`, `requireClient`, `requireAdmin` en `backend/src/auth.js` | Rechazan la petición antes de tocar la base | **Sí.** Es la barrera real |

Si en la sustentación preguntan «¿y si alguien edita el JavaScript para entrar
al panel de administrador?», la respuesta es: puede ver el cascarón vacío, pero
`GET /api/admin/stats` le responde 403 y no obtiene ni un dato.

### Que el agente solo vea lo suyo

No se filtra en el navegador. El filtro está dentro de la consulta:

```sql
JOIN eventos e ON e.id = r.id_evento AND e.id_agente = $1
```

Con el `agent_id` saliendo de la cookie firmada, no de algo que mande el
navegador. Un agente no puede ver las reservas de otro ni cambiándole el
número a la URL.

---

## 4. Modelo relacional

```
paises(codigo PK, nombre)
departamentos(codigo PK, codigo_pais FK, nombre)
ciudades(id PK, codigo_dane, codigo_pais FK, codigo_departamento FK, nombre)

agentes(id PK, nombre_completo, correo, clave_hash, activo, fecha_creacion,
       telefono, telefono_alterno, direccion, codigo_pais FK, codigo_departamento FK, id_ciudad FK, fecha_actualizacion)

clientes(id PK, tipo_documento, numero_documento, nombre_completo, correo, clave_hash,
        telefono, direccion, codigo_pais FK, codigo_departamento FK, id_ciudad FK,
        acepto_terminos, activo, fecha_creacion, telefono_alterno, fecha_actualizacion)

administradores(id PK, nombre_completo, correo, clave_hash, activo, fecha_creacion, fecha_actualizacion)

eventos(id PK, codigo, nombre, descripcion, teatro, fecha_inicio, fecha_fin, capacidad_total,
       precio_base, observaciones, ruta_imagen, texto_imagen, ruta_banner, texto_banner,
       estado, motivo_cancelacion, fecha_cambio_estado,
       codigo_pais FK, codigo_departamento FK, id_ciudad FK, id_agente FK, fecha_creacion)

reservas(id PK, codigo, id_cliente FK, id_evento FK, cantidad, precio_unitario,
             valor_total, estado, motivo_cancelacion, observaciones,
             fecha_creacion, fecha_cambio_estado)

boletas(id PK, id_reserva FK, serial, nombre_titular, silla, fecha_uso, fecha_creacion)

solicitudes_agente(id PK, nombre_completo, numero_documento, correo, telefono, organizacion, nit,
               justificacion, estado, notas_revision, revisado_por FK, fecha_revision,
               id_agente FK, fecha_creacion)
```

```
estados_evento(codigo PK, etiqueta, orden, permite_reservar, es_final,
               exige_motivo, permitido_al_crear, clase_insignia)
estados_reserva(codigo PK, etiqueta, orden, ocupa_silla, es_final, clase_insignia)
estados_solicitud(codigo PK, etiqueta, orden, es_final, clase_insignia)

metodos_pago(codigo PK, etiqueta, orden, requiere_tarjeta, inmediato, activo)
estados_pago(codigo PK, etiqueta, orden, es_pagado, es_final, clase_insignia)
pagos(id PK, codigo, id_reserva FK, codigo_metodo FK, estado FK, monto,
         referencia, ultimos4_tarjeta, marca_tarjeta, motivo_rechazo, fecha_pago, fecha_creacion)
```

Más la vista `event_availability`, que calcula cuántas butacas quedan libres.

### Tres decisiones del modelo que vale la pena poder defender

**Los tres roles viven en tablas separadas** (`clientes`, `agentes`, `administradores`) y no
en una sola tabla con una columna `rol`. Porque guardan cosas distintas: un
cliente tiene documento de identidad y acepta términos, un agente no; un
administrador no necesita ni teléfono ni dirección. Con una sola tabla, la mitad
de las columnas estarían siempre vacías.

**La ubicación se valida con una clave foránea compuesta.** La ciudad no basta:
hay que asegurar que la ciudad pertenezca al departamento, y el departamento al
país. Por eso:

```sql
FOREIGN KEY (id_ciudad, codigo_departamento, codigo_pais)
  REFERENCES ciudades(id, codigo_departamento, codigo_pais)
```

Así la base rechaza «Cali, Antioquia» aunque la API tuviera un error.

**Los estados son tablas, no cadenas sueltas.** Antes cada estado era un
texto validado con un `CHECK`, y lo que significaba estaba repartido por el
código: un `Set` decía en qué estados se puede reservar, otro cuáles cierran
el ciclo, y un objeto en JavaScript daba el color de cada etiqueta. Agregar
un estado obligaba a tocar seis sitios y olvidar uno fallaba en silencio.

Ahora cada estado es una fila con su comportamiento al lado, y las columnas
son las que mandan: `allows_reservation` decide si se puede reservar,
`is_final` si el ciclo está cerrado, `occupies_seat` si esa reserva ocupa
butaca —lo usan la vista de disponibilidad y el disparador que impide
sobrevender—, `allowed_as_initial` con qué estado puede nacer un evento, y
`badge_class` de qué color se pinta.

La clave primaria es el propio texto (`'En Boletería'`), no un número: así
no hubo que migrar ni una fila, mostrar el estado no exige un JOIN, y la
integridad la garantiza una clave foránea igual que antes el `CHECK`.

Está probado: se insertó un estado «Aplazado» en la base, se reinició el
servidor, y apareció solo en los desplegables, con su color y respetando su
regla de no admitir reservas. Sin tocar una línea de código.

**El pago es una simulación, y se nota a propósito.** Tucket no cobra
dinero: no hay pasarela ni cuenta de comercio. La pantalla de pago lleva un
aviso permanente, el comprobante dice «documento de simulación · sin validez
fiscal», y solo se aprueban números de tarjeta de prueba conocidos. Una
tarjeta real bien formada se **rechaza** a propósito, para que nadie vea un
«Aprobado» y crea que le cobraron.

De la tarjeta no se guarda nada salvo los cuatro últimos dígitos y la marca,
que es lo que imprime cualquier recibo. El número, el vencimiento y el código
de seguridad se validan en el servidor y se descartan; nunca llegan a la base.

Quien confirma la reserva es la base, no la API: un disparador la pasa a
Confirmada cuando el pago queda aprobado. Así no puede existir un pago
aprobado con la reserva sin confirmar, ni aunque alguien escriba directamente
en la tabla desde pgAdmin. Y un índice único parcial impide dos pagos
aprobados sobre la misma reserva, mientras deja acumular los rechazados: ese
historial de intentos explica por qué el cliente volvió a probar.

**Las reglas de negocio están en la base, no solo en la API.** Un trigger impide
sobrevender un evento, un `CHECK` obliga a registrar la causa al cancelar, y
otro verifica que `total_amount = unit_price × quantity`. Si alguien escribiera
directo en la base desde la consola de Neon, las reglas seguirían valiendo.

---

## 5. Tres recorridos completos

Conviene tener uno de estos listo para explicar en vivo.

### Un cliente reserva entradas

1. En `event-detail.html` pulsa `+`. `changeQty()` (`js/event-detail.js`)
   recalcula el total en pantalla. Todavía no se ha hablado con el servidor.
2. Pulsa «Confirmar reserva» → `confirmarReserva()` llama
   `POST /api/reservations` con el código del evento y la cantidad.
3. `reservations.routes.js` abre una transacción, bloquea la fila del evento con
   `SELECT ... FOR UPDATE`, comprueba disponibilidad, inserta la reserva y genera
   una boleta por entrada.
4. El trigger `reservations_capacity_guard` vuelve a comprobar el cupo dentro de
   la base. Si dos clientes reservan a la vez las últimas entradas, el bloqueo y
   el trigger impiden la sobreventa.
5. Vuelve el JSON y la interfaz navega a «Mis reservas».

**El punto interesante**: por qué el bloqueo. Sin `FOR UPDATE`, dos peticiones
simultáneas leerían «quedan 2 libres» las dos, y las dos insertarían.

### Un agente publica un evento

1. El formulario pide el próximo código a `GET /api/events/next-code`, solo para
   mostrarlo. El definitivo se asigna al guardar.
2. Al enviar, la imagen viaja en base64 dentro del JSON.
3. `events.routes.js` valida, pide un código a la secuencia de PostgreSQL
   (`nextval`), guarda la imagen y hace el `INSERT`.

**El punto interesante**: el código lo da una secuencia de la base y no el
agente. Antes se escribía a mano y dos agentes podían chocar; ahora `nextval`
garantiza que nunca entrega el mismo número dos veces, ni aunque guarden en el
mismo instante.

### Alguien pide una cuenta de agente

1. Cualquiera envía el formulario → `POST /api/agent-requests`. Un índice parcial
   impide dos solicitudes pendientes del mismo correo.
2. El administrador la ve en su panel y la aprueba → la API crea la cuenta de
   agente dentro de una transacción y devuelve **una sola vez** una contraseña
   temporal.
3. Si la rechaza, debe escribir un motivo de entre 10 y 500 caracteres; lo exige
   un `CHECK` de la base.

---

## 6. Dónde se guardan los afiches

Es la parte con más historia detrás y suele dar pie a preguntas.

| Dónde corre | Dónde van las imágenes |
|---|---|
| En el computador de alguien del equipo | Archivos en `backend/uploads/events/` |
| Publicado (Render) | **Cloudinary**, y en la base queda la URL |

Lo decide `hayCloudinary()` en `backend/src/images.js`: si están las tres
variables de entorno de Cloudinary, se sube allí; si no, al disco. El mismo
código sirve en los dos sitios y nadie del equipo necesita crear una cuenta para
trabajar en su máquina.

**Por qué no quedarse con el disco**: los servicios de despliegue le dan al
programa un disco nuevo y vacío cada vez que se publica una versión. Lo que
hubieran subido los agentes desaparecería y los eventos quedarían apuntando a
archivos inexistentes.

**Por qué no meterlas en la base de datos**: se puede, y es lo que hacen muchos
proyectos de clase, pero infla la base y hace más lenta cada consulta. El
almacenamiento de objetos (Cloudinary, S3, R2) es la respuesta estándar para
archivos subidos por usuarios.

---

## 7. Cosas que parecen errores y no lo son

| Lo que se ve | Qué pasa |
|---|---|
| La primera visita del día tarda ~50 segundos | El plan gratuito de Render apaga el servicio sin visitas y tiene que despertar |
| La primera consulta a la base tarda unos segundos | Neon suspende el proyecto sin tráfico; despierta sola |
| Un aviso naranja sobre `sslmode` en los registros | La librería de PostgreSQL anuncia un cambio futuro. La conexión funciona |
| Un evento aparece «Finalizado» sin que nadie lo tocara | El estado se calcula con la hora del servidor: si la fecha ya pasó, se muestra finalizado |
| La cartelera sale vacía al abrir `dist/tucket-app.html` | Ese archivo es solo el diseño; no puede hablar con la base de datos |

---

## 8. Si hay que tocar algo

| Quiero… | Voy a… |
|---|---|
| Cambiar un texto o enlace del pie | `views/partials/footer.html` (uno solo para todas) |
| Cambiar la ayuda, las preguntas frecuentes o lo legal | `views/ayuda.html` |
| Cambiar cada cuánto pasa el carrusel | `HERO_INTERVALO` en `js/hero-slider.js` |
| Cambiar los intentos de login permitidos | La llamada a `limitarIntentos()` en `backend/src/server.js` |
| Añadir un campo con ubicación | `montarUbicacion()` de `js/geo-selects.js` |
| Cambiar colores, sombras o tipografías | `css/base/base.css` (están como variables) |
| Agregar un campo a un evento | `backend/db/03-eventos.sql`, luego la ruta en `events.routes.js` y el formulario en `views/agent-events.html` |
| Ver qué hace cada agente | La tabla «Agentes registrados» del panel administrativo |
| Agregar un método de pago | Un `INSERT` en `payment_methods`. Nada de código |
| Agregar o cambiar un estado | Un `INSERT` o `UPDATE` en `event_statuses` (o las otras dos). Nada de código |
| Cambiar quién entra a una pantalla | `VIEW_ROLES` en `js/auth.js` **y** el guardia de la ruta en el backend |
| Agregar una pantalla | Ver el final del [README](README.md) |

Al tocar el esquema: los archivos de `backend/db/` se ejecutan en orden numérico
y deben poder repetirse sin romper nada (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`). Por eso `npm run db:setup` se puede correr las veces
que haga falta.
