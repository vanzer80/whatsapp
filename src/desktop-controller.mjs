import { createRequire } from 'node:module';
import { Reader } from './core.mjs';
import { AccessStore, savePolicy, validChatId } from './access.mjs';
import { writePrivateJson } from './local-security.mjs';
import { WhatsAppProvider, chromePath, clearSessionMaintenance } from './provider.mjs';

const require=createRequire(import.meta.url);
const QRCode=require('qrcode-terminal/vendor/QRCode');
const levels=require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
export function qrSvg(value) {
  if(typeof value!=='string'||value.length>4096)throw new Error('Código de conexão inválido.');
  const code=new QRCode(-1,levels.M);code.addData(value);code.make();
  const count=code.getModuleCount();let drawing='';
  for(let y=0;y<count;y++)for(let x=0;x<count;x++)if(code.isDark(y,x))drawing+=`M${x+4} ${y+4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count+8} ${count+8}" shape-rendering="crispEdges"><path fill="white" d="M0 0h${count+8}v${count+8}H0z"/><path fill="black" d="${drawing}"/></svg>`;
}
const safeName=value=>String(value??'').replace(/\p{C}/gu,' ').slice(0,180);
export class DesktopController {
  constructor({access=new AccessStore(),providerFactory=opts=>new WhatsAppProvider(opts),browserAvailable=()=>Boolean(chromePath())}={}) {
    this.access=access;this.providerFactory=providerFactory;this.browserAvailable=browserAvailable;
    this.provider=null;this.phase='welcome';this.qr=null;this.error=null;this.choices=[];this.generation=0;this.timer=null;this.changing=false;
    this.reader=new Reader({
      status:()=>this.provider?.status()??{connected:false,state:'not_started'},
      accountId:()=>this.provider?.accountId()??null,
      chat:id=>this.provider.chat(id),messages:(chat,limit)=>this.provider.messages(chat,limit)
    },{access});
  }
  status() {
    const policy=this.access.snapshot(this.provider?.accountId());
    return {phase:this.phase,connected:Boolean(this.provider?.status().connected),allowed_count:policy?.allowed_chat_ids.length??0,
      browser_available:this.browserAvailable(),error:this.error,version:'0.3.0',qr_svg:this.qr?qrSvg(this.qr):null};
  }
  revoke() {
    const previous=this.access.load();
    if(previous)savePolicy(previous.account_id,[],this.access.file);
    else writePrivateJson(this.access.file,{});
  }
  async connect({interactive=true}={}) {
    if(this.changing || ['connecting','pairing','syncing'].includes(this.phase))return;
    this.changing=true;
    const generation=++this.generation;
    try {
      if(interactive)this.revoke();
      if(this.provider)await this.provider.close();
      if(generation!==this.generation)return;
      this.error=null;this.qr=null;this.choices=[];this.phase='connecting';
      const provider=this.providerFactory({pairing:interactive,headless:true,
        onQr:qr=>{if(generation===this.generation){this.qr=qr;this.phase='pairing';}},
        onReady:()=>{void this.ready(provider,generation,interactive).catch(()=>this.fail(generation));},
        onDisconnected:()=>{if(generation===this.generation)this.fail(generation,'A sessão do WhatsApp foi desconectada. Clique em Tentar novamente para conectar.');}
      });
      this.provider=provider;
      clearTimeout(this.timer);
      this.timer=setTimeout(()=>this.fail(generation,'A conexão demorou mais que o esperado. Clique em Tentar novamente.'),180000);
      this.timer.unref?.();
      void provider.start().then(()=>{
        if(generation===this.generation && provider.closed && this.phase!=='ready' && this.phase!=='choose')this.fail(generation,'A sessão precisa ser conectada novamente.');
      }).catch(()=>this.fail(generation));
    } finally {this.changing=false;}
  }
  fail(generation,message='Não foi possível conectar ao WhatsApp. Confira a internet e o Google Chrome e tente novamente.') {
    if(generation!==this.generation)return;
    ++this.generation;
    clearTimeout(this.timer);this.qr=null;this.phase='error';this.error=message;
    const provider=this.provider;this.provider=null;
    void provider?.close().catch(()=>{});
  }
  async ready(provider,generation,interactive) {
    if(generation!==this.generation)return;
    clearTimeout(this.timer);this.qr=null;
    if(!interactive && this.access.snapshot(provider.accountId())){this.phase='ready';return;}
    // An unexpected account never inherits a previous account's authorizations.
    this.revoke();
    await this.loadChoices(provider,generation);
  }
  async loadChoices(provider=this.provider,generation=this.generation) {
    if(!provider?.status().connected)throw new Error('Conecte seu WhatsApp primeiro.');
    const chats=await provider.chats();
    if(generation!==this.generation)return;
    this.choices=chats.filter(c=>validChatId(c.id?._serialized)&&!c.isLocked).slice(0,5000)
      .map(c=>({id:c.id._serialized,name:safeName(c.name),group:Boolean(c.isGroup)}))
      .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    this.phase='choose';
  }
  async edit() {
    if(this.changing)throw new Error('Aguarde a operação atual.');
    this.changing=true;
    try {this.revoke();await this.loadChoices();}
    finally {this.changing=false;}
  }
  async authorize(ids) {
    if(this.changing)throw new Error('Aguarde a operação atual.');
    if(this.phase!=='choose'||!this.provider?.status().connected)throw new Error('Conecte o WhatsApp e selecione as conversas.');
    if(!Array.isArray(ids)||ids.length<1||ids.length>30||!ids.every(validChatId)||new Set(ids).size!==ids.length)
      throw new Error('Selecione de 1 a 30 conversas.');
    if(ids.some(id=>!this.choices.some(c=>c.id===id)))throw new Error('A seleção contém uma conversa indisponível.');
    this.changing=true;
    const provider=this.provider,account=provider.accountId(),generation=this.generation;
    try {
      for(const id of ids){const c=await provider.chat(id);if(!c||c.isLocked||c.id?._serialized!==id)throw new Error('Uma conversa selecionada não está mais disponível.');}
      if(generation!==this.generation || provider!==this.provider || account!==provider.accountId() || !provider.status().connected)throw new Error('A conexão mudou. Selecione novamente.');
      savePolicy(account,ids,this.access.file);this.choices=[];this.phase='ready';
    } finally {this.changing=false;}
  }
  async disconnect() {
    ++this.generation;clearTimeout(this.timer);this.qr=null;this.choices=[];this.phase='welcome';
    const provider=this.provider;this.provider=null;
    try {this.revoke();}
    finally {
      if(provider) {
        try {
          await provider.close();
        } catch {}
      }
    }
    // Disconnect cancels this attempt without deleting LocalAuth data. Only an
    // explicit account switch logs out and clears session-maintenance.
  }
  async switchAccount() {
    if(this.changing)throw new Error('Aguarde a operação atual.');
    this.changing=true;
    const generation=++this.generation;clearTimeout(this.timer);this.qr=null;this.choices=[];this.phase='welcome';
    const provider=this.provider;this.provider=null;
    try {
      this.revoke();
      if(provider) {
        try {
          if(typeof provider.logout==='function')await provider.logout();
          else await provider.close();
        } catch {}
      }
      if(generation!==this.generation)return;
      clearSessionMaintenance();
    } finally {this.changing=false;}
    if(generation!==this.generation)return;
    await this.connect({interactive:true});
  }
  async block() {
    ++this.generation;clearTimeout(this.timer);this.qr=null;this.choices=[];this.phase='blocked';
    const provider=this.provider;this.provider=null;
    try {this.revoke();}
    finally {if(provider)await provider.close();}
  }
  async close(){++this.generation;clearTimeout(this.timer);this.qr=null;await this.provider?.close();}
}
