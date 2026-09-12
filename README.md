# WhatsApp Manutenção

Aplicativo local para permitir ao ChatGPT (no Windows Desktop, Navegador Web e Celular) consultar conversas do WhatsApp previamente autorizadas pelo usuário com controle estrito de privacidade.

**Estado: Versão 0.3.0 concluída, empacotada e homologada no Windows x64.** O executável único standalone (`whatsapp-manutencao.exe`), o suporte híbrido a MCP local (Desktop) e Custom GPT Actions (Web e Mobile), o túnel Cloudflare gerenciado com integridade criptográfica, a proteção de pastas NTFS e a automação de testes foram implementados e validados.

## Experiência do Usuário

O usuário final não precisa instalar Node.js, Git, Python ou configurar variáveis de ambiente e processos de terminal:

1. Baixe e execute o aplicativo standalone `whatsapp-manutencao.exe`.
2. O painel local abre automaticamente no navegador padrão com interface em português.
3. Clique em **Conectar**, aponte a câmera do WhatsApp no celular para o QR Code na tela.
4. Selecione as conversas desejadas (limite seguro de até 30 conversas) e clique em **Autorizar conversas**.
5. Consulte suas mensagens no ChatGPT:
   - **ChatGPT Desktop (Windows)**: O assistente conecta-se automaticamente via MCP local (arquivo de configuração atualizado de forma idempotente).
   - **ChatGPT Web e Celular (iOS / Android)**: Clique em **Iniciar Túnel** no painel, copie a URL do OpenAPI Schema (`https://<seu-tunel>.trycloudflare.com/gpt/openapi.json`) e o Token de Acesso exibido e configure a GPT Action no seu Custom GPT na OpenAI.

A interface permite revogar acessos a qualquer momento, pausar/iniciar o túnel público e realizar a **Troca de número / Conta** com um clique, limpando cirurgicamente apenas a sessão do aplicativo e gerando novo QR Code sem afetar dados do sistema.

## Clientes Suportados e Arquitetura de Integração

| Cliente ChatGPT | Tipo de Integração | Transporte | Requisitos de Rede |
| :--- | :--- | :--- | :--- |
| **ChatGPT Desktop (Windows)** | MCP Local (Model Context Protocol) | stdio / Named Pipe local (`scripts/stdio.mjs`) | Somente local (`127.0.0.1`), sem necessidade de túnel externo ou internet aberta. |
| **ChatGPT Web (chatgpt.com)** | Custom GPT Actions (OpenAPI 3.1.0) | HTTPS REST com Bearer Token | Túnel HTTPS público (`cloudflared`) ativo apontando para o serviço local. |
| **ChatGPT Mobile (iOS / Android)** | Custom GPT Actions (OpenAPI 3.1.0) | HTTPS REST com Bearer Token | Mesmo Custom GPT configurado com o túnel HTTPS público. |

> [!NOTE]
> **Continuidade do Túnel:** A inicialização padrão utiliza *Cloudflare Quick Tunnels* (`trycloudflare.com`), cujo endereço expira ao reiniciar o processo. Para um endereço fixo que dispense reconfiguração do schema no ChatGPT, defina a variável `CLOUDFLARE_TUNNEL_TOKEN` com um túnel nomeado da sua conta Cloudflare.

## Segurança e Privacidade

- **Leitura Estrita e Sem Escrita:** A API expõe apenas 4 ferramentas de leitura (`get_status`, `list_chats`, `read_messages`, `search_messages`). Nenhuma operação de envio, exclusão ou alteração de mensagens é implementada ou anunciada.
- **Isolamento de Contas e Sessões:** Dados de sessão residem exclusivamente na pasta de dados protegida (`%LOCALAPPDATA%\WhatsAppManutencaoSegura\session-maintenance`) com DACLs NTFS restritas ao usuário atual. A ação de troca de conta apaga cirurgicamente apenas essa pasta.
- **Integridade Criptográfica do cloudflared:** O executável do túnel é baixado com versão fixada (`2026.9.1`), salvo em arquivo temporário e só é promovido ao destino final após validação estrita do hash SHA-256 (`2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712` no Windows x64).
- **Proteção contra Exfiltração e DoS:** Respostas JSON possuem teto rígido de 32 KB, corpos de requisição são limitados a 16 KB e mensagens de erro internas do provedor são sanitizadas antes de serem retornadas pela API pública.
- **Sincronização Dinâmica da URL Pública:** O endpoint `/gpt/openapi.json` e as chamadas ao serviço refletem a URL pública validada pelo túnel, sem aceitar cabeçalhos arbitrários não confiáveis de terceiros.

## Resultados dos Testes Automatizados

Execução em Windows 11 x64 com Node >= 22.12.0:
- **Suíte Node.js (`npm test`):** 80 testes (77 aprovados, 0 falhas, 3 skips de permissões e links específicos de POSIX/Linux). Duração: ~44 segundos.
- **Suíte Go Launcher (`go test ./...`):** 4 testes aprovados (rejeição de path traversal, colisão de case, extração segura com integridade e rejeição de arquivos estranhos).
- **Compilação e Empacotamento (`package.py`):** Executável standalone gerado com sucesso (~52.5 MB) contendo runtime Node >= 22.12.0 embutido, payload compactado e trailer criptográfico SHA-256.

## Como Desenvolver e Compilar

Requisitos para desenvolvimento: Node.js >= 22.12.0, Go 1.22+ e Python 3.10+.

```sh
# Instalar dependências limpas
npm ci --ignore-scripts --no-audit --no-fund

# Executar suíte completa de testes
npm test

# Executar testes unitários do launcher Go
cd launcher && go test -v ./... && cd ..

# Gerar executável standalone e pacote de release
py -3 scripts/package.py
```

Artefatos gerados na pasta `dist/`:
- `dist/whatsapp-manutencao.exe`: Executável standalone Windows x64 pronto para uso.
- `dist/whatsapp-manutencao-windows-x64.zip`: Pacote de distribuição com executável e documentação.

