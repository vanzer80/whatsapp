export const ACCOUNT = '550000000009@c.us';
export const GROUP = '120000000001@g.us';
export const PRIVATE = '550000000001@c.us';
export const LOCKED = '550000000002@c.us';
export function fixtures() {
  const chats = [
    {id:{_serialized:GROUP},name:'Manutenção São José — DADOS SIMULADOS',isGroup:true,unreadCount:2,timestamp:1789140000},
    {id:{_serialized:PRIVATE},name:'Fornecedor de teste',isGroup:false,unreadCount:0,timestamp:1789130000},
    {id:{_serialized:LOCKED},name:'Conversa bloqueada de teste',isLocked:true},
    {id:{_serialized:'status@broadcast'},name:'Status'}
  ];
  const messages = [
    {id:{_serialized:'fixture-1'},body:'SIMULADO: filtro do ar-condicionado pendente.',timestamp:1789128000,from:PRIVATE,type:'chat'},
    {id:{_serialized:'fixture-2'},body:'SIMULADO: orçamento da manutenção enviado.',timestamp:1789131600,author:PRIVATE,type:'chat'},
    {id:{_serialized:'fixture-3'},body:'SIMULADO: aguardar visita; não resolvido.',timestamp:1789135200,fromMe:true,from:'550000000009@c.us',to:GROUP,type:'chat'},
    {id:{_serialized:'fixture-4'},body:'SIMULADO: imagem de equipamento',timestamp:1789138800,hasMedia:true,type:'image',from:PRIVATE}
  ];
  const calls=[];
  return {
    calls, sourceMessages:messages,
    state:'ready',
    accountId() { return ACCOUNT; },
    status() {return {connected:this.state==='ready',state:this.state};},
    async chats(){calls.push('chats');return chats;},
    async chat(id){calls.push(['chat',id]);return chats.find(c=>c.id._serialized===id);},
    async messages(chat,limit){calls.push(['messages',chat.id._serialized,limit]);return messages.slice(-limit);},
    async sendMessage(id,text){calls.push(['sendMessage',id,text]);return {id:{_serialized:'sent-fixture-1'}};},
    async createGroup(name,ids){calls.push(['createGroup',name,ids]);return {gid:{_serialized:'120000000099@g.us'},title:name};},
    async updateGroup(id,changes){calls.push(['updateGroup',id,changes]);},
    async manageGroupParticipants(id,action,ids){calls.push(['manageGroupParticipants',id,action,ids]);}
  };
}

export function fixtureAccess(ids = [GROUP, PRIVATE, LOCKED], scopes = null) {
  const policy = scopes ? { version:2, account_id:ACCOUNT, allowed_chat_ids:ids, scopes, revision:'00000000-0000-0000-0000-000000000001' } :
    { version:1, account_id:ACCOUNT, allowed_chat_ids:ids, revision:'00000000-0000-0000-0000-000000000001' };
  return { snapshot(account) { return account === ACCOUNT && ids.length ? policy : null; },
    unchanged(snapshot, account) { return account === ACCOUNT && snapshot === policy; } };
}
