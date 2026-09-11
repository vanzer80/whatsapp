package main

import("archive/zip";"bytes";"os";"path/filepath";"testing")
func testZip(t *testing.T,files map[string]string)*zip.Reader{t.Helper();var buffer bytes.Buffer;writer:=zip.NewWriter(&buffer);for name,body:=range files{entry,e:=writer.Create(name);if e!=nil{t.Fatal(e)};entry.Write([]byte(body))};writer.Close();result,e:=zip.NewReader(bytes.NewReader(buffer.Bytes()),int64(buffer.Len()));if e!=nil{t.Fatal(e)};return result}
func TestRejectTraversal(t *testing.T){for _,name:=range []string{"../escape","/absolute","C:/Windows/x","a\\b","a/../b"}{if validateMembers(testZip(t,map[string]string{name:"data"}))==nil{t.Fatal("unsafe path accepted",name)}}}
func TestRejectCaseCollision(t *testing.T){if validateMembers(testZip(t,map[string]string{"a.txt":"a","A.txt":"b"}))==nil{t.Fatal("case collision accepted")}}
func TestExtractAndVerify(t *testing.T){archive:=testZip(t,map[string]string{"app/main.js":"safe","runtime/node.exe":"fixture"});directory:=t.TempDir();if e:=extractArchive(archive,directory);e!=nil{t.Fatal(e)};if e:=verifyInstall(archive,directory);e!=nil{t.Fatal(e)};os.WriteFile(filepath.Join(directory,"app","main.js"),[]byte("evil"),0600);if verifyInstall(archive,directory)==nil{t.Fatal("changed file accepted")}}
func TestRejectExtraFile(t *testing.T){archive:=testZip(t,map[string]string{"main.js":"safe"});directory:=t.TempDir();extractArchive(archive,directory);os.WriteFile(filepath.Join(directory,"evil.dll"),[]byte("evil"),0600);if verifyInstall(archive,directory)==nil{t.Fatal("extra executable accepted")}}
