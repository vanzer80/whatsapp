'use strict';
const $=id=>document.getElementById(id);
let token=location.hash.slice(1),busy=false,current=null,choices=[],selection=new Set(),loadedChoices=false;
if(/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem('wa-local-token',token);history.replaceState(null,'',location.pathname);}else token=sessionStorage.getItem('wa-local-token');
const notice=message=>{$('notice').textContent=message;$('notice').hidden=!message;};
async function api(endpoint,input) {
  const options={headers:{Authorization:`Bearer ${token}`},cache:'no-store'};
  if(input!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(input);}
  const response=await fetch('/api/'+endpoint,options);const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Não foi possível concluir a etapa.');return data;
}
function section(name){for(const e of document.querySelectorAll('main>section'))e.hidden=e.id!==name;}
function renderChoices(){
  const list=$('chat-list');list.replaceChildren();
  const filter=$('filter').value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const visible=choices.filter(c=>c.name.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().includes(filter));
  for(const c of visible){const label=document.createElement('label');label.className='chat-row';
    const check=document.createElement('input');check.type='checkbox';check.checked=selection.has(c.id);check.disabled=busy||(!check.checked&&selection.size>=30);
    check.addEventListener('change',()=>{check.checked?selection.add(c.id):selection.delete(c.id);renderChoices();});
    const text=document.createElement('div'),name=document.createElement('span'),kind=document.createElement('span');
    name.className='chat-name';name.textContent=c.name||'Conversa sem nome';kind.className='chat-kind';kind.textContent=(c.group?'Grupo':'Contato')+' · '+c.id;
    text.append(name,kind);label.append(check,text);list.append(label);
  }
  if(!visible.length){const p=document.createElement('p');p.className='empty';p.textContent='Nenhuma conversa encontrada.';list.append(p);}
  $('selection-count').textContent=selection.size?`${selection.size} de 30 selecionadas`:'Nenhuma selecionada';
  $('authorize').disabled=busy||selection.size===0;
}
async function refresh(){
  if(!token){section('unavailable');$('unavailable-text').textContent='Abra esta tela pelo aplicativo WhatsApp Manutenção no computador.';return;}
  try {
    const state=await api('status');current=state;
    let phase=state.phase;if(!state.browser_available&&phase==='welcome')phase='error';
    section(phase==='syncing'?'connecting':phase);
    const index={welcome:0,connecting:1,pairing:1,syncing:1,choose:2,ready:3,blocked:0,error:0}[phase]??0;
    document.querySelectorAll('.steps li').forEach((e,i)=>{e.classList.toggle('active',i===index);e.classList.toggle('done',i<index);});
    if(phase==='pairing'&&state.qr_svg)$('qr-image').src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(state.qr_svg);
    else $('qr-image').removeAttribute('src');
    if(phase==='choose'&&!loadedChoices){choices=(await api('chats')).chats;selection.clear();loadedChoices=true;renderChoices();}
    if(phase!=='choose')loadedChoices=false;
    if(phase==='ready'){
      $('allowed-count').textContent=`${state.allowed_count} conversa${state.allowed_count===1?'':'s'}`;
      $('mcp-status').textContent=state.last_mcp_seen?'Conexão reconhecida pelo assistente':'Aguardando o ChatGPT reconhecer a conexão';
      $('mcp-dot').classList.toggle('active',Boolean(state.last_mcp_seen));

      // Indicadores dos 4 estados
      const waConn=Boolean(state.connected);
      $('st-wa-dot').style.background=waConn?'#328c62':'#c94a29';
      $('st-wa-text').textContent=waConn?'Conectado':'Desconectado';

      const authOk=state.allowed_count>0;
      $('st-auth-dot').style.background=authOk?'#328c62':'#aaa';
      $('st-auth-text').textContent=authOk?`${state.allowed_count} liberada${state.allowed_count===1?'':'s'}`:'Pendente';

      const tunnelOn=Boolean(state.public_url);
      $('st-tunnel-dot').style.background=tunnelOn?'#328c62':'#aaa';
      $('st-tunnel-text').textContent=tunnelOn?'Ativo':'Desativado';

      const extOk=Boolean(state.external_query_confirmed);
      $('st-ext-dot').style.background=extOk?'#328c62':'#aaa';
      $('st-ext-text').textContent=extOk?'Confirmada':'Aguardando';

      $('toggle-tunnel').textContent=tunnelOn?'Desativar Conexão Remota':'Ativar Conexão Remota';
      $('toggle-tunnel').className=tunnelOn?'secondary':'primary';
      $('copy-gpt-schema').hidden=!tunnelOn;
      $('tunnel-info').hidden=!tunnelOn;
      if(tunnelOn)$('tunnel-url-display').textContent=state.public_url;
    }
    if(phase==='error'){
      $('error-message').textContent=!state.browser_available?'Instale o Google Chrome para conectar o WhatsApp neste computador.':state.error||'Confira sua internet e tente novamente.';
      $('chrome-help').hidden=state.browser_available;
    }
  }catch(error){section('unavailable');$('unavailable-text').textContent=error.message==='Failed to fetch'?'A conexão local foi encerrada. Abra novamente o aplicativo WhatsApp Manutenção.':error.message;}
}
async function act(endpoint,input={}) {
  if(busy)return;busy=true;notice('');document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await api(endpoint,input);await refresh();}catch(error){notice(error.message);}
  finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);$('authorize').disabled=selection.size===0;if(current?.phase==='choose')renderChoices();}
}
$('setup').addEventListener('click',()=>act('setup'));
$('reconnect').addEventListener('click',()=>act(current?.registered?'connect':'setup'));
$('retry').addEventListener('click',()=>act(current?.registered?'connect':'setup'));
$('edit').addEventListener('click',()=>act('edit'));
$('authorize').addEventListener('click',()=>act('authorize',{chat_ids:[...selection]}));
$('filter').addEventListener('input',renderChoices);
for(const b of document.querySelectorAll('.block'))b.addEventListener('click',()=>act('block'));
$('switch-account')?.addEventListener('click',async()=>{
  if(confirm('Deseja realmente desconectar a conta atual e parear um novo número?')) {
    await act('switch-account');
  }
});
$('toggle-tunnel')?.addEventListener('click',async()=>{
  if(current?.public_url)await act('tunnel/stop');
  else await act('tunnel/start');
});
$('copy-gpt-schema')?.addEventListener('click',async()=>{
  if(!current?.public_url)return;
  const schemaUrl=`${current.public_url}/gpt/openapi.json`;
  try{await navigator.clipboard.writeText(schemaUrl);notice('URL do Schema OpenAPI copiada com sucesso!');}
  catch{notice('URL do Schema: '+schemaUrl);}
});
$('copy-prompt').addEventListener('click',async()=>{
  const prompt='Verifique a conexão WhatsApp Manutenção e liste as conversas que autorizei.';
  try{await navigator.clipboard.writeText(prompt);notice('Pedido copiado. Cole em uma conversa nova no ChatGPT para Windows.');}
  catch{notice('No ChatGPT, peça: '+prompt);}
});
$('copy-gpt-token')?.addEventListener('click',async()=>{
  if(!current?.gpt_token)return;
  try{await navigator.clipboard.writeText(current.gpt_token);notice('Chave do GPT copiada com sucesso!');}
  catch{notice('Chave da API: '+current.gpt_token);}
});
void refresh();setInterval(()=>{if(!busy)void refresh();},1500);
