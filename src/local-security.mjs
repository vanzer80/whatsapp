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

export function powershell(command, extraEnv = {}) {
  const binary = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return execFileSync(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...minimalEnvironment(), ...extraEnv }, encoding: 'utf8', timeout: 30000,
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
  if (securedDirs.has(resolved)) return;
  if (process.platform === 'win32') {
    // Fixed script; the path travels as an environment value, never PowerShell source.
    powershell(`$ErrorActionPreference='Stop';
      $item=Get-Item -LiteralPath $env:WA_SECURE_DIRECTORY -Force;
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point'; }
      $me=[Security.Principal.WindowsIdentity]::GetCurrent().User;
      $adminSid='S-1-5-32-544';
      $old=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::Owner);
      $owner=$old.GetOwner([Security.Principal.SecurityIdentifier]).Value;
      if ($owner -ne $me.Value -and $owner -ne $adminSid) { throw 'Owner mismatch'; }
      $dir=[System.IO.DirectoryInfo]::new($item.FullName);
      $acl=$dir.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);
      $acl.SetAccessRuleProtection($true,$false);
      foreach ($rule in @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))) {
        $acl.PurgeAccessRules($rule.IdentityReference);
      }
      $allowedSids = @($me, ([Security.Principal.SecurityIdentifier]'S-1-5-18'));
      if ($owner -eq $adminSid) { $allowedSids += [Security.Principal.SecurityIdentifier]$adminSid; }
      foreach ($sid in $allowedSids) {
        $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);
        $acl.AddAccessRule($rule);
      }
      $dir.SetAccessControl($acl);
      $check=$dir.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);
      if (!$check.AreAccessRulesProtected) { throw 'ACL not protected'; }
      foreach ($rule in $check.Access) {
        $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;
        if ($sid -ne $me.Value -and $sid -ne 'S-1-5-18' -and $sid -ne $adminSid) { throw 'Unexpected access rule'; }
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
