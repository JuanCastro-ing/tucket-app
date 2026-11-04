/* Afiches de los eventos.

   El navegador manda la imagen como base64 dentro del JSON (FileReader →
   dataURL). En la base de datos nunca se guarda el binario, solo la
   dirección con la que el navegador pide la imagen: meter archivos en una
   tabla la infla y hace más lenta cada consulta del catálogo.

   Dónde queda el archivo depende de dónde esté corriendo el proyecto:

   · EN EL COMPUTADOR, se escribe en backend/uploads/events/ y el propio
     servidor lo entrega como archivo estático. No hace falta configurar
     nada ni tener cuenta en ningún lado.

   · PUBLICADO, se sube a Cloudinary y en la base queda su URL. Hace falta
     porque los servicios de despliegue (Render, Railway y casi todos en
     su plan gratuito) reconstruyen el servidor en cada publicación con un
     disco nuevo y vacío: lo que los agentes hubieran subido desaparece y
     los eventos quedan apuntando a archivos que ya no existen. Cloudinary
     es almacenamiento de objetos, que es donde van los archivos subidos
     por usuarios en cualquier sistema real.

   El modo se elige solo: si están las tres variables de Cloudinary en el
   entorno, se usa Cloudinary; si no, el disco. Así el mismo código sirve
   en los dos sitios y nadie del equipo necesita crear una cuenta para
   trabajar en su máquina.

   No se usa multer ni el SDK de Cloudinary: alcanza con fs, Buffer y el
   fetch que ya trae Node. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIRECTORIO = path.join(__dirname, '..', 'uploads', 'events');
const RUTA_PUBLICA = '/uploads/events';
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB ya decodificados

/* ------------------------------------------------------------------
   Cloudinary
------------------------------------------------------------------ */
const CARPETA_REMOTA = 'tucket/events';
const ESPERA_SUBIDA = 25_000;   // ms antes de darse por vencido

function configuracionCloudinary() {
  return {
    cloud: String(process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
    apiKey: String(process.env.CLOUDINARY_API_KEY || '').trim(),
    apiSecret: String(process.env.CLOUDINARY_API_SECRET || '').trim(),
    /* Solo para las pruebas automáticas, que levantan un Cloudinary
       falso: en condiciones normales no se define y se usa el real. */
    base: String(process.env.CLOUDINARY_API_BASE || 'https://api.cloudinary.com').trim()
  };
}

function hayCloudinary() {
  const c = configuracionCloudinary();
  return Boolean(c.cloud && c.apiKey && c.apiSecret);
}

/* Cloudinary exige firmar la petición: se concatenan los parámetros en
   orden alfabético y se les aplica SHA-1 junto con el api_secret. El
   secreto nunca viaja, solo la firma. */
function firmar(parametros, apiSecret) {
  const texto = Object.keys(parametros).sort()
    .map((clave) => `${clave}=${parametros[clave]}`)
    .join('&');
  return crypto.createHash('sha1').update(texto + apiSecret).digest('hex');
}

class ErrorDeAlmacenamiento extends Error {}

async function subirACloudinary(binario, mime, nombre) {
  const c = configuracionCloudinary();
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${CARPETA_REMOTA}/${nombre}`;
  const firma = firmar({ public_id: publicId, timestamp }, c.apiSecret);

  const formulario = new FormData();
  formulario.append('file', `data:${mime};base64,${binario.toString('base64')}`);
  formulario.append('api_key', c.apiKey);
  formulario.append('timestamp', String(timestamp));
  formulario.append('public_id', publicId);
  formulario.append('signature', firma);

  let respuesta;
  try {
    respuesta = await fetch(`${c.base}/v1_1/${c.cloud}/image/upload`, {
      method: 'POST',
      body: formulario,
      signal: AbortSignal.timeout(ESPERA_SUBIDA)
    });
  } catch {
    throw new ErrorDeAlmacenamiento('No se pudo contactar con el servicio de imágenes. Intenta de nuevo en un momento.');
  }

  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !datos?.secure_url) {
    /* El mensaje de Cloudinary se registra para quien revise los logs,
       pero al agente se le responde algo que pueda entender. */
    console.error('Cloudinary rechazó la subida:', datos?.error?.message || respuesta.status);
    throw new ErrorDeAlmacenamiento('El servicio de imágenes rechazó el archivo. Intenta con otra imagen.');
  }

  return { rutaPublica: datos.secure_url, bytes: binario.length, mime };
}

/* De la URL se deduce el identificador que Cloudinary necesita para
   borrar. Una URL suya se ve así:
     https://res.cloudinary.com/<cuenta>/image/upload/v1699/tucket/events/abc.jpg
   y el identificador es todo lo que va después de la versión, sin la
   extensión: tucket/events/abc */
function identificadorRemoto(url) {
  const texto = String(url || '');
  if (!/^https?:\/\/res\.cloudinary\.com\//.test(texto)) return null;
  const partes = texto.split('/image/upload/')[1];
  if (!partes) return null;
  const sinVersion = partes.replace(/^v\d+\//, '');
  const sinExtension = sinVersion.replace(/\.[a-z0-9]+$/i, '');
  return sinExtension.startsWith(`${CARPETA_REMOTA}/`) ? sinExtension : null;
}

async function borrarDeCloudinary(url) {
  const publicId = identificadorRemoto(url);
  if (!publicId || !hayCloudinary()) return;
  const c = configuracionCloudinary();
  const timestamp = Math.floor(Date.now() / 1000);
  const firma = firmar({ public_id: publicId, timestamp }, c.apiSecret);

  const formulario = new FormData();
  formulario.append('public_id', publicId);
  formulario.append('api_key', c.apiKey);
  formulario.append('timestamp', String(timestamp));
  formulario.append('signature', firma);

  try {
    await fetch(`${c.base}/v1_1/${c.cloud}/image/destroy`, {
      method: 'POST', body: formulario, signal: AbortSignal.timeout(ESPERA_SUBIDA)
    });
  } catch { /* Una imagen huérfana es menos grave que tumbar la petición. */ }
}

/* Formatos admitidos y su firma binaria. Se verifica el contenido real del
   archivo y no el tipo que declara el navegador, que es falsificable. */
const FORMATOS = [
  { ext: 'jpg',  mime: 'image/jpeg', firma: (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { ext: 'png',  mime: 'image/png',  firma: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) },
  { ext: 'webp', mime: 'image/webp', firma: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' }
];

class ImagenInvalida extends Error {}

/* Acepta "data:image/jpeg;base64,/9j/4AA…" o el base64 pelado. */
function decodificar(entrada) {
  const texto = String(entrada || '').trim();
  if (!texto) throw new ImagenInvalida('No llegó ninguna imagen.');

  const dataUrl = /^data:([\w/+.-]+);base64,(.*)$/s.exec(texto);
  const base64 = (dataUrl ? dataUrl[2] : texto).replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new ImagenInvalida('La imagen no llegó en un formato que podamos leer.');
  }
  /* Se estima el tamaño antes de reservar memoria. */
  if ((base64.length * 3) / 4 > MAX_BYTES + 1024) {
    throw new ImagenInvalida('La imagen supera los 4 MB. Usa una más liviana.');
  }

  const binario = Buffer.from(base64, 'base64');
  if (binario.length < 64) throw new ImagenInvalida('El archivo está vacío o dañado.');
  if (binario.length > MAX_BYTES) throw new ImagenInvalida('La imagen supera los 4 MB. Usa una más liviana.');

  const formato = FORMATOS.find((f) => f.firma(binario));
  if (!formato) throw new ImagenInvalida('Solo se admiten imágenes JPG, PNG o WEBP.');

  return { binario, formato };
}

/* Guarda el afiche y devuelve la dirección pública que va a la base de
   datos. Es asíncrona porque subir a Cloudinary lo es; cuando guarda en
   disco termina igual de rápido que antes. */
async function guardarAfiche(entrada, codigoEvento) {
  const { binario, formato } = decodificar(entrada);

  const base = String(codigoEvento || 'evento').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'evento';
  const nombre = `${base}-${crypto.randomBytes(6).toString('hex')}`;

  if (hayCloudinary()) {
    return subirACloudinary(binario, formato.mime, nombre);
  }

  fs.mkdirSync(DIRECTORIO, { recursive: true });
  const archivo = `${nombre}.${formato.ext}`;
  fs.writeFileSync(path.join(DIRECTORIO, archivo), binario);
  return { rutaPublica: `${RUTA_PUBLICA}/${archivo}`, bytes: binario.length, mime: formato.mime };
}

/* Borra un afiche anterior, esté donde esté. Nunca lanza: perder un
   archivo huérfano es menos grave que tumbar la petición que ya
   actualizó la base.

   No se espera a que termine (quien llama no hace await), así que el
   .catch es obligatorio: sin él, un fallo al borrar quedaría como una
   promesa rechazada sin atender y Node tumbaría el proceso. */
function borrarAfiche(rutaPublica) {
  if (!rutaPublica) return;
  const ruta = String(rutaPublica);

  if (identificadorRemoto(ruta)) {
    borrarDeCloudinary(ruta).catch(() => {});
    return;
  }

  if (!ruta.startsWith(`${RUTA_PUBLICA}/`)) return;
  const nombre = path.basename(ruta);
  try {
    fs.unlinkSync(path.join(DIRECTORIO, nombre));
  } catch { /* ya no estaba */ }
}

/* Texto alternativo: obligatorio para accesibilidad cuando hay imagen. */
function normalizarAlt(valor, nombreEvento) {
  const texto = String(valor || '').trim().slice(0, 200);
  return texto || `Afiche del evento ${String(nombreEvento || '').trim()}`.slice(0, 200);
}

module.exports = {
  guardarAfiche, borrarAfiche, normalizarAlt,
  ImagenInvalida, ErrorDeAlmacenamiento, hayCloudinary,
  DIRECTORIO, RUTA_PUBLICA, MAX_BYTES
};
