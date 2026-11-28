// O pacote KWin recebe src/behavior.js como code/behavior.mjs (scripts/kwin.sh build).
// Aqui o mesmo mapeamento, para testar kwin/contents/code/*.mjs direto no Node.
import { register } from 'node:module';
register('./kwin-hooks.mjs', import.meta.url);
