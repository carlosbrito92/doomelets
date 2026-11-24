#!/usr/bin/env python3
"""Renderiza os sprites 0..11.png do Doom Slayer, Imp e Cacodemon a partir dos rigs three.js em demo/.

Requer: pip install playwright pillow && playwright install chromium
Uso:    python3 scripts/render_doom_sprites.py [pasta_de_saida]   (padrão: src/images)

Quadros (ver README): 0-3 andar/flutuar, 4 parado, 5 pulo/queda, 6-7 ataque (preparar/disparar),
8 morte, 9 dano, 10-11 pego/arrastado (todos opcionais). Todos os quadros de um personagem têm o mesmo tamanho,
com o corpo centralizado (o jogo espelha o sprite pelo centro).
"""
import base64, io, os, sys
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, 'demo')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'src', 'images')
RES = 160        # lado do render antes do recorte (px de pixel-art)

WALK4 = [0, 2, 4, 6]
CHARS = {
    'DoomSlayer': dict(page='doomguy-rig.html', yaw=60, pitch=8, frames=[
        *[('walk', i / 8) for i in WALK4], ('idle', 0.0), ('jumpUp', 0.55),
        ('shoot', 0.30), ('shoot', 0.06), ('death', 1.0), ('hurt', 0.3), ('held', 0.0), ('held', 0.5)]),
    'Imp': dict(page='imp-rig.html', yaw=60, pitch=8, frames=[
        *[('walk', i / 8) for i in WALK4], ('idle', 0.0), ('jumpUp', 0.55),
        ('fireball', 0.30), ('fireball', 0.72), ('death', 1.0), ('hurt', 0.3), ('held', 0.0), ('held', 0.5)]),
    'Cacodemon': dict(page='cacodemon-rig.html', yaw=25, pitch=8, frames=[
        *[('fly', i / 8) for i in WALK4], ('idle', 0.25), ('ascend', 0.5),
        ('fireball', 0.30), ('fireball', 0.68), ('death', 1.0), ('hurt', 0.3), ('held', 0.0), ('held', 0.5)]),
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
            imgs = []
            for anim, t in c['frames']:
                url = pg.evaluate('([a,t,y,pi,r]) => window.__rig.renderAt(a,t,y,pi,r)',
                                  [anim, t, c['yaw'], c['pitch'], RES])
                imgs.append(Image.open(io.BytesIO(base64.b64decode(url.split(',')[1]))).convert('RGBA'))
            pg.close()
            # caixa comum: topo/base pela união; largura simétrica em torno do centro
            cx = RES / 2
            top = min(i.getbbox()[1] for i in imgs); bot = max(i.getbbox()[3] for i in imgs)
            half = max(max(cx - i.getbbox()[0], i.getbbox()[2] - cx) for i in imgs)
            box = (int(cx - half) - 1, top - 1, int(cx + half) + 1, bot + 1)
            d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
            for k, im in enumerate(imgs):
                im.crop(box).save(os.path.join(d, f'{k}.png'))
            print(f'{name}: {len(imgs)} quadros, {box[2]-box[0]}x{box[3]-box[1]} -> {d}')
        br.close()

if __name__ == '__main__':
    main()
