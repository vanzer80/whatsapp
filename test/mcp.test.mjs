import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { GROUP } from './fixtures.mjs';

async function withClient(fn, args=[]) {
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./fixture-server.mjs',import.meta.url)),...args],stderr:'pipe'});
  const client=new Client({name:'integration-test',version:'1.0.0'});
  try { await client.connect(transport); await fn(client); }
  finally { await client.close(); }
}
test('MCP por stdio anuncia somente quatro ferramentas de leitura e consulta dados',async()=>{
  await withClient(async client=>{
    const result=await client.listTools();
    assert.deepEqual(result.tools.map(t=>t.name).sort(),['get_status','list_chats','read_messages','search_messages']);
    assert.ok(result.tools.every(t=>t.annotations.readOnlyHint&&!t.annotations.destructiveHint));
    assert.equal((await client.callTool({name:'get_status',arguments:{}})).structuredContent.connected,true);
    const messages=await client.callTool({name:'read_messages',arguments:{chat_id:GROUP,limit:1}});
    assert.equal(messages.structuredContent.messages[0].text,'SIMULADO: imagem de equipamento');
  });
});
test('MCP rejeita parâmetros inválidos e não anuncia envio',async()=>{
  await withClient(async client=>{
    const invalid=await client.callTool({name:'read_messages',arguments:{chat_id:GROUP,limit:9999}});
    assert.equal(invalid.isError,true);
    const unknown=await client.callTool({name:'send_message',arguments:{}});
    assert.equal(unknown.isError,true);
  });
});
test('erro do provedor não vaza detalhes internos pela resposta MCP',async()=>{
  await withClient(async client=>{
    const result=await client.callTool({name:'list_chats',arguments:{}});
    assert.equal(result.isError,true);
    assert.equal(result.structuredContent.error.code,'READ_FAILED');
    assert.doesNotMatch(JSON.stringify(result),/SECRET_FIXTURE/);
  },['--fail']);
});

test('limite MCP considera as duas representações e escapes do protocolo',async()=>{
  const {mcpResult}=await import('../src/server.mjs');
  const result=mcpResult({messages:Array.from({length:50},()=>({text:'\u0000😀'.repeat(1000)})),result_truncated:false});
  assert.ok(Buffer.byteLength(JSON.stringify(result),'utf8')<=32768);
  assert.equal(result.structuredContent.result_truncated,true);
  assert.ok(result.structuredContent.messages.length>0);
  assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);
});

test('entrada MCP real inicia bloqueada, ignora acesso antigo por ambiente e não expõe chave',async t=>{
  const {mkdtempSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const path=await import('node:path');
  const dir=mkdtempSync(path.join(tmpdir(),'wa-stdio-test-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const transport=new StdioClientTransport({command:process.execPath,
    args:[fileURLToPath(new URL('../scripts/stdio.mjs',import.meta.url))],
    env:{...process.env,LOCALAPPDATA:dir,WA_ALLOWED_CHAT_IDS:GROUP,CONTROL_PLANE_API_KEY:'TEST_SECRET_NOT_A_REAL_KEY'},stderr:'pipe'});
  const client=new Client({name:'security-integration-test',version:'1.0.0'});
  try {
    await client.connect(transport);
    const result=await client.callTool({name:'get_status',arguments:{}});
    assert.equal(result.structuredContent.state,'access_not_configured');
    assert.equal(result.structuredContent.access_enabled,false);
    assert.equal(result.structuredContent.connected,false);
    assert.doesNotMatch(JSON.stringify(result),/TEST_SECRET/);
    const blocked=await client.callTool({name:'list_chats',arguments:{}});
    assert.equal(blocked.isError,true);
  } finally { await client.close(); }
});
test('MCP com Writer anuncia leitura e escrita e executa envio idempotente',async()=>{
  await withClient(async client=>{
    const result=await client.listTools();
    assert.deepEqual(result.tools.map(t=>t.name).sort(),[
      'create_group','get_status','list_chats','manage_group_participants',
      'read_messages','search_messages','send_message','update_group'
    ]);
    const send=await client.callTool({name:'send_message',arguments:{chat_id:GROUP,text:'SIMULADO MCP',idempotency_key:'mcp-send-0001'}});
    assert.equal(send.isError,undefined);
    assert.equal(send.structuredContent.ok,true);
    assert.equal(typeof send.structuredContent.message_id,'string');
  },['--writer']);
});
