#!/usr/bin/env python3
"""Desenha em pixel art os 3 companheiros: Daisy (coelha), Pinky (demônio rosa) e Lost Soul (caveira flamejante).

Requer: pip install pillow
Uso:    python3 scripts/render_companion_sprites.py [pasta_de_saida]   (padrão: src/images)

Mesmo contrato de saída do render_doom_sprites.py: N.png + animations.json por personagem,
todos os quadros com o mesmo tamanho e o corpo centralizado (o jogo espelha pelo centro; arte
virada para a direita). Cada sprite é desenhado numa grade de 32x32 com poucas cores (rampas
com troca de matiz: sombra fria, luz quente), ganha contorno automático e é ampliado 4x por
vizinho mais próximo, sem anti-aliasing.
"""
import json, math, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src', 'images')
G, SCALE, GROUND = 32, 4, 30     # grade, ampliação inteira, linha do chão

OUTLINE = (44, 28, 52)
EYE = (30, 18, 36)
WHITE = (250, 244, 236)


def ramp(shadow, base, light):
    return (shadow, base, light)


FUR = ramp((150, 138, 160), (206, 194, 190), (246, 238, 228))
PINK = ramp((150, 52, 92), (226, 110, 138), (252, 168, 170))
STEEL = ramp((70, 70, 92), (118, 120, 140), (170, 172, 188))
BONE = ramp((150, 136, 150), (222, 212, 196), (252, 246, 226))
FIRE = ramp((196, 36, 24), (250, 128, 24), (255, 226, 96))


class Canvas:
    def __init__(self):
        self.im = Image.new('RGBA', (G, G), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def px(self, x, y, c):
        if 0 <= x < G and 0 <= y < G:
            self.im.putpixel((round(x), round(y)), c + (255,))

    def rect(self, x0, y0, x1, y1, c):
        self.d.rectangle([round(x0), round(y0), round(x1), round(y1)], fill=c + (255,))

    def line(self, x0, y0, x1, y1, c, w=2):
        self.d.line([(round(x0), round(y0)), (round(x1), round(y1))], fill=c + (255,), width=w)

    def blob(self, cx, cy, rx, ry, r):
        """Elipse com 3 tons: sombra embaixo, base, brilho no canto da luz (cima-direita)."""
        e = lambda ox, oy, sx, sy, c: self.d.ellipse(
            [round(cx - rx + ox), round(cy - ry + oy), round(cx + rx + sx), round(cy + ry + sy)], fill=c + (255,))
        e(0, 0, 0, 0, r[0])
        e(0, 0, -1, -1, r[1])
        if rx > 2 and ry > 2:
            e(rx * 0.7, ry * 0.15, -rx * 0.65, -ry * 1.15, r[2])

    def finish(self):
        """Contorno de 1 px só nas bordas externas (nunca contra fundo opaco)."""
        src = self.im.copy()
        for y in range(G):
            for x in range(G):
                if src.getpixel((x, y))[3] == 0 and any(
                        0 <= x + dx < G and 0 <= y + dy < G and src.getpixel((x + dx, y + dy))[3]
                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    self.im.putpixel((x, y), OUTLINE + (255,))
        return self.im


def gait(kind, t):
    """Parâmetros comuns a quem anda: fase (0..2π), quicar e amplitude da passada."""
    a = 2 * math.pi * t
    return {'walk': (a, abs(math.sin(a)) * 1.0, 3), 'run': (a, abs(math.sin(a)) * 2.0, 5),
            'idle': (0, math.sin(a) * 0.5, 0), 'jump': (0, 0, 2), 'fall': (0, 0, 1),
            'held': (a * 2, 0, 1)}[kind]


def leg(c, x, top, phase, amp, ramp_, gy, w=2):
    sw = math.sin(phase) * amp
    lift = max(0.0, math.cos(phase)) * (1.5 if amp > 1 else 0)
    c.line(x, top, x + sw, gy - lift, ramp_[0], w)
    c.line(x, top, x + sw, gy - lift - 1, ramp_[1], w) if w > 1 else None


# ----------------------------------------------------------------------------- Daisy
def daisy(kind, t):
    c = Canvas()
    ph, bob, amp = gait(kind, t)
    air = {'jump': -4, 'fall': -2, 'held': -3}.get(kind, 0)
    dy = -bob + air
    ears = {'jump': -2, 'fall': 3, 'held': 2}.get(kind, 0) + (math.sin(2 * math.pi * t) * 1.5 if kind == 'idle' else 0)
    gy = GROUND + (air if kind == 'held' else 0)
    # pernas: traseira (coxa grande) e dianteira
    hop = kind in ('walk', 'run')
    for x, p in ((9, ph + math.pi), (20, ph)):
        leg(c, x, 24 + dy, p, amp if hop else 0, FUR, gy if not air or kind == 'held' else GROUND + air // 2, 2)
    c.blob(6, 21 + dy, 2, 2, WHITE and ramp((200, 190, 205), WHITE, WHITE))             # rabo
    c.blob(13, 21 + dy, 8, 5, FUR)                                                       # corpo
    c.blob(10, 24 + dy, 4, 3, FUR)                                                       # coxa
    for ex, tilt in ((19, -1), (22, 1)):                                                 # orelhas
        c.line(ex, 14 + dy, ex + tilt - ears * 0.5, 3 + dy + abs(ears) * 0.4, FUR[1], 3)
        c.line(ex, 13 + dy, ex + tilt - ears * 0.5, 4 + dy + abs(ears) * 0.4, PINK[2], 1)
    c.blob(22, 18 + dy, 5, 4, FUR)                                                       # cabeça
    c.rect(26, 18 + dy, 27, 19 + dy, PINK[1])                                            # nariz
    c.px(24, 16 + dy, EYE)
    c.px(24, 15 + dy, WHITE)
    c.px(25, 20 + dy, PINK[0])
    return c.finish()


# ----------------------------------------------------------------------------- Pinky
def pinky(kind, t):
    c = Canvas()
    ph, bob, amp = gait(kind, t)
    air = {'jump': -4, 'fall': -2, 'held': -3}.get(kind, 0)
    dy = -bob * 0.6 + air
    gy = GROUND
    for x, p in ((7, ph), (12, ph + math.pi), (19, ph + math.pi), (24, ph)):             # 4 patas grossas
        leg(c, x, 23 + dy, p, amp * 0.6 if kind in ('walk', 'run') else 0, PINK, gy + (air if air and kind != 'held' else 0) * 0.5, 3)
    c.line(4, 19 + dy, 1, 17 + dy + math.sin(ph) * 1.5, PINK[0], 2)                      # rabo
    c.blob(14, 20 + dy, 10, 6, PINK)                                                     # corpo
    for i, x in enumerate((8, 12, 16)):                                                  # placas de aço no dorso
        c.rect(x, 13 + dy - (i == 1), x + 2, 15 + dy, STEEL[1])
        c.px(x + 1, 13 + dy - (i == 1), STEEL[2])
    c.blob(25, 20 + dy, 6, 5, PINK)                                                      # cabeça
    c.rect(26, 22 + dy, 30, 24 + dy, PINK[0])                                            # mandíbula
    c.px(28, 21 + dy, WHITE); c.px(30, 22 + dy, WHITE)                                   # presas
    c.line(24, 15 + dy, 22, 12 + dy, BONE[1], 1)                                         # chifre
    c.line(28, 15 + dy, 29, 12 + dy, BONE[1], 1)
    c.px(27, 18 + dy, (255, 220, 60)); c.px(27, 19 + dy, EYE)                            # olho
    return c.finish()


# ----------------------------------------------------------------------------- Lost Soul
def lostsoul(kind, t):
    c = Canvas()
    a = 2 * math.pi * t
    bob = math.sin(a) * {'walk': 1.5, 'run': 1.5, 'idle': 1.0, 'jump': 0, 'fall': 0, 'held': 0.5}[kind]
    dy = 3 + bob + {'jump': -3, 'fall': 2, 'held': -1}.get(kind, 0)
    # chamas atrás da cabeça: bolhas decrescentes oscilando fora de fase (para cima no salto, para baixo na queda)
    drift = {'jump': 3, 'fall': -3}.get(kind, 0)
    for i in range(6):
        x = 14 - i * 2.4
        y = 15 + dy + math.sin(a + i * 1.1) * (1 + i * 0.4) + (i * drift * 0.3)
        r = max(1, 5 - i * 0.7)
        c.blob(x, y, r, r, FIRE if i < 4 else ramp(FIRE[0], FIRE[0], FIRE[1]))
    c.blob(19, 15 + dy, 6, 6, BONE)                                                      # crânio
    c.rect(20, 19 + dy, 25, 22 + dy, BONE[1])                                            # mandíbula
    c.rect(20, 22 + dy, 25, 22 + dy, BONE[0])
    for x in (21, 23, 25):
        c.px(x, 21 + dy, EYE)                                                            # dentes
    c.rect(22, 13 + dy, 24, 16 + dy, EYE)                                                # órbita
    c.px(23, 15 + dy, FIRE[2]); c.px(23, 14 + dy, FIRE[1])                               # brilho no olho
    c.px(26, 17 + dy, EYE)                                                               # nariz
    c.px(14, 12 + dy, FIRE[2]); c.px(16, 10 + dy - (a % 2 > 1), FIRE[1])                 # fagulhas
    return c.finish()


def loop(n):
    return [i / n for i in range(n)]


# animação -> (quadros t, ticks de 50 ms por quadro, loop). 'held' toca ao arrastar.
ANIMS = {'walk': (loop(8), 2, True), 'run': (loop(8), 1.5, True), 'idle': (loop(6), 5, True),
         'jump': ([0.0, 0.34, 0.67], 3, False), 'fall': ([0.0, 0.34, 0.67], 3, False), 'held': (loop(4), 4, True)}
CHARS = {'Daisy': daisy}   # Lost Soul e Pinky vêm dos rigs 3D (render_doom_sprites.py)
# Mesmos quadros em walk e run no Lost Soul: ele flutua, só muda o ritmo.


def main():
    for name, fn in CHARS.items():
        imgs, manifest = [], {}
        for key, (ts, ticks, lp) in ANIMS.items():
            manifest[key] = dict(frames=list(range(len(imgs), len(imgs) + len(ts))), ticks=ticks, loop=lp)
            imgs += [fn(key, t) for t in ts]
        # caixa comum: topo/base pela união; largura simétrica em torno do centro da grade
        top = min(i.getbbox()[1] for i in imgs); bot = max(i.getbbox()[3] for i in imgs)
        half = max(max(G / 2 - i.getbbox()[0], i.getbbox()[2] - G / 2) for i in imgs)
        box = (int(G / 2 - half), top, int(G / 2 + half + 0.99), bot)
        d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
        for old in os.listdir(d):
            if old.endswith('.png'):
                os.remove(os.path.join(d, old))
        for k, im in enumerate(imgs):
            im.crop(box).resize(((box[2] - box[0]) * SCALE, (box[3] - box[1]) * SCALE), Image.NEAREST) \
                .save(os.path.join(d, f'{k}.png'))
        with open(os.path.join(d, 'animations.json'), 'w') as f:
            json.dump(manifest, f, indent=1); f.write('\n')
        print(f'{name}: {len(imgs)} quadros, {(box[2]-box[0])*SCALE}x{(box[3]-box[1])*SCALE} -> {d}')


if __name__ == '__main__':
    main()
