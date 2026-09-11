# Desenvolvimento da versão 0.3.0

Estado em 11/09/2026: fonte preparada, ainda sem executável compilado. Este documento é para quem vai concluir o desenvolvimento; não é uma instalação para o usuário final.

## Componentes e fluxo

- `launcher/`: iniciador Go para Windows x64, com payload ZIP anexado ao executável. Verifica SHA-256 do payload, restringe caminhos de extração, aplica ACL ao diretório do aplicativo e verifica componentes instalados antes de iniciar o Node. Cria atalho na área de trabalho.
- `src/desktop-registration.mjs`: registra exclusivamente o servidor `whatsapp-manutencao` no `~/.codex/config.toml`. Preserva os demais valores e o texto original, cria cópia anterior e recusa conflitos ou TOML inválido.
- `scripts/desktop-service.mjs`: mantém uma única sessão local do WhatsApp e uma tela no navegador padrão. O Chrome de automação usa perfil separado e assinatura Google verificada no Windows.
- `src/desktop-service.mjs`: HTTP em `127.0.0.1`, porta aleatória e token separado do canal MCP. Verifica Host e Origin, restringe CSP, tamanho das solicitações e rotas. QR e nomes de conversas são entregues somente à tela autenticada.
- `scripts/desktop-stdio.mjs`: conecta o ChatGPT ao serviço residente por named pipe no Windows. O token desse canal vem de um arquivo local privado; não existe chave de API a ser criada ou colada pelo usuário.
- `src/desktop-controller.mjs`: pareamento, escolha de até 30 conversas, autorização vinculada à conta e bloqueio. Alterar a seleção revoga a autorização anterior. Callbacks antigos e leituras em andamento são invalidados ao bloquear.
- `src/core.mjs` e `src/server.mjs`: quatro ferramentas somente de leitura. Cada operação revalida a autorização antes de devolver dados; limites de mensagens, tamanho, frequência e concorrência foram preservados.
- `desktop-ui/`: telas em português, com QR, filtro de conversas, controle de acesso e instrução curta para reabrir o ChatGPT.

A configuração local inicia o executável instalado com `--mcp`. Ele encaminha stdio para o Node empacotado. A interface abre um URL local com segredo no fragmento, transferido para sessionStorage e removido do URL pela página. Os segredos são gerados no computador e não precisam de intervenção do usuário. A sessão e as autorizações ficam em `%LOCALAPPDATA%\WhatsAppManutencaoSegura`.

O aplicativo não se registra como serviço do Windows, não exige administrador, não abre porta na rede e não altera firewall, Defender, política de execução ou restrições corporativas. A sessão residente pode continuar após fechar a aba. Bloquear encerra o provedor WhatsApp e revoga a seleção, mas não desconecta definitivamente o aparelho vinculado na conta WhatsApp.

## Preparar uma compilação futura

A revisão automática bloqueou a obtenção dos componentes oficiais por limite de uso. As pastas de componentes estavam vazias quando verificadas. Não há hashes inventados, binários substitutos ou downloads alternativos neste pacote.

1. Em um ambiente de desenvolvimento autorizado e com rede disponível, obter Go oficial e Node **v24.21.0** oficial para Windows x64 e para o sistema de testes. Verificar os arquivos usando os checksums da distribuição oficial. Guardar os URLs, as versões e os hashes verificados. Incluir a licença oficial do Node dessa versão.
2. Preparar dependências a partir de `package-lock.json`, com `npm ci --ignore-scripts --no-audit --no-fund`. Isso é uma etapa de compilação, nunca uma etapa para o usuário final. Não permitir downloads automáticos do Chrome durante o preparo. Revisar as dependências e atualizar a auditoria antes da distribuição.
3. Executar os testes Node em ambiente que permita servidor local. Os testes de sockets marcados como pendentes neste ambiente precisam passar. Executar `go test ./...` dentro de `launcher`.
4. Criar um manifesto local dos componentes verificados no formato abaixo. `node_host.file` aponta para o executável extraído da distribuição oficial para o sistema de testes; seu hash é calculado após verificar o arquivo de distribuição original. `node_license.file` aponta para a licença extraída dessa distribuição já verificada. O manifesto é produzido pelo responsável pela compilação, separado dos arquivos baixados.

```json
{
  "node_version": "v24.21.0",
  "node_windows": {"file": "/caminho/node.exe", "source_url": "https://nodejs.org/dist/v24.21.0/win-x64/node.exe", "sha256": "HASH_VERIFICADO"},
  "node_host": {"file": "/caminho/node", "source_url": "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz", "sha256": "HASH_DO_EXECUTAVEL_EXTRAIDO"},
  "node_license": {"file": "/caminho/LICENSE", "source_url": "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz", "sha256": "HASH_DA_LICENCA_EXTRAIDA"}
}
```

5. Executar o empacotador de desenvolvimento, que não baixa nem instala componentes:

```text
python3 scripts/build-desktop.py --inputs /caminho/componentes.json --go /caminho/go --output /nova/pasta/candidato
```

O script exige que os testes Node não tenham falhas nem testes ignorados, roda os testes Go e compila para Windows x64. O resultado é rotulado **CANDIDATO**, sem assinatura digital, e acompanhado de relatório com as verificações que ainda dependem do Windows. O empacotador também ainda precisa ser executado e validado; sua existência não significa que houve uma compilação bem-sucedida.

Não assinar o executável anexando dados ao final sem adaptar e testar o formato: o iniciador localiza o payload pelos últimos bytes do arquivo. Uma futura assinatura Authenticode deve ser integrada ao formato e validada antes de distribuição.

## Aceitação ainda necessária

- Compilar e executar os testes Go; conferir o PE x64 gerado e o pacote anexado.
- Instalar como usuário comum no Windows, inclusive nome de usuário com espaços e acentos. Conferir ACL, extração, atalho, primeira abertura, segunda abertura e componentes adulterados.
- Testar o Chrome assinado, QR real, reconexão, troca de conta e falhas de rede. Nenhum WhatsApp real foi acessado nesta etapa.
- Confirmar que o ChatGPT para Windows instalado reconhece o registro local e anuncia as quatro ferramentas. Respeitar as políticas do aplicativo e da organização; não sobrescrevê-las.
- Validar a seleção e o bloqueio de ponta a ponta, inclusive leitura e conexão em andamento, autorização cancelada, reinício do computador e bloqueio do arquivo de dados.
- Conferir visualmente as telas, tamanhos de janela, navegação por teclado e leitores de tela. A interface ainda não passou por validação visual em um navegador real.
- Rever os componentes atuais e a política de distribuição/assinatura. A ausência de assinatura própria deve ser informada; não orientar a desativar proteções do Windows.

## Limites de proteção

Os controles locais reduzem exposição acidental e o acesso de outros usuários do computador. Não são uma defesa contra programas maliciosos já executando como o mesmo usuário ou como administrador. Hashes incorporados detectam alteração dos componentes em relação ao iniciador; não autenticam o publicador de um iniciador que também foi substituído.

O conector só publica ferramentas de leitura, mas a sessão WhatsApp subjacente usa uma biblioteca não oficial. As mensagens pedidas ao assistente serão compartilhadas com o ChatGPT como resultado de ferramenta. Conteúdo de mensagens e nomes é tratado como dado externo; não é uma instrução para o assistente executar.

## Referências de arquitetura consultadas

- MCP local no ChatGPT desktop: https://learn.chatgpt.com/docs/extend/mcp
- Compilação cruzada Go: https://go.dev/wiki/WindowsCrossCompiling
- Distribuição Node 24: https://nodejs.org/dist/v24.21.0/
- Biblioteca WhatsApp: https://github.com/pedroslopez/whatsapp-web.js
- Parser TOML: https://github.com/squirrelchat/smol-toml

Os scripts do fluxo antigo de túnel e os arquivos `.cmd` de instalação manual foram retirados desta variante. O ponto de entrada stdio antigo fica apenas para o teste de regressão do estado inicial bloqueado; ele não é incluído como ponto de entrada no payload do aplicativo.
