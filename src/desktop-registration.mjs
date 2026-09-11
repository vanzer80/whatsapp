import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { noLinks } from './local-security.mjs';

const serverName = 'whatsapp_manutencao';
const legacyServerName = 'whatsapp-manutencao';
const begin = '# BEGIN WHATSAPP-MANUTENCAO LOCAL';
const end = '# END WHATSAPP-MANUTENCAO LOCAL';
export const configPath = () => path.join(homedir(), '.codex', 'config.toml');
function read(file) {
  noLinks(file);
  if (!existsSync(file)) return '';
  if (!lstatSync(file).isFile() || lstatSync(file).size > 1048576) throw new Error('A configuração existente do ChatGPT precisa ser revisada. Nenhuma alteração foi feita.');
  return readFileSync(file,'utf8');
}
function managedRegion(text) {
  const a=text.indexOf(begin), b=text.indexOf(end);
  if (a<0 && b<0) return null;
  if (a<0 || b<a || text.indexOf(begin,a+1)>=0 || text.indexOf(end,b+1)>=0 || (a>0 && text[a-1]!=='\n')) throw new Error('O registro local foi alterado externamente. Nenhuma configuração foi sobrescrita.');
  return {start:a,end:b+end.length};
}
export function registrationText(original, executable) {
  if (!path.isAbsolute(executable) || /[\r\n\0]/.test(executable)) throw new Error('Caminho do aplicativo inválido.');
  const config=parse(original.replace(/^\uFEFF/,''));
  const range=managedRegion(original);
  if ((config.mcp_servers?.[serverName] || config.mcp_servers?.[legacyServerName]) && !range) throw new Error('Já existe uma conexão WhatsApp com configuração própria. Ela foi preservada.');
  let remaining=range ? original.slice(0,range.start)+original.slice(range.end) : original;
  const expected={command:executable,args:['--mcp'],enabled:true,startup_timeout_sec:45,tool_timeout_sec:90};
  const block=`${begin}\n[mcp_servers.${serverName}]\ncommand = ${JSON.stringify(executable)}\nargs = ["--mcp"]\nenabled = true\nstartup_timeout_sec = 45\ntool_timeout_sec = 90\n${end}\n`;
  const result=remaining+(remaining.endsWith('\n')?'':'\n')+'\n'+block;
  const checked=parse(result.replace(/^\uFEFF/,''));
  if (JSON.stringify(checked.mcp_servers?.[serverName])!==JSON.stringify(expected)) throw new Error('O registro local não passou na verificação.');
  // Check every unrelated setting before writing. Preserve its original text as well.
  const omit=c=>{const copy=structuredClone(c);if(copy.mcp_servers){delete copy.mcp_servers[serverName];delete copy.mcp_servers[legacyServerName];if(!Object.keys(copy.mcp_servers).length)delete copy.mcp_servers;}return copy;};
  if (JSON.stringify(omit(checked))!==JSON.stringify(omit(config))) throw new Error('O registro alteraria outra configuração. Operação cancelada.');
  return result;
}
function commit(file,original,next) {
  if (read(file)!==original) throw new Error('A configuração mudou enquanto o aplicativo estava trabalhando. Tente novamente.');
  mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=path.join(path.dirname(file),`.whatsapp-${randomUUID()}.tmp`);
  let backup;
  try {
    if (existsSync(file)) {
      backup=path.join(path.dirname(file),`config.antes-whatsapp-${Date.now()}-${randomUUID().slice(0,8)}.toml`);
      writeFileSync(backup,original,{flag:'wx',mode:0o600});
    }
    writeFileSync(temporary,next,{flag:'wx',mode:0o600});
    if (read(file)!==original) throw new Error('A configuração foi alterada por outro programa. Tente novamente.');
    renameSync(temporary,file);
    return {registered:true,backup_created:Boolean(backup)};
  } finally {if(existsSync(temporary))unlinkSync(temporary);}
}
export function registerLocal(executable,file=configPath()) {
  const original=read(file);
  const current=parse(original.replace(/^\uFEFF/,''));
  const item = current.mcp_servers?.[serverName] ?? current.mcp_servers?.[legacyServerName];
  if (item?.command===executable &&
      JSON.stringify(item.args)===JSON.stringify(['--mcp']) && item.enabled===true && managedRegion(original) && current.mcp_servers?.[serverName])
    return {registered:true,backup_created:false};
  return commit(file,original,registrationText(original,executable));
}
export function registrationStatus(executable,file=configPath()) {
  try {const c=parse(read(file).replace(/^\uFEFF/,''));const item=c.mcp_servers?.[serverName] ?? c.mcp_servers?.[legacyServerName];return item?.command===executable && item.enabled===true && JSON.stringify(item.args)===JSON.stringify(['--mcp']);}
  catch {return false;}
}
