// O motor JavaScript do QML (V4) é mais antigo que o Node/GJS: estes recursos de sintaxe
// derrubam o carregamento do script inteiro no KWin ("Unexpected token"), e nenhum teste em Node pega.
// Roda sobre todo o código que vai para o pacote KWin (inclusive src/behavior.js, copiado para lá).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
function files(dir, out = []) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) files(p, out); else if (/\.(mjs|qml)$/.test(f.name)) out.push(p);
    }
    return out;
}
const targets = [...files(path.join(root, 'kwin/contents')), path.join(root, 'src/behavior.js')];

// [nome, regex]: aplicada linha a linha, ignorando comentários de linha e o que está entre aspas
const BANNED = [
    ['atribuição lógica (??=, ||=, &&=)', /(\?\?|\|\||&&)=/],
    ['campo/método privado (#x)', /(^|[\s.(,])#[A-Za-z_]\w*/],
    ['bloco estático (static { })', /\bstatic\s*\{/],
    ['separador numérico (1_000)', /\b\d+_\d+/],
    ['Array.at() / findLast / replaceAll', /\.(at|findLast|findLastIndex|replaceAll)\(/],
];

function code(line) {
    return line.replace(/\/\/.*$/, '').replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
}

for (const file of targets) {
    test(`sintaxe compatível com o QML do KWin: ${path.relative(root, file)}`, () => {
        const bad = [];
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
            const c = code(line);
            for (const [name, re] of BANNED) if (re.test(c)) bad.push(`${i + 1}: ${name}: ${line.trim()}`);
        });
        assert.deepEqual(bad, []);
    });
}
