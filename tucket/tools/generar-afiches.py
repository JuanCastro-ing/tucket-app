#!/usr/bin/env python3
"""
TUCKET — Generador de afiches para los eventos preestablecidos.

Dibuja un afiche 1200x675 por evento con la paleta del sitio (navy, gold,
paper) y lo guarda en img/events/. No descarga nada: todo se dibuja aquí,
así que no hay imágenes de terceros ni problemas de licencia.

Uso:  python3 tools/generar-afiches.py
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "img" / "events"
ANCHO, ALTO = 1200, 675

FUENTES = {
    "titulo": "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
    "texto": "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
    "mono": "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
}

GOLD = (232, 180, 76)
PAPER = (247, 243, 234)

# code, titulo, categoria, lugar, fecha, paleta (arriba, abajo), acento
EVENTOS = [
    ("DEMO-001", "Noche de Salsa", "SALSA EN VIVO · CALI",
     "Teatro Los Cristales", "14 NOV 2026 · 8:00 PM",
     ((122, 28, 38), (26, 16, 30)), GOLD),
    ("DEMO-002", "Festival Rock a la Cañada", "FESTIVAL · CALI",
     "Parque de la Salsa", "10 OCT 2026 · 9:00 PM",
     ((38, 22, 54), (12, 12, 20)), (199, 71, 63)),
    ("DEMO-003", "Romeo y Julieta", "TEATRO CLÁSICO · CALI",
     "Teatro Municipal Enrique Buenaventura", "02 DIC 2026 · 7:30 PM",
     ((18, 23, 43), (42, 28, 34)), GOLD),
    ("DEMO-004", "Concierto de Fin de Año", "ORQUESTA FILARMÓNICA · CALI",
     "Teatro Jorge Isaacs", "20 DIC 2026 · 6:00 PM",
     ((16, 30, 56), (10, 14, 26)), GOLD),
    ("DEMO-005", "Stand Up Comedy Night", "COMEDIA EN VIVO · BOGOTÁ",
     "Sala Beethoven", "28 NOV 2026 · 8:30 PM",
     ((20, 64, 58), (12, 20, 26)), (232, 180, 76)),
    ("DEMO-006", "Salsódromo Feria de Cali", "ESPECTÁCULO · CALI",
     "Autódromo de Palmaseca", "03 SEP 2026 · 7:00 PM",
     ((140, 70, 20), (30, 18, 24)), GOLD),
    ("DEMO-007", "Noche de Orquesta", "BANDA SINFÓNICA · TULUÁ",
     "Teatro Municipal Ángel María Camacho", "21 NOV 2026 · 7:00 PM",
     ((24, 34, 70), (12, 14, 24)), GOLD),
]


def fuente(clave, tamano):
    return ImageFont.truetype(FUENTES[clave], tamano)


def degradado(arriba, abajo):
    """Fondo con degradado diagonal suave entre dos colores."""
    base = Image.new("RGB", (ANCHO, ALTO), abajo)
    pintor = ImageDraw.Draw(base)
    for y in range(ALTO):
        t = y / (ALTO - 1)
        # curva suave: concentra el color claro arriba
        t = t ** 0.85
        color = tuple(round(arriba[i] + (abajo[i] - arriba[i]) * t) for i in range(3))
        pintor.line([(0, y), (ANCHO, y)], fill=color)
    return base


def luces(imagen, acento):
    """Haces de luz de escenario desde el borde superior."""
    capa = Image.new("RGBA", (ANCHO, ALTO), (0, 0, 0, 0))
    pintor = ImageDraw.Draw(capa)
    random.seed(7)
    for origen in (ANCHO * 0.22, ANCHO * 0.52, ANCHO * 0.82):
        ancho_base = random.randint(150, 240)
        desvio = random.randint(-220, 220)
        pintor.polygon(
            [(origen - 18, -40), (origen + 18, -40),
             (origen + desvio + ancho_base, ALTO + 40),
             (origen + desvio - ancho_base, ALTO + 40)],
            fill=(*acento, 58),
        )
    capa = capa.filter(ImageFilter.GaussianBlur(38))
    return Image.alpha_composite(imagen.convert("RGBA"), capa)


def motivo(imagen, acento):
    """Arcos concéntricos a la derecha: dan profundidad sin robarle
       protagonismo al título, que vive abajo a la izquierda."""
    capa = Image.new("RGBA", (ANCHO, ALTO), (0, 0, 0, 0))
    pintor = ImageDraw.Draw(capa)
    centro = (ANCHO * 0.80, ALTO * 0.30)
    for i, radio in enumerate(range(90, 460, 52)):
        alpha = max(12, 72 - i * 9)
        pintor.ellipse(
            [centro[0] - radio, centro[1] - radio, centro[0] + radio, centro[1] + radio],
            outline=(*acento, alpha), width=3,
        )
    capa = capa.filter(ImageFilter.GaussianBlur(1.2))
    return Image.alpha_composite(imagen.convert("RGBA"), capa).convert("RGB")


def vineta(imagen):
    """Oscurece bordes y pie para que el texto siempre se lea."""
    capa = Image.new("L", (ANCHO, ALTO), 0)
    pintor = ImageDraw.Draw(capa)
    for y in range(ALTO):
        t = max(0.0, (y - ALTO * 0.42) / (ALTO * 0.58))
        pintor.line([(0, y), (ANCHO, y)], fill=int(165 * (t ** 1.5)))
    negro = Image.new("RGB", (ANCHO, ALTO), (8, 9, 16))
    return Image.composite(negro, imagen.convert("RGB"), capa)


def grano(imagen, fuerza=7):
    """Un poco de grano: evita el aspecto plano de un degradado puro."""
    random.seed(11)
    ruido = Image.effect_noise((ANCHO, ALTO), 42).convert("L")
    return Image.blend(imagen, Image.merge("RGB", (ruido, ruido, ruido)), fuerza / 100)


def texto_espaciado(pintor, xy, texto, font, fill, espaciado=0):
    """Dibuja con interletraje manual (PIL no tiene letter-spacing)."""
    x, y = xy
    for caracter in texto:
        pintor.text((x, y), caracter, font=font, fill=fill)
        x += pintor.textlength(caracter, font=font) + espaciado
    return x


def ancho_espaciado(pintor, texto, font, espaciado=0):
    return sum(pintor.textlength(c, font=font) + espaciado for c in texto)


def quebrar(pintor, texto, font, maximo):
    palabras, lineas, actual = texto.split(), [], ""
    for palabra in palabras:
        prueba = f"{actual} {palabra}".strip()
        if pintor.textlength(prueba, font=font) <= maximo or not actual:
            actual = prueba
        else:
            lineas.append(actual)
            actual = palabra
    if actual:
        lineas.append(actual)
    return lineas


def troquel(imagen):
    """Perforación de boleto en el borde izquierdo: es la seña del sitio."""
    pintor = ImageDraw.Draw(imagen)
    x = 54
    paso = 34
    for y in range(26, ALTO, paso):
        pintor.ellipse([x - 4, y, x + 4, y + 9], fill=(247, 243, 234))


def afiche(code, titulo, categoria, lugar, fecha, paleta, acento):
    imagen = degradado(*paleta)
    imagen = luces(imagen, acento).convert("RGB")
    imagen = motivo(imagen, acento)
    imagen = grano(imagen)
    imagen = vineta(imagen)
    pintor = ImageDraw.Draw(imagen)

    margen = 96
    max_texto = ANCHO - margen - 150

    # La franja superior se deja libre a propósito: ahí la tarjeta de la
    # cartelera superpone el estado del evento y su código.

    # Título: se reduce hasta que quepa en tres líneas
    tamano = 92
    while tamano > 48:
        f_titulo = fuente("titulo", tamano)
        lineas = quebrar(pintor, titulo.upper(), f_titulo, max_texto)
        if len(lineas) <= 3:
            break
        tamano -= 6
    alto_linea = int(tamano * 1.02)

    # Overline
    f_over = fuente("texto", 24)
    y_over = ALTO - 96 - alto_linea * len(lineas) - 74
    texto_espaciado(pintor, (margen, y_over), categoria, f_over, acento, 3.2)
    pintor.line([(margen, y_over + 42), (margen + 74, y_over + 42)], fill=acento, width=3)

    # Título
    y = y_over + 62
    for linea in lineas:
        pintor.text((margen, y), linea, font=f_titulo, fill=PAPER)
        y += alto_linea

    # Pie: lugar y fecha
    f_pie = fuente("texto", 27)
    pintor.text((margen, y + 14), lugar, font=f_pie, fill=(214, 210, 200))
    f_fecha = fuente("mono", 23)
    texto_espaciado(pintor, (margen, y + 54), fecha, f_fecha, acento, 1.6)

    troquel(imagen)
    return imagen


def main():
    SALIDA.mkdir(parents=True, exist_ok=True)
    for datos in EVENTOS:
        imagen = afiche(*datos)
        destino = SALIDA / f"{datos[0].lower()}.jpg"
        imagen.save(destino, "JPEG", quality=86, optimize=True, progressive=True)
        print(f"  ✓ {destino.relative_to(RAIZ)}  ({destino.stat().st_size // 1024} KB)")
    print(f"\n{len(EVENTOS)} afiches generados en {SALIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
