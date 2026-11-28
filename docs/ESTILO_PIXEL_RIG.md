# Estilo visual: pixel rig

Guia da estética dos personagens do Doomelets (Doom Slayer, Imp, Cacodemon, Lost Soul, Pinky, Daisy). Serve para criar personagens novos sem destoar dos existentes.

Resumo: **modelos 3D low-poly feitos de formas suaves, renderizados em baixíssima resolução com 3 tons por peça, pontilhado ordenado e contorno de tinta.** Não é pixel art desenhada à mão e não usa cubos. A impressão de pixel art vem do pipeline de render, não da arte.

## 1. Pipeline de render

Os rigs ficam em `demo/*-rig.html` (three.js 0.160). Cada um é uma página independente para ajustar poses e animações; `scripts/render_doom_sprites.py` renderiza os quadros finais.

| Etapa | Valor |
|---|---|
| Câmera | ortográfica, enquadramento de 2,3 unidades, 6 de distância |
| Luz | ambiente 0,3π + direcional 0,8π em (-2,2; 3,2; 4), material Lambert |
| Cor | `ColorManagement` desligado, saída linear, sem antialias, pixel ratio 1 |
| Resolução do render | 96 × 96 na prévia (64 e 128 disponíveis); 160 × 160 no script, depois recortado |
| Cena | `rig.position.y = 0.95`; o modelo fica em torno de y = 1,0 |

Cada quadro faz **3 passes** da mesma cena:

1. **lit:** brilho (Lambert) por pixel, de 0 a 1.
2. **id:** cada peça tem um id numérico pintado no canal vermelho (id × 16). Por isso um personagem tem **no máximo 15 peças de cor**.
3. **depth:** profundidade, usada só para decidir contornos.

A composição por pixel:

- **Tom:** `l = brilho` (mais um pontilhado, ver abaixo). Se `l < 0,55` usa o tom escuro da peça, se `l < 0,80` o tom médio, senão o claro. Os limites são `T1 = 0,55` e `T2 = 0,80`.
- **Pontilhado:** soma-se a `l` uma matriz de Bayer 4 × 4 com amplitude de 0,12. A transição entre tons vira um padrão quadriculado em vez de uma faixa lisa.
- **Contorno:** o pixel vira tinta `#0b0908` quando um vizinho (4 direções) é de outra peça **e** ou o pixel é fundo, ou o vizinho está mais de 3 níveis de profundidade à frente. Resultado: borda externa sempre, e contorno interno só onde uma peça passa na frente de outra, nunca entre peças que se tocam.
- **Fundo:** transparente nos PNGs finais.

## 2. Paleta

Cada peça tem uma rampa de **3 cores: sombra, base, luz**. A sombra puxa para um tom mais frio ou mais saturado, e a luz para um tom mais quente e claro (troca de matiz), nunca só "mais escuro" e "mais claro". As peças de cenário (`tan`, `floor`, `ledge`) existem só para as poses de pulo e não entram nos PNGs.

### Lost Soul

| Peça | Sombra | Base | Luz |
|---|---|---|---|
| bone (osso) | `#5a3430` | `#c49a74` | `#f0d4a4` |
| boneD (rachaduras) | `#2c1410` | `#6a3a2a` | `#a8704c` |
| socket (órbitas) | `#000000` | `#0a0204` | `#260a0c` |
| ember (brasa) | `#c8300a` | `#ff9020` | `#fff08a` |
| tooth (dentes) | `#8a6a4a` | `#eadab8` | `#fffaf0` |
| mouth (boca) | `#100203` | `#3a0a0a` | `#701818` |
| fireA (fogo, borda) | `#5a0804` | `#c81808` | `#ff4a10` |
| fireB (fogo, meio) | `#a02a04` | `#ff7a10` | `#ffc030` |
| fireC (fogo, núcleo) | `#ff8a10` | `#ffd840` | `#fffbd0` |

### Cacodemon

| Peça | Sombra | Base | Luz |
|---|---|---|---|
| red (corpo) | `#561006` | `#c42a10` | `#ff6030` |
| redD (manchas) | `#2e0804` | `#80180a` | `#b82a14` |
| pink (pálpebra) | `#6e1c34` | `#d44a68` | `#ff94a8` |
| iris | `#052a05` | `#16a016` | `#6cff4c` |
| horn (chifres) | `#7a4a2c` | `#d89c6c` | `#ffdcb0` |
| mouth | `#080101` | `#260505` | `#541010` |
| tooth | `#8a6c4c` | `#e4cfa8` | `#fff6e4` |

### Pinky

| Peça | Sombra | Base | Luz |
|---|---|---|---|
| pink (cúpula das costas) | `#6a2848` | `#e0688c` | `#ffb4c4` |
| skin (corpo, testa) | `#5a1610` | `#c04632` | `#f48468` |
| skinD (membros) | `#38090a` | `#8a2a20` | `#c85238` |
| gold (espinhos, chifres, presas) | `#6a4408` | `#dca224` | `#fff0a0` |
| eye | `#6a3a00` | `#f8c020` | `#fffab0` |
| mouth | `#0c0204` | `#4a0a18` | `#901c2c` |
| tooth | `#6a5a20` | `#d4bc68` | `#fff0b0` |
| pale (rosto, mandíbula) | `#6a3a5c` | `#dca4c0` | `#fff0f6` |

Bípede curvado: pélvis com duas pernas, tronco inclinado, braços grossos com cotovelo dobrado, cúpula rosa em cima do corpo com espinhos de ouro. Rosto de frente: elmo vermelho com sobrancelha pesada, rosto claro, duas fileiras de dentes e duas presas. Modelo escalado a 72% para caber no quadro de perfil; a pose-base (tronco, cabeça, braços) é somada às poses em `applyPose`.

### Daisy

Coelha de pelúcia de quatro patas (ref.: pelúcia marrom). Peças: `fur` (`#5a3418` / `#b8742c` / `#e8a458`), `lite` (focinho, `#8a5a30` / `#d89c50` / `#f8c878`), `cream` (`#a09068` / `#f0e4b8` / `#fffbe0`), `eye` (preto, também a ponta das orelhas), `shine`, `tongue` e `nose`. O salto usa um parâmetro `e` de 0 (agachada) a 1 (esticada no ar), com as patas de trás levemente atrasadas em relação às da frente; as pernas traseiras ficam dobradas na pose-base, somada em `applyPose`. O modelo está a 62% da escala, de propósito: a Daisy é bem menor que os demônios (sprite final de 82 × 70 contra 162 × 133 da Pinky).

Imp e Doom Slayer seguem a mesma lógica; as rampas estão no início de `demo/imp-rig.html` e `demo/doomguy-rig.html`.

### Peças que brilham (fogo e brasa)

Fogo e brasas não recebem sombra de verdade. Em `GLOW` o brilho da peça é fixado (brasa 0,95; fogo da borda 0,60; meio 0,70; núcleo 0,92) e a luz da cena só varia ±0,25 em volta disso. Com o pontilhado, o fogo da borda alterna entre sombra e base, e o núcleo fica quase sempre no tom claro. Para um efeito de brilho, não use luz: fixe o valor.

## 3. Modelagem

- **Primitivas suaves:** esferas e elipsoides achatados (`ball`), cones, troncos e tubos. Nada de cubos nos corpos; caixas só em detalhes pequenos como dentes.
- **Esferas com 14 × 11 segmentos** (30 × 18 nas peças grandes). Poucos polígonos bastam, porque o render descarta quase tudo.
- **Silhueta primeiro:** o personagem precisa ser reconhecível preenchido de uma cor só. A Lost Soul de frente só virou caveira depois de estreitar maxilar e mandíbula e abrir órbitas grandes e escuras; detalhe interno não substitui forma.
- **Escuro lê como profundidade:** órbitas, narinas e bocas são peças quase pretas, não buracos.
- **Rachaduras e manchas:** pontos de Fibonacci sobre a esfera, achatados e orientados pela normal, evitando a região do rosto.
- **Fogo:** cada língua é uma corrente de bolhas (núcleo amarelo perto da cabeça, laranja no meio, vermelho na ponta). Use poucas línguas (6) finas e com direções separadas em mais de 35°; muitas línguas largas fundem numa massa só. A animação orienta a corrente, estica o comprimento e dá a cada bolha uma fase própria, de modo que a língua serpenteia da base à ponta. Todos os ciclos são inteiros por volta da animação, então o loop não dá salto.

## 4. Câmera e quadros

| Personagem | Giro (yaw) | Inclinação (pitch) |
|---|---|---|
| Doom Slayer | 60° | 8° |
| Imp | 60° | 8° |
| Cacodemon | 25° | 8° |
| Lost Soul | 45° | 8° |
| Pinky | 60° | 8° |
| Daisy | 65° | 8° |

Giro 90° mostra o perfil virado para a direita. **A arte sempre olha para a direita**; o jogo espelha pelo centro quando o personagem anda para a esquerda.

Todos os quadros de um personagem têm **o mesmo tamanho**, com o corpo centralizado na horizontal (caixa comum: topo e base pela união dos quadros, largura simétrica em torno do centro). Sem isso o sprite "pula" ao espelhar.

## 5. Animação

- **10 quadros por segundo** na prévia; no jogo, cada animação do `animations.json` define `ticks` (de 50 ms) por quadro.
- Ciclos (`idle`, `walk`, `run`, `held`) amostram `frame / quadros`; animações únicas (`jump`, `fall`, `hurt`, `death`) amostram `frame / (quadros - 1)`.
- Animações do motor: `walk`, `run`, `idle`, `jump`, `fall`, `held` (obrigatórias para qualquer personagem) e, conforme o personagem, `attack`, `hurt`, `death`, `reload`, `look`, `glory`, `pet`, `float`.
- Pouca amplitude basta: o sprite aparece pequeno. Exagere pose e deslocamento em vez de contar com detalhe.

## 6. Como fazer um personagem novo

1. Copie `demo/cacodemon-rig.html` (flutuante, sem membros) ou `demo/imp-rig.html` (bípede) e troque `PARTS`, o modelo e `ANIMS`.
2. Deixe cada peça com uma rampa de 3 cores e **até 15 peças** no total.
3. Defina poses como funções `t → pose` (ou `keyAnim` com quadros-chave) e confira cada animação na prévia, de frente, 3/4 e perfil.
4. Registre o personagem em `scripts/render_doom_sprites.py` (página, yaw, pitch, animações e quadros por animação) e rode o script.
5. Os PNGs e o `animations.json` caem em `src/images/<Nome>/`; registre o tipo nos padrões do GNOME e do KWin como em `README.md`.
