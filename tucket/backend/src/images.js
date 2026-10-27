/* Afiches de los eventos.

   El navegador manda la imagen como base64 dentro del JSON (FileReader →
   dataURL). Se guarda como archivo en backend/uploads/events/ y en la base
   solo queda la ruta pública. Dos razones:
     · Neon cobra almacenamiento y transferencia: meter binarios en la tabla
       la infla y hace lenta cada consulta del catálogo.
     · Un archivo estático lo sirve y lo cachea el servidor web sin tocar
       PostgreSQL.
   No se usa multer ni ninguna dependencia extra: alcanza con fs y Buffer. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIRECTORIO = path.join(__dirname, '..', 'uploads', 'events');
const RUTA_PUBLICA = '/uploads/events';
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB ya decodificados

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

/* Guarda el afiche y devuelve la ruta pública que va a la base de datos. */
function guardarAfiche(entrada, codigoEvento) {
  const { binario, formato } = decodificar(entrada);
  fs.mkdirSync(DIRECTORIO, { recursive: true });

  const base = String(codigoEvento || 'evento').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'evento';
  const nombre = `${base}-${crypto.randomBytes(6).toString('hex')}.${formato.ext}`;
  fs.writeFileSync(path.join(DIRECTORIO, nombre), binario);

  return { rutaPublica: `${RUTA_PUBLICA}/${nombre}`, bytes: binario.length, mime: formato.mime };
}

/* Borra un afiche anterior. Nunca lanza: perder un archivo huérfano es
   menos grave que tumbar la petición que ya actualizó la base. */
function borrarAfiche(rutaPublica) {
  if (!rutaPublica || !String(rutaPublica).startsWith(`${RUTA_PUBLICA}/`)) return;
  const nombre = path.basename(String(rutaPublica));
  try {
    fs.unlinkSync(path.join(DIRECTORIO, nombre));
  } catch { /* ya no estaba */ }
}

/* Texto alternativo: obligatorio para accesibilidad cuando hay imagen. */
function normalizarAlt(valor, nombreEvento) {
  const texto = String(valor || '').trim().slice(0, 200);
  return texto || `Afiche del evento ${String(nombreEvento || '').trim()}`.slice(0, 200);
}

module.exports = { guardarAfiche, borrarAfiche, normalizarAlt, ImagenInvalida, DIRECTORIO, RUTA_PUBLICA, MAX_BYTES };
