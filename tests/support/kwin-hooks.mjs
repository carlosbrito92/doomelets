export async function resolve(specifier, context, next) {
    if (specifier.endsWith('/behavior.mjs') && context.parentURL?.includes('/kwin/contents/code')) {
        return { url: new URL('../../src/behavior.js', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
}
