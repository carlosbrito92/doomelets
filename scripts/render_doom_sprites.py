#!/usr/bin/env python3
"""Renderiza os sprites do Doom Slayer, Doom Slayer Eternal, Imp, Imp 2, Cacodemon, Lost Soul, Pinky e Daisy a partir dos rigs three.js em demo/.

Requer: pip install playwright pillow && playwright install chromium
Uso:    python3 scripts/render_doom_sprites.py [pasta_de_saida]   (padrão: src/images)

Para cada personagem grava N.png e um animations.json que diz quais quadros formam cada
animação (ver README). Todos os quadros de um personagem têm o mesmo tamanho, com o corpo
centralizado (o jogo espelha o sprite pelo centro).
"""
import base64, glob, io, json, os, sys
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, 'demo')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src', 'images')
RES = 160        # lado do render antes do recorte (px de pixel-art)

def loop(anim, n):
    """n quadros igualmente espaçados de uma animação cíclica."""
    return [(anim, i / n) for i in range(n)]


def seq(anim, *times):
    return [(anim, t) for t in times]


def A(frames, ticks, loop=True):
    """Uma entrada do manifesto: lista de (animação do rig, t), ticks (50 ms) por quadro."""
    return dict(frames=frames, ticks=ticks, loop=loop)


DEATH = seq('death', 0.0, 0.14, 0.28, 0.42, 0.56, 0.70, 0.85, 1.0)
HURT = seq('hurt', 0.18, 0.30, 0.65)

# A ordem das entradas define a numeração dos PNGs ('walk' primeiro: 0.png é o quadro de prévia).
CHARS = {
    'DoomSlayer': dict(page='doomguy-rig.html', yaw=60, pitch=8, anims={
        'walk': A(loop('walk', 8), 2),
        'run': A(loop('run', 8), 1.5),
        'idle': A(loop('idle', 6), 5),
        'reload': A(seq('reload', 0.06, 0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.70, 0.78, 0.85, 0.92, 0.98), 4, False),
        'look': A(seq('look', 0.07, 0.18, 0.28, 0.38, 0.48, 0.58, 0.70, 0.80, 0.90, 0.97), 5, False),
        'jump': A(seq('jumpUp', 0.34, 0.45, 0.55, 0.66), 3, False),
        'fall': A(seq('jumpDown', 0.32, 0.42, 0.52), 3, False),
        # os balins saem no primeiro tick: o clarão é o quadro 0
        'attack': A(seq('shoot', 0.05, 0.14, 0.25, 0.38, 0.52, 0.65, 0.78, 0.92), 1.5, False),
        'glory': A(seq('glory', 0.08, 0.20, 0.30, 0.40, 0.50, 0.62, 0.78, 0.92), 3, False),
        'hurt': A(HURT, 2, False),
        'death': A(DEATH, 2, False),
        'held': A(loop('held', 4), 4),
        'pet': A(loop('pet', 4), 4),
    }),
    'DoomEternal': dict(page='slayer-eternal-rig.html', yaw=60, pitch=8, anims={
        'walk': A(loop('walk', 8), 2),
        'run': A(loop('run', 8), 1.5),
        'idle': A(loop('idle', 6), 5),
        'reload': A(seq('reload', 0.06, 0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.70, 0.78, 0.85, 0.92, 0.98), 4, False),
        'look': A(seq('look', 0.07, 0.18, 0.28, 0.38, 0.48, 0.58, 0.70, 0.80, 0.90, 0.97), 5, False),
        'jump': A(seq('jumpUp', 0.34, 0.45, 0.55, 0.66), 3, False),
        'fall': A(seq('jumpDown', 0.32, 0.42, 0.52), 3, False),
        # os balins saem no primeiro tick: o clarão é o quadro 0
        'attack': A(seq('shoot', 0.05, 0.14, 0.25, 0.38, 0.52, 0.65, 0.78, 0.92), 1.5, False),
        'glory': A(seq('glory', 0.08, 0.20, 0.30, 0.40, 0.50, 0.62, 0.78, 0.92), 3, False),
        'hurt': A(HURT, 2, False),
        'death': A(DEATH, 2, False),
        'held': A(loop('held', 4), 4),
        'pet': A(loop('pet', 4), 4),
    }),
    'Imp': dict(page='imp-rig.html', yaw=60, pitch=8, anims={
        'walk': A(loop('walk', 8), 2),
        'run': A(loop('run', 8), 1.5),
        'idle': A(loop('idle', 6), 5),
        'jump': A(seq('jumpUp', 0.34, 0.45, 0.55, 0.66), 3, False),
        'fall': A(seq('jumpDown', 0.32, 0.42, 0.52), 3, False),
        # a bola sai no meio do ataque: o quadro 4 é o do arremesso
        'attack': A(seq('fireball', 0.10, 0.25, 0.40, 0.56, 0.72, 0.78, 0.87, 0.96), 2.5, False),
        'hurt': A(HURT, 2, False),
        'death': A(DEATH, 3, False),
        'held': A(loop('held', 4), 4),
    }),
    'Imp2': dict(page='imp2-rig.html', yaw=50, pitch=8, anims={
        'walk': A(loop('walk', 8), 2),
        'run': A(loop('run', 8), 1.5),
        'idle': A(loop('idle', 6), 5),
        'jump': A(seq('jumpUp', 0.34, 0.45, 0.55, 0.66), 3, False),
        'fall': A(seq('jumpDown', 0.32, 0.42, 0.52), 3, False),
        # a bola sai no meio do ataque: o quadro 4 é o do arremesso
        'attack': A(seq('fireball', 0.10, 0.25, 0.40, 0.56, 0.72, 0.78, 0.87, 0.96), 2.5, False),
        'hurt': A(HURT, 2, False),
        'death': A(DEATH, 3, False),
        'held': A(loop('held', 4), 4),
    }),
    'Cacodemon': dict(page='cacodemon-rig.html', yaw=25, pitch=8, anims={
        'walk': A(loop('fly', 8), 3),
        'float': A(loop('fly', 8), 3),
        'idle': A(loop('idle', 8), 4),
        'jump': A(seq('ascend', 0.25, 0.50, 0.75), 3, False),
        'fall': A(seq('descend', 0.30, 0.60, 0.85), 3, False),
        'attack': A(seq('fireball', 0.10, 0.22, 0.36, 0.52, 0.68, 0.76, 0.87, 0.96), 1.5, False),
        'hurt': A(HURT, 2, False),
        'death': A(DEATH, 3, False),
        'held': A(loop('held', 4), 4),
    }),
    'LostSoul': dict(page='lostsoul-rig.html', yaw=45, pitch=8, anims={
        'walk': A(loop('walk', 8), 3),
        'run': A(loop('run', 8), 2),
        'float': A(loop('idle', 8), 3),
        'idle': A(loop('idle', 8), 4),
        'jump': A(seq('jump', 0.0, 0.5, 1.0), 3, False),
        'fall': A(seq('fall', 0.0, 0.5, 1.0), 3, False),
        'held': A(loop('held', 4), 4),
    }),
    'Pinky': dict(page='pinky-rig.html', yaw=60, pitch=8, anims={
        'walk': A(loop('walk', 8), 3),
        'run': A(loop('run', 8), 2),
        'idle': A(loop('idle', 8), 4),
        'jump': A(seq('jump', 0.0, 0.5, 1.0), 3, False),
        'fall': A(seq('fall', 0.0, 0.5, 1.0), 3, False),
        'attack': A(seq('bite', 0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0), 2, False),
        'held': A(loop('held', 4), 4),
    }),
    'Daisy': dict(page='daisy-rig.html', yaw=65, pitch=8, anims={
        'walk': A(loop('walk', 8), 3),
        'run': A(loop('run', 8), 2),
        'idle': A(loop('idle', 8), 5),
        'jump': A(seq('jump', 0.0, 0.5, 1.0), 3, False),
        'fall': A(seq('fall', 0.0, 0.5, 1.0), 3, False),
        'held': A(loop('held', 4), 4),
    }),
}

def main():
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader',
                                     '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        for name, c in CHARS.items():
            pg = br.new_page()
            pg.on('pageerror', lambda e: print('pageerror:', e))
            pg.goto('file://' + os.path.join(DEMO, c['page']))
            pg.wait_for_function('!!(window.__rig && window.__rig.renderAt)', timeout=30000)
            imgs, index, manifest = [], {}, {}
            for key, a in c['anims'].items():
                ids = []
                for anim, t in a['frames']:
                    if (anim, t) not in index:          # quadros repetidos viram um PNG só
                        url = pg.evaluate('([a,t,y,pi,r]) => window.__rig.renderAt(a,t,y,pi,r)',
                                          [anim, t, c['yaw'], c['pitch'], RES])
                        index[(anim, t)] = len(imgs)
                        imgs.append(Image.open(io.BytesIO(base64.b64decode(url.split(',')[1]))).convert('RGBA'))
                    ids.append(index[(anim, t)])
                manifest[key] = dict(frames=ids, ticks=a['ticks'], loop=a['loop'])
            pg.close()
            # caixa comum: topo/base pela união; largura simétrica em torno do centro
            cx = RES / 2
            top = min(i.getbbox()[1] for i in imgs); bot = max(i.getbbox()[3] for i in imgs)
            half = max(max(cx - i.getbbox()[0], i.getbbox()[2] - cx) for i in imgs)
            box = (int(cx - half) - 1, top - 1, int(cx + half) + 1, bot + 1)
            d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
            for old in glob.glob(os.path.join(d, '*.png')):
                os.remove(old)
            for k, im in enumerate(imgs):
                im.crop(box).save(os.path.join(d, f'{k}.png'))
            with open(os.path.join(d, 'animations.json'), 'w') as f:
                json.dump(manifest, f, indent=1)
                f.write('\n')
            print(f'{name}: {len(imgs)} quadros, {box[2]-box[0]}x{box[3]-box[1]} -> {d}')
        br.close()

if __name__ == '__main__':
    main()
