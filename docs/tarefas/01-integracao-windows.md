# P0 — Confirmar integração real no ChatGPT para Windows

**Estado:** a fazer. Rascunho de issue; ainda sem responsável ou issue remota.

## Problema

A edição do `config.toml` foi testada com arquivos temporários, mas o aplicativo ChatGPT para Windows ainda não foi usado para reconhecer essa conexão. A arquitetura depende dessa compatibilidade.

## Trabalho

Em um Windows de teste, registrar a versão do ChatGPT e verificar o mecanismo suportado de MCP local. Executar o fluxo previsto de registro preservando as configurações existentes. Usar uma conta WhatsApp de teste e uma conversa previamente autorizada. Se o mecanismo diferir do previsto, documentar a incompatibilidade antes de ajustar o código.

## Aceitação

- [ ] Versões do Windows e do ChatGPT registradas.
- [ ] Configuração original preservada e cópia anterior disponível.
- [ ] ChatGPT reconhece o MCP após o procedimento indicado ao usuário.
- [ ] Apenas `get_status`, `list_chats`, `read_messages` e `search_messages` são anunciadas.
- [ ] Consulta autorizada retorna dados simulados da conta de teste.
- [ ] Conversa não autorizada é recusada.
- [ ] Nenhuma política do aplicativo ou da organização foi desativada.

Arquivos de referência: `src/desktop-registration.mjs`, `scripts/desktop-stdio.mjs`, `src/desktop-service.mjs`.
