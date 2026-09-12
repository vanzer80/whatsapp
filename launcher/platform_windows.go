//go:build windows

package main

import (
 "context"
 "errors"
 "os"
 "os/exec"
 "path/filepath"
 "syscall"
 "time"
 "unsafe"
)
var user32=syscall.NewLazyDLL("user32.dll")
var shell32=syscall.NewLazyDLL("shell32.dll")
func showError(message string) {
 text,_:=syscall.UTF16PtrFromString(message);title,_:=syscall.UTF16PtrFromString("WhatsApp Manutenção")
 user32.NewProc("MessageBoxW").Call(0,uintptr(unsafe.Pointer(text)),uintptr(unsafe.Pointer(title)),0x10)
}
func hideProcess(command *exec.Cmd){command.SysProcAttr=&syscall.SysProcAttr{HideWindow:true,CreationFlags:0x08000000}}
func applicationBase()(string,error){base:=os.Getenv("LOCALAPPDATA");if base==""||!filepath.IsAbs(base){return "",errors.New("Não foi possível localizar sua pasta de usuário do Windows.")};return filepath.Join(base,"Programs","WhatsAppManutencao"),nil}
func ps(script string,extra ...string)error {
 system:=os.Getenv("SystemRoot");if system==""{return errors.New("Pasta do Windows indisponível.")}
 ctx,cancel:=context.WithTimeout(context.Background(),30*time.Second);defer cancel()
 command:=exec.CommandContext(ctx,filepath.Join(system,"System32","WindowsPowerShell","v1.0","powershell.exe"),"-NoLogo","-NoProfile","-NonInteractive","-Command",script)
 command.Env=append(minimalEnv(),extra...);hideProcess(command)
 if command.Run()!=nil{return errors.New("Não foi possível proteger a instalação. Execute como usuário normal em uma pasta local do Windows.")};return nil
}
func secureFolder(folder string)error {
	return ps(`$ErrorActionPreference='Stop';
	$item=Get-Item -LiteralPath $env:WA_INSTALL_DIRECTORY -Force;
	if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw 'Reparse point';}
	$me=[Security.Principal.WindowsIdentity]::GetCurrent().User;
	$old=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::Owner);
	if ($old.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $me.Value) {throw 'Owner mismatch';}
	$dir=[System.IO.DirectoryInfo]::new($item.FullName);
	$acl=$dir.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);
	$acl.SetAccessRuleProtection($true,$false);
	foreach ($rule in @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))) {
		$acl.PurgeAccessRules($rule.IdentityReference);
	}
	foreach ($sid in @($me,([Security.Principal.SecurityIdentifier]'S-1-5-18'))) {
		$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);
		$acl.AddAccessRule($rule);
	}
	$dir.SetAccessControl($acl);
	$check=$dir.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);
	if (!$check.AreAccessRulesProtected){throw 'ACL not protected';}
	foreach($rule in $check.Access){$sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($sid -ne $me.Value -and $sid -ne 'S-1-5-18'){throw 'Unexpected access';}}`,"WA_INSTALL_DIRECTORY="+folder)
}
func openBrowser(address string)error {
 verb,_:=syscall.UTF16PtrFromString("open");url,_:=syscall.UTF16PtrFromString(address)
 result,_,_:=shell32.NewProc("ShellExecuteW").Call(0,uintptr(unsafe.Pointer(verb)),uintptr(unsafe.Pointer(url)),0,0,1)
 if result<=32{return errors.New("Não foi possível abrir o navegador padrão do Windows.")};return nil
}
func createShortcut(target string){
 _=ps(`$ErrorActionPreference='Stop';$desktop=[Environment]::GetFolderPath('Desktop');
 $file=[IO.Path]::Combine($desktop,'WhatsApp Manutenção.lnk');
 if (!(Test-Path -LiteralPath $file)){$shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($file);$shortcut.TargetPath=$env:WA_SHORTCUT_TARGET;$shortcut.WorkingDirectory=[IO.Path]::GetDirectoryName($env:WA_SHORTCUT_TARGET);$shortcut.Description='Conectar e controlar o acesso ao WhatsApp';$shortcut.Save();}`,"WA_SHORTCUT_TARGET="+target)
}
