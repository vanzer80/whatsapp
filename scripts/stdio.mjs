// Remove inherited secrets BEFORE importing any third-party module or launching Chrome.
import { minimalEnvironment } from '../src/local-security.mjs';
const safe = minimalEnvironment();
for (const key of Object.keys(process.env)) if (!(key in safe)) delete process.env[key];
try { await (await import('../src/server.mjs')).main(); }
catch { process.stderr.write('Não foi possível iniciar o plugin. Verifique a configuração local.\n'); process.exitCode = 1; }
