// Faz `import ... from 'gi://X'` e 'resource:///...' apontarem para um GNOME Shell simulado,
// para rodar as classes reais com `node --import ./tests/support/register.mjs --test tests/`.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
