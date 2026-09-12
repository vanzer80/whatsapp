# WhatsApp Manutenção 0.3.0 — Instruções de Uso

Aplicativo para consultar conversas autorizadas do WhatsApp pelo ChatGPT no aplicativo para Windows, no navegador Web e no aplicativo para celular (iOS / Android).

## Como Usar no Windows (Sem Comandos ou Instalação de Node)

1. Baixe o arquivo `whatsapp-manutencao.exe` (ou descompacte `whatsapp-manutencao-windows-x64.zip`).
2. Dê um duplo clique em `whatsapp-manutencao.exe`.
3. A tela do aplicativo abrirá automaticamente no seu navegador padrão:
   - Clique em **Conectar**.
   - No celular, abra o WhatsApp > **Aparelhos conectados** > **Conectar um aparelho**.
   - Aponte a câmera para o QR Code exibido na tela.
4. Após conectar, selecione na lista as conversas que você autoriza o ChatGPT a consultar (até 30 conversas) e clique em **Autorizar conversas**.

---

## Consultando pelo ChatGPT

### 1. No ChatGPT Desktop para Windows (MCP Local)
- O aplicativo registra a conexão diretamente nas configurações locais do ChatGPT.
- Abra o aplicativo do ChatGPT no Windows e pergunte sobre as conversas autorizadas (ex: *"Quais conversas estão autorizadas?"* ou *"Pesquise mensagens recentes sobre manutenção na conversa X"*).
- Não é necessário internet aberta ou túnel: a comunicação ocorre diretamente no seu computador.

### 2. No ChatGPT no Navegador (Web) e no Celular (iOS e Android)
- No painel do WhatsApp Manutenção, clique em **Iniciar Túnel**.
- O painel exibirá o endereço público HTTPS gerado (ex: `https://...trycloudflare.com/gpt/openapi.json`) e o seu **Token de Acesso**.
- No ChatGPT (Web ou Celular):
  1. Vá em **Explorar GPTs** > **Criar** (ou edite seu GPT existente).
  2. Na aba **Configurar**, vá em **Ações** > **Criar nova ação**.
  3. Clique em **Importar de URL** e cole a URL do schema exibida no painel.
  4. Em **Autenticação**, selecione **Chave de API**, tipo **Bearer**, e cole o Token de Acesso fornecido pelo painel.
  5. Salve o GPT. Agora você pode consultar suas conversas autorizadas pelo celular ou qualquer navegador.

> **Importante sobre o endereço:** O túnel rápido gratuito gera um endereço temporário que muda se o aplicativo for reiniciado. Se você deseja um endereço fixo sem precisar atualizar o GPT ao reiniciar, configure um token de túnel nomeado Cloudflare nas opções do sistema (`CLOUDFLARE_TUNNEL_TOKEN`).

---

## Troca de Número e Desconexão

- **Trocar de número / conta:** Clique no botão **Trocar de número** no painel. O aplicativo encerrará a conexão atual, revogará as autorizações anteriores, limpará com segurança a sessão salva e exibirá imediatamente um novo QR Code para parear o novo número.
- **Bloquear acesso:** O botão **Bloquear acesso** cancela imediatamente qualquer autorização concedida e interrompe consultas em andamento.

