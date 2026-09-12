#!/usr/bin/env node
/**
 * Inicia o túnel seguro para uso do WhatsApp Manutenção no Custom GPT
 * (celular, navegador e aplicativo ChatGPT).
 */

import { ensureRunning, readDiscovery } from '../src/desktop-process.mjs';
import { getOrCreateGptToken, startCloudflareTunnel } from '../src/gpt-tunnel.mjs';
import { dataDirectory } from '../src/local-security.mjs';

console.log('='.repeat(70));
console.log('WhatsApp Manutenção — Conexão Remota para Custom GPT');
console.log('='.repeat(70));
console.log('\n[1/3] Verificando serviço local...');

const discovery = await ensureRunning();
const port = new URL(discovery.origin).port;
console.log(`✓ Serviço local ativo na porta ${port}`);

const gptToken = getOrCreateGptToken();
console.log('✓ Chave de autenticação Bearer Token carregada com segurança.');

console.log('\n[2/3] Estabelecendo túnel HTTPS criptografado com Cloudflare...');
try {
  const tunnel = await startCloudflareTunnel({ localPort: port });
  console.log(`✓ Túnel conectado com sucesso: ${tunnel.url}`);

  // Comunica a URL pública validada ao serviço local
  try {
    const notifyRes = await fetch(`${discovery.origin}/api/tunnel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${discovery.ui_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: tunnel.url })
    });
    if (!notifyRes.ok) {
      console.warn('Aviso: O serviço local recusou a atualização da URL pública.');
    } else {
      console.log('✓ URL pública sincronizada com sucesso no serviço local.');
    }
  } catch (err) {
    console.warn('Aviso: Falha ao sincronizar URL pública com o serviço local:', err.message);
  }

  console.log('\n' + '='.repeat(70));
  console.log('CONFIGURAÇÃO DO CUSTOM GPT NO CHATGPT (Celular e Navegador)');
  console.log('='.repeat(70));
  console.log('\nPasso 1: No ChatGPT (navegador ou app):');
  console.log('  -> Vá em "Explorar GPTs" > "+ Criar" (ou editar seu GPT).');
  console.log('  -> Na aba "Configurar", role até o final e clique em "Criar nova ação".');
  console.log('\nPasso 2: Importar o Schema OpenAPI:');
  console.log('  -> Em "Esquema", você pode colar diretamente esta URL ou importar dela:');
  console.log(`     ${tunnel.url}/gpt/openapi.json`);
  console.log('\nPasso 3: Configurar a Autenticação:');
  console.log('  -> Em "Autenticação", selecione: "Chave da API" (API Key).');
  console.log('  -> Tipo de autenticação: "Bearer".');
  console.log('  -> Chave da API:');
  console.log(`     ${gptToken}`);
  console.log('\nPasso 4: Salvar e Usar:');
  console.log('  -> Salve o GPT ("Somente eu" ou compartilhe com quem quiser).');
  console.log('  -> Agora basta abrir esse GPT no seu celular (iPhone ou Android) ou');
  console.log('     no navegador web e pedir:');
  console.log('     "Liste as conversas autorizadas e me diga as últimas mensagens."');
  console.log('='.repeat(70));
  console.log('\n[3/3] Túnel em execução contínua. Pressione Ctrl+C para encerrar.');

  process.on('SIGINT', () => {
    console.log('\nEncerrando túnel...');
    tunnel.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    tunnel.close();
    process.exit(0);
  });
} catch (err) {
  console.error('\n❌ Falha ao iniciar o túnel:', err.message);
  process.exit(1);
}
