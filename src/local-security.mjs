import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// A new directory deliberately avoids reusing the less restricted 0.1 session.
export function dataDirectory() {
  return path.join(process.env.LOCALAPPDATA || path.join(homedir(), '.local', 'share'), 'WhatsAppManutencaoSegura');
}

export function minimalEnvironment(source = process.env) {
  const keep = new Set(['systemroot','windir','comspec','userprofile','homedrive','homepath',
    'localappdata','appdata','programfiles','programfiles(x86)','programw6432',
    'temp','tmp','tmpdir','home','lang','lc_all','display','wayland_display','xdg_runtime_dir']);
  return Object.fromEntries(Object.entries(source).filter(([key]) => keep.has(key.toLowerCase())));
}

function safePowerShellEnv(source = process.env) {
  const blockedKeys = new Set([
    'node_options', 'node_path', 'pythonpath',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'openai_api_key', 'aws_secret_access_key', 'aws_access_key_id',
    'gh_token', 'github_token', 'control_plane_api_key', 'control_plane_base_url',
    'wa_allowed_chat_ids', 'wa_chrome_path', 'wa_tunnel_client', 'log_http_raw_unsafe'
  ]);
  const safe = {};
  for (const [k, v] of Object.entries(source)) {
    const lk = k.toLowerCase();
    if (blockedKeys.has(lk) || lk.startsWith('npm_') || lk.startsWith('github_') || lk.startsWith('runner_') || lk.startsWith('actions_')) continue;
    safe[k] = v;
  }
  return safe;
}

export function powershell(command, extraEnv = {}) {
  const sysRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const binary = path.join(sysRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const env = safePowerShellEnv(process.env);
  return execFileSync(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 30000,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024
  });
}

export function noLinks(target) {
  let current = path.resolve(target);
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Links e atalhos de pasta não são permitidos nos dados do plugin.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

const securedDirs = new Set();
export function secureDirectory(directory = dataDirectory()) {
  noLinks(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory()) throw new Error('Pasta local inválida.');
  const resolved = path.resolve(directory);
  if (securedDirs.has(resolved)) return directory;
  if (process.platform === 'win32') {
    // Fixed script; the path travels as an environment value, never PowerShell source.
    powershell(`$ErrorActionPreference='Stop';
      $item=Get-Item -LiteralPath $env:WA_SECURE_DIRECTORY -Force;
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point'; }
      $me=[Security.Principal.WindowsIdentity]::GetCurrent().User;
      $adminSid=[Security.Principal.SecurityIdentifier]'S-1-5-32-544';
      $systemSid=[Security.Principal.SecurityIdentifier]'S-1-5-18';
      $old=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::Owner);
      $owner=$old.GetOwner([Security.Principal.SecurityIdentifier]);
      if ($owner -ne $me -and $owner -ne $adminSid) { throw 'Owner mismatch'; }
      $dir=[System.IO.DirectoryInfo]::new($item.FullName);
      $acl=$dir.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);
      $acl.SetAccessRuleProtection($true,$false);
      $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));
      foreach ($r in $rules) { [void]$acl.RemoveAccessRuleSpecific($r); }
      $allowedSids=@($me,$systemSid);
      if ($owner -eq $adminSid) { $allowedSids += $adminSid; }
      foreach ($sid in $allowedSids) {
        $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);
        $acl.AddAccessRule($rule);
      }
      $dir.SetAccessControl($acl);
      $check=$dir.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);
      if (!$check.AreAccessRulesProtected) { throw 'ACL not protected'; }
      foreach ($rule in $check.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])) {
        $sid=$rule.IdentityReference;
        if ($sid -ne $me -and $sid -ne $systemSid -and $sid -ne $adminSid) { throw 'Unexpected access rule'; }
      }`, { WA_SECURE_DIRECTORY: directory });
  } else {
    if (lstatSync(directory).uid !== process.getuid()) throw new Error('A pasta local pertence a outro usuário.');
    chmodSync(directory, 0o700);
  }
  securedDirs.add(resolved);
  return directory;
}

export function readPrivateJson(file) {
  noLinks(file);
  const info = lstatSync(file);
  if (!info.isFile() || info.size > 32768) throw new Error('Arquivo local inválido.');
  if (process.platform !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077))) throw new Error('Permissões locais excessivas.');
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writePrivateJson(file, value) {
  secureDirectory(path.dirname(file));
  noLinks(file);
  const temporary = path.join(path.dirname(file), `.write-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
