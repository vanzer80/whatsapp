// Remove inherited secrets BEFORE importing any third-party module or launching Chrome.
import { minimalEnvironment } from '../src/local-security.mjs';
const safe = minimalEnvironment();
const winSys = new Set([
  'systemdrive', 'userdomain', 'username', 'computername', 'pathext', 'path',
  'programdata', 'allusersprofile', 'os', 'processor_architecture', 'psmodulepath',
  'commonprogramfiles', 'commonprogramfiles(x86)', 'commonprogramw6432'
]);
for (const key of Object.keys(process.env)) {
  const lower = key.toLowerCase();
  if (!(key in safe) && !winSys.has(lower)) {
    delete process.env[key];
  }
}
if (process.platform === 'win32') {
  const sysRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  process.env.PATH = `${sysRoot}\\System32;${sysRoot};${sysRoot}\\System32\\WindowsPowerShell\\v1.0`;
  if (!process.env.SystemDrive) process.env.SystemDrive = sysRoot.slice(0, 2);
}
try { await (await import('../src/server.mjs')).main(); }
catch { process.stderr.write('Não foi possível iniciar o plugin. Verifique a configuração local.\n'); process.exitCode = 1; }
