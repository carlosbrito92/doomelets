// O zip do GNOME (scripts/pack.sh) lista os arquivos à mão: um módulo novo em src/ que ficar de fora
// quebra a extensão instalada ("Cannot find module") sem que nenhum outro teste perceba.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const pack = fs.readFileSync(root + 'scripts/pack.sh', 'utf8');
const zipLine = pack.match(/zip -qr "\$ZIP_FILE"((?:[^\n\\]|\\\n)*)/)[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean);

test('pack.sh inclui todos os módulos .js de src/ e as pastas do pacote', () => {
    const modules = fs.readdirSync(root + 'src').filter(f => f.endsWith('.js'));
    const missing = modules.filter(f => !zipLine.includes(f));
    assert.deepEqual(missing, []);
    for (const dir of ['characters', 'schemas', 'images']) assert.ok(zipLine.includes(dir), dir);
});

test('todo import relativo de src/ aponta para um arquivo que existe', () => {
    const files = [...fs.readdirSync(root + 'src').filter(f => f.endsWith('.js')).map(f => 'src/' + f),
        ...fs.readdirSync(root + 'src/characters').map(f => 'src/characters/' + f)];
    const bad = [];
    for (const f of files) {
        const dir = f.slice(0, f.lastIndexOf('/'));
        for (const m of fs.readFileSync(root + f, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
            const target = new URL(m[1], 'file://' + root + dir + '/').pathname;
            if (!fs.existsSync(target)) bad.push(`${f} -> ${m[1]}`);
        }
    }
    assert.deepEqual(bad, []);
});

test('o repositório não referencia mais os personagens originais removidos', () => {
    const removed = ['Kitten', 'Mouse', 'Puppy', 'Santa', 'Squirrel', 'Tux'];
    for (const t of removed) assert.ok(!fs.existsSync(root + 'src/images/' + t), `${t} ainda existe em src/images`);
    const schema = fs.readFileSync(root + 'src/schemas/org.gnome.shell.extensions.doomelets.gschema.xml', 'utf8');
    assert.ok(!/Santa/.test(schema));
    const kcfg = fs.readFileSync(root + 'kwin/contents/config/main.xml', 'utf8');
    for (const t of removed) assert.ok(!kcfg.includes(`Type${t}`), `Type${t} em main.xml`);
});
