export async function resolve(specifier, context, next) {
    if (specifier.startsWith('gi://') || specifier.startsWith('resource://')) {
        return { url: new URL('./shell-stubs.mjs', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
}
