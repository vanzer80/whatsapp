// Remove inherited secrets BEFORE importing any third-party module or launching Chrome.
import { minimalEnvironment } from '../src/local-security.mjs';
const safe = minimalEnvironment();
const winSys = ['SYSTEMDRIVE', 'USERDOMAIN', 'USERNAME', 'COMPUTERNAME', 'PATHEXT'];
const preserved = {};
if (process.platform === 'win32') {
  for (const v of winSys) if (process.env[v]) preserved[v] = process.env[v];
}
for (const key of Object.keys(process.env)) if (!(key in safe)) delete process.env[key];
for (const [key, val] of Object.entries(safe)) process.env[key] = val;
if (process.platform === 'win32') {
  const sysRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  process.env.PATH = `${sysRoot}\\System32;${sysRoot};${sysRoot}\\System32\\WindowsPowerShell\\v1.0`;
  for (const [k, v] of Object.entries(preserved)) process.env[k] = v;
  if (!process.env.SystemDrive) process.env.SystemDrive = sysRoot.slice(0, 2);
}
try { await (await import('../src/server.mjs')).main(); }
catch { process.stderr.write('Não foi possível iniciar o plugin. Verifique a configuração local.\n'); process.exitCode = 1; }
