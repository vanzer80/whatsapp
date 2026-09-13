package main

import (
 "archive/zip"
 "crypto/sha256"
 "encoding/binary"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"
 "os/exec"
 "path"
 "path/filepath"
 "regexp"
 "strconv"
 "strings"
 "time"
)

var payloadSHA string
var payloadLength string
const version = "0.3.0"
const executableName = "WhatsApp-Manutencao.exe"

func minimalEnv() []string {
 allowed := map[string]bool{"SYSTEMROOT":true,"WINDIR":true,"COMSPEC":true,"USERPROFILE":true,"HOMEDRIVE":true,"HOMEPATH":true,"LOCALAPPDATA":true,"APPDATA":true,"PROGRAMFILES":true,"PROGRAMFILES(X86)":true,"PROGRAMW6432":true,"TEMP":true,"TMP":true,"HOME":true,"LANG":true,"LC_ALL":true}
 var result []string
 for _, item := range os.Environ() { key,_,_:=strings.Cut(item,"="); if allowed[strings.ToUpper(key)] {result=append(result,item)} }
 if sysRoot:=os.Getenv("SYSTEMROOT"); sysRoot!="" { result=append(result,"PATH="+filepath.Join(sysRoot,"System32")+";"+sysRoot) }
 return result
}
func noLinks(target string) error {
 for current:=filepath.Clean(target);;current=filepath.Dir(current) {
  info,err:=os.Lstat(current)
  if err==nil && info.Mode()&os.ModeSymlink!=0 {return errors.New("A pasta do aplicativo não pode ser um link.")}
  if err!=nil&&!os.IsNotExist(err){return err}
  if parent:=filepath.Dir(current);parent==current {break}
 }
 return nil
}
func hashReader(reader io.Reader) (string,error) {h:=sha256.New();_,err:=io.Copy(h,reader);return hex.EncodeToString(h.Sum(nil)),err}
func openPayload(self *os.File) (*zip.Reader,error) {
 info,err:=self.Stat()
 if err!=nil {return nil,err}
 var size int64
 var expectedSHA string
 var offset int64
 if payloadLength!="" && payloadSHA!="" {
  s,err:=strconv.ParseInt(payloadLength,10,64)
  if err!=nil||s<=0||s>300*1024*1024{return nil,errors.New("Metadados do instalador inválidos.")}
  size=s
  expectedSHA=payloadSHA
  offset=info.Size()-size
 } else if info.Size()>=80 {
  trailer:=make([]byte,80)
  if _,err:=self.ReadAt(trailer,info.Size()-80);err==nil&&string(trailer[72:80])=="WAPAYLOD" {
   expectedSHA=string(trailer[0:64])
   size=int64(binary.LittleEndian.Uint64(trailer[64:72]))
   offset=info.Size()-80-size
  }
 }
 if size<=0||size>300*1024*1024||offset<0||info.Size()<size {return nil,errors.New("Metadados do instalador inválidos ou instalador incompleto.")}
 section:=io.NewSectionReader(self,offset,size)
 sum,err:=hashReader(section)
 if err!=nil||sum!=expectedSHA {return nil,errors.New("O arquivo está incompleto ou foi alterado. Baixe novamente a versão fornecida.")}
 return zip.NewReader(io.NewSectionReader(self,offset,size),size)
}
func validateMembers(archive *zip.Reader) error {
 if len(archive.File)==0||len(archive.File)>30000{return errors.New("Quantidade de arquivos inválida.")}
 seen:=map[string]bool{};var total uint64
 for _,f:=range archive.File {
  clean:=path.Clean(f.Name)
  if clean!=f.Name||strings.HasPrefix(clean,"/")||clean==".."||strings.HasPrefix(clean,"../")||strings.ContainsAny(clean,"\\:\x00")||f.Mode()&os.ModeSymlink!=0||!f.Mode().IsRegular()||f.Flags&1!=0{return errors.New("O pacote contém um caminho ou arquivo inválido.")}
  key:=strings.ToLower(clean);if seen[key]{return errors.New("O pacote contém arquivos duplicados.")};seen[key]=true
  total+=f.UncompressedSize64
  if f.UncompressedSize64>140*1024*1024||total>650*1024*1024{return errors.New("O pacote excede o tamanho permitido.")}
 }
 return nil
}
func extractArchive(archive *zip.Reader,target string) error {
 if err:=validateMembers(archive);err!=nil{return err}
 for _,f:=range archive.File {
  output:=filepath.Join(target,filepath.FromSlash(f.Name))
  if err:=noLinks(output);err!=nil{return err}
  if err:=os.MkdirAll(filepath.Dir(output),0700);err!=nil{return err}
  reader,err:=f.Open();if err!=nil{return err}
  writer,err:=os.OpenFile(output,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600);if err!=nil{reader.Close();return err}
  _,copyErr:=io.Copy(writer,io.LimitReader(reader,int64(f.UncompressedSize64)+1));closeErr:=writer.Close();reader.Close()
  if copyErr!=nil{return copyErr};if closeErr!=nil{return closeErr}
  if info,err:=os.Stat(output);err!=nil||uint64(info.Size())!=f.UncompressedSize64{return errors.New("Falha na extração do pacote.")}
 }
 return nil
}
func verifyInstall(archive *zip.Reader,target string) error {
 allowed:=map[string]bool{executableName:true}
 for _,f:=range archive.File {
  allowed[filepath.FromSlash(f.Name)]=true
  file:=filepath.Join(target,filepath.FromSlash(f.Name))
  if err:=noLinks(file);err!=nil{return err}
  info,err:=os.Lstat(file);if err!=nil||!info.Mode().IsRegular()||uint64(info.Size())!=f.UncompressedSize64{return errors.New("A instalação está incompleta ou foi alterada.")}
  original,err:=f.Open();if err!=nil{return err};expected,err:=hashReader(original);original.Close();if err!=nil{return err}
  installed,err:=os.Open(file);if err!=nil{return err};actual,err:=hashReader(installed);installed.Close();if err!=nil{return err}
  if expected!=actual{return errors.New("Um componente do aplicativo foi alterado. A execução foi bloqueada.")}
 }
 return filepath.WalkDir(target,func(name string,item os.DirEntry,err error)error{
  if err!=nil{return err};if item.IsDir(){return nil};relative,err:=filepath.Rel(target,name);if err!=nil{return err}
  if !allowed[relative]{return errors.New("Há arquivos inesperados na instalação. A execução foi bloqueada.")};return nil
 })
}
func install(self *os.File,archive *zip.Reader) (string,error) {
	base,err:=applicationBase();if err!=nil{return "",err}
	if err=noLinks(base);err!=nil{return "",err};if err=os.MkdirAll(base,0700);err!=nil{return "",err}
	if err=secureFolder(base);err!=nil{return "",err}
	target:=filepath.Join(base,version)
	if _,err=os.Stat(target);err==nil {
		if verifyErr:=verifyInstall(archive,target); verifyErr==nil {
			return target,nil
		}
	} else if !os.IsNotExist(err){return "",err}
	stage,err:=os.MkdirTemp(base,"install-");if err!=nil{return "",err};defer os.RemoveAll(stage)
	if err=secureFolder(stage);err!=nil{return "",err}
	if err=extractArchive(archive,stage);err!=nil{return "",err}
	if _,err=self.Seek(0,io.SeekStart);err!=nil{return "",err}
	out,err:=os.OpenFile(filepath.Join(stage,executableName),os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);if err!=nil{return "",err}
	_,copyErr:=io.Copy(out,self);closeErr:=out.Close();if copyErr!=nil{return "",copyErr};if closeErr!=nil{return "",closeErr}
	if err=verifyInstall(archive,stage);err!=nil{return "",err}
	if _,err=os.Stat(target);err==nil {
		oldBackup:=filepath.Join(base,"old-"+version+"-"+strconv.FormatInt(time.Now().UnixNano(),10))
		if renameErr:=os.Rename(target,oldBackup);renameErr==nil {
			defer os.RemoveAll(oldBackup)
		} else {
			_ = os.RemoveAll(target)
		}
	}
	if err=os.Rename(stage,target);err!=nil{return "",err}
	return target,nil
}
func main() {
 mcp:=len(os.Args)==2&&os.Args[1]=="--mcp"
 if len(os.Args)>1&&!mcp {showError("Argumento não reconhecido.");os.Exit(1)}
 err:=run(mcp)
 if err!=nil {if mcp {fmt.Fprintln(os.Stderr,"WhatsApp Manutenção: não foi possível iniciar a conexão local.")} else {showError(err.Error())};os.Exit(1)}
}
func run(mcp bool)error {
 own,err:=os.Executable();if err!=nil{return errors.New("Não foi possível localizar o aplicativo.")}
 self,err:=os.Open(own);if err!=nil{return err};defer self.Close()
 archive,err:=openPayload(self);if err!=nil{return err}
 if err=validateMembers(archive);err!=nil{return err}
 root,err:=install(self,archive);if err!=nil{return err}
 script:="open-desktop.mjs";if mcp{script="desktop-stdio.mjs"}
 command:=exec.Command(filepath.Join(root,"runtime","node.exe"),filepath.Join(root,"whatsapp-manutencao","scripts",script))
 command.Dir=filepath.Join(root,"whatsapp-manutencao");command.Env=minimalEnv();hideProcess(command)
 if mcp {command.Stdin=os.Stdin;command.Stdout=os.Stdout;command.Stderr=os.Stderr;return command.Run()}
 output,err:=command.Output();if err!=nil{return errors.New("Não foi possível abrir o painel local. Feche outras instâncias e tente novamente.")}
 var reply struct {URL string `json:"url"`}
 if json.Unmarshal(output,&reply)!=nil||!regexp.MustCompile(`^http://127\.0\.0\.1:[0-9]{1,5}/#[a-f0-9]{64}$`).MatchString(reply.URL){return errors.New("A resposta local não passou na verificação.")}
 createShortcut(filepath.Join(root,executableName))
 return openBrowser(reply.URL)
}
