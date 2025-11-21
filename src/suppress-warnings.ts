// Suppress specific Node.js warnings
const originalEmitWarning = process.emitWarning;

process.emitWarning = function (warning: string | Error, ...args: any[]) {
    // Suppress ExperimentalWarning for loaders
    if (
        typeof warning === 'string' && 
        warning.includes('--experimental-loader')
    ) {
        return;
    }
    
    // Suppress other noisy warnings as needed
    if (
        typeof warning === 'string' &&
        (warning.includes('punycode') || 
         warning.includes('DEP0040'))
    ) {
        return;
    }
    
    // Call the original emitWarning for other warnings
    return originalEmitWarning.call(process, warning, ...args);
};

