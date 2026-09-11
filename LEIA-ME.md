# WhatsApp Manutenção 0.3.0 — em desenvolvimento

**Este pacote contém o código do projeto. Ainda não é o aplicativo pronto para baixar e executar. Nenhum instalador `.exe` foi gerado nesta etapa.**

A versão está sendo preparada para o aplicativo do ChatGPT no Windows, conforme combinado. O fluxo previsto é:

1. Abrir um único arquivo e clicar em **Preparar e conectar**.
2. Escanear o QR code pelo WhatsApp do celular.
3. Escolher as conversas que o assistente poderá consultar.
4. Reabrir o ChatGPT para Windows e pedir a primeira consulta.

A tela terá os botões **Alterar conversas** e **Bloquear acesso**. O aplicativo deve cuidar da instalação dos componentes, do registro da conexão e dos segredos locais automaticamente. Não há túnel nem chave de API para o usuário configurar.

O código da interface, da conexão local e das autorizações já foi escrito. A montagem do executável e os testes completos no Windows ainda estão pendentes. A obtenção dos componentes de compilação foi bloqueada pela revisão automática das ferramentas, que informou limite de uso; este ambiente também impediu abrir o servidor local para os testes de integração.

O funcionamento final requer Windows x64, Google Chrome e o aplicativo do ChatGPT para Windows com suporte a MCP local. A autenticação do WhatsApp será feita pelo próprio usuário, no celular. A versão web do ChatGPT não é o destino desta versão.

Detalhes do trabalho e das verificações: `RELATORIO-VALIDACAO.md`. Instruções de compilação, destinadas ao desenvolvimento: `DESENVOLVIMENTO.md`.
