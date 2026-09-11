//go:build !windows

package main

import("errors";"fmt";"os";"os/exec")
func showError(message string){fmt.Fprintln(os.Stderr,message)}
func hideProcess(command *exec.Cmd){}
func applicationBase()(string,error){return "",errors.New("Este instalador é destinado ao Windows.")}
func secureFolder(folder string)error{return os.Chmod(folder,0700)}
func openBrowser(address string)error{return errors.New("Este instalador é destinado ao Windows.")}
func createShortcut(target string){}
