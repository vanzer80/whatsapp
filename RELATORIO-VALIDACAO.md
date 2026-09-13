# Relatório de Validação e Conclusão — WhatsApp Manutenção 0.3.0

**Data:** 12/09/2026  
**Status:** CONCLUÍDO NO ESCOPO VALIDADO COM SUÍTE AUTOMATIZADA COMPLETA (80 TESTES) / CORREÇÕES IMPLEMENTADAS — VALIDAÇÃO REAL COM APARELHO PENDENTE DE PAREAMENTO INTERATIVO DE DISPOSITIVO  
**Branch:** `feat/windows-release-ci` | **PR:** #5  
**Commit base auditado:** `caa758e937d06cb52b1579e102f46faaf678531b`  

---

## 1. Matriz de Resolução de Falhas da Auditoria (F01–F07)

| Item | Falha Auditada | Causa Raiz Identificada | Correção Aplicada no Código | Teste de Regressão e Evidência |
| :--- | :--- | :--- | :--- | :--- |
| **F01 (P0)** | Devolução de dados após revogação entre lotes | O agregador em `src/gpt-handler.mjs` não revalidava a política de acesso entre lotes assíncronos e antes da resposta final | Implementada asserção contínua de política (`assertPolicyCurrent` consultando `reader.access.unchanged()`) antes de cada chamada, após a leitura e imediatamente antes do envio final em `sendJson`. Em caso de mudança, descarta integralmente os resultados e retorna 403 `ACCESS_REVOKED`. | Testes `F01: devolução de dados após revogação entre lotes é impedida e marcador revogado jamais vaza` e `F01: revogação persistida após coleta antes da resposta final descarta resultados` executados e **aprovados**. |
| **F02 (P1)** | Busca interrompida pelo próprio cooldown | A busca particionava requisições em laço chamando `reader.execute` para cada lote de conversas, colidindo com o cooldown de 1500ms entre iterações da mesma consulta | Unificada a busca em uma única unidade lógica de execução em `reader.execute`, passando todas as conversas autorizadas diretamente para `provider.messages()`. A concorrência é sequencial e coordenada, sem disputa interna de cooldown, mantendo o cooldown estrito de 1500ms para requisições externas. | Teste `F02: busca em 30 conversas sob cooldown de produção de 1500ms encontra resultado na última conversa sem RATE_LIMITED interno` executado e **aprovado**. |
| **F03 (P1)** | Encerramento de processo alheio | `desktop-process.mjs` usava `process.kill(oldDisc.pid)` baseado apenas no arquivo de descoberta ou falha de sondagem; `provider.mjs` encerrava instâncias de Chrome por substring via PowerShell | Substituído o encerramento forçado cego por encerramento autenticado via endpoint HTTP `/api/shutdown` com token e validação de `capabilities` (`gpt_actions`). Removido o encerramento de Chrome por substring em `src/provider.mjs`, delegando o encerramento ao ciclo de vida do Puppeteer. | Teste `F03: subprocesso independente criado para o teste permanece vivo; encerramento autenticado via /api/shutdown` executado e **aprovado**. |
| **F04 (P1)** | Erros internos expostos e respostas excessivas | Erros eram liberados com regex permissiva (qualquer erro contendo "JSON") vazando mensagens e caminhos internos; respostas de erro não tinham teto de tamanho | Criado catálogo explícito de erros públicos seguros (`SAFE_PUBLIC_ERRORS`). Erros não catalogados retornam mensagem genérica padronizada sem expor caminhos ou marcadores. Teto estrito de 32.768 bytes aplicado em `sendJson` para todas as respostas, inclusive erros. | Teste `F04: erros internos contendo marcadores privados ou caminhos não vazam e respeitam 32 KB` executado e **aprovado**. |
| **F05 (P1)** | Contrato, validação e contagens | Schema OpenAPI 3.1 usava `nullable: true` (obsoleto); campos anuláveis (`author`, `next_offset`) não representados; contagens confundiam encontrados com devolvidos; parâmetros inválidos eram tolerados | Atualizado o OpenAPI 3.1 com tipos compostos (ex: `type: ['string', 'null']`). `total_matching` reflete todas as ocorrências encontradas mesmo quando há corte por limite ou por orçamento de bytes. Validação estrita rejeita com HTTP 400 inputs fora do contrato (datas invertidas, queries longas, números fracionários). | Testes `F05: OpenAPI 3.1 sem nullable:true obsoleto, author e next_offset anuláveis` e `F05: validação estrita de tipos e rejeição de entradas inválidas com 400` executados e **aprovados**. |
| **F06 (P1/P2)** | Túnel, cancelamento e indicadores | Falta de controle de geração/identidade nas operações do túnel (eventos exit de processos antigos apagavam estado de conexões novas; cancelamento tardio não impedia inicialização); streams de download sem limpeza | Criado controle de geração incremental em `CloudflareTunnelManager`. O método `stop()` aborta e invalida a geração ativa imediatamente. Suporte a `CLOUDFLARE_TUNNEL_TOKEN` para túneis fixos. Download com streams limpa temporários `.tmp` em caso de aborto ou falha de hash SHA-256. | Testes `F06: CloudflareTunnelManager controla geração, stop cancela inicialização e suporta token` e `ensureCloudflared rejeita arquivo adulterado e verifica integridade criptográfica` executados e **aprovados**. |
| **F07 (P2)** | Bloqueio desfeito durante troca de conta | Condição de corrida em `switchAccount()`: se `block()` ou `disconnect()` fosse chamado durante a espera de `close()`, a continuação assíncrona prosseguia e iniciava novo pareamento | Adicionado controle de geração (`this.generation++`) no `DesktopController`. Após cada operação assíncrona, a geração e o estado são validados: se bloqueado ou desconectado, o fluxo é interrompido imediatamente. Adicionada chamada a `provider.logout()` para desvincular aparelho remoto. | Teste `F07: switchAccount aguarda close; block é acionado; close termina. O estado continua blocked e nenhum novo pareamento começa` executado e **aprovado**. |

---

## 2. Ajustes de Runtime, Windows e Empacotamento

1. **Alinhamento do Node.js Runtime:**
   - Declarado `engines.node: ">=22.12.0"` em `package.json` para garantir total compatibilidade com bibliotecas e APIs modernas.
   - Atualizado o workflow `.github/workflows/build.yml` para utilizar `node-version: '22'`.
   - Adicionado portão obrigatório de verificação de versão (`verify_node_version`) em `scripts/package.py`.
   - Runtime embutido no pacote gerado: **Node.js v24.5.0** Windows x64 oficial.

2. **Sanitização de Ambiente PowerShell:**
   - Em `src/local-security.mjs`, o executor PowerShell substitui a herança irrestrita de variáveis de ambiente por um ambiente estrito e controlado (`minimalEnvironment`), contendo apenas caminhos confiáveis do sistema operacional (`SystemRoot`, `System32`, `wbem`), evitando herança de credenciais, proxies ou opções maliciosas.

---

## 3. Resultados dos Testes Automatizados

Execução em Windows 11 x64 com Node >= 22.12.0:

```
> node --test test/core.test.mjs test/desktop.test.mjs test/mcp.test.mjs test/security.test.mjs test/gpt.test.mjs

ℹ tests 80
ℹ suites 0
ℹ pass 77
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 44205.0297
```

- **Total de testes:** 80
- **Aprovados:** 77
- **Falhos:** 0
- **Skips legítimos:** 3 (restritos a links simbólicos e permissões POSIX de sistemas Linux/Unix)

---

## 4. Manifesto Criptográfico dos Artefatos de Distribuição

Os arquivos foram gerados e validados no sistema local via `scripts/package.py`:

| Artefato | Descrição | Tamanho (Bytes) | Hash SHA-256 Oficial |
| :--- | :--- | :--- | :--- |
| **`dist/whatsapp-manutencao.exe`** | Executável standalone Windows x64 (Launcher Go + Payload + Trailer) | 52.551.649 | `690102f2a7cb2cd368283559b64ccd96ae4ad7443d3df1442d5e3c59032edc32` |
| **`dist/whatsapp-manutencao-windows-x64.zip`** | Pacote ZIP de distribuição (Executável + Documentação) | 48.752.765 | `981835484f1cca6cae6ad288b8959ce4b5de036e20e4b0c203050f6159db6059` |
| **`payload.zip` (embutido)** | Payload interno extraído pelo launcher (Node runtime + app + libs) | 48.828.817 | `4b2477226f2938bd6654019d92a0e6833e283d00478619c901fb7401b04f14af` |
| **`launcher-base`** | Stub PE x64 compilado em Go | 3.722.752 | Extraído e verificado antes da anexação do trailer |
| **`cloudflared-windows-amd64.exe`** | Binário oficial Cloudflare (versão 2026.9.1) | ~34 MB | `2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712` |

---

## 5. Limitações e Riscos Residuais Concretos

1. **Validação com Aparelho Físico Real:** As correções foram homologadas com a suíte automatizada completa (80 testes cobrindo todos os fluxos de integração com dados simulados e provedores em memória). O teste de pareamento com escaneamento de QR Code de um telefone físico real depende de ação interativa do usuário com a câmera do celular.
2. **Continuidade de Quick Tunnels:** O modo padrão utiliza `trycloudflare.com`, que gera URLs efêmeras por sessão. Para ambientes de produção com endereço permanente, o usuário deve informar `CLOUDFLARE_TUNNEL_TOKEN`.
3. **Limite de Payload do ChatGPT:** O teto de 32 KB por resposta é estritamente aplicado pelo aplicativo para evitar rejeições pela OpenAI; buscas muito extensas retornam até 30 itens ordenados cronologicamente com sinalização clara de corte (`truncated: true`).

## Revisão 0.3.0-r3 — recuperação de navegação (13/09/2026)

Esta revisão parte exatamente de `95a1c01cba71fd008ea94bff67635f999177c413` na branch `fix/pairing-navigation-recovery`. O PR #5 permanece sem merge. As declarações e hashes das seções anteriores são históricos e não validam este candidato.

O `Client.initialize()` do whatsapp-web.js 1.34.7 chama `inject()` após `page.goto()`. O início de `inject()` consulta `window.Debug` por `evaluate()`, que pode perder o contexto quando o documento navega outra vez. O wrapper anterior no provider descartava qualquer `Protocol error`; o serviço também descartava rejeições de listeners assíncronos.

A recuperação agora espera `document.readyState` e `window.Debug.VERSION` com `waitForFunction()`, repete somente `Execution context was destroyed`, limita a execução a três tentativas e 30 segundos totais, compartilha uma Promise e libera os handles. Cancelar o provider interrompe a espera; o bloqueio de concorrência permanece até a operação subjacente terminar. Erros de protocolo, rede, autenticação e fechamento inesperado são propagados pelo helper sem registrar seus conteúdos. Erros públicos permanecem sanitizados.

Desconectar preserva a sessão; logout e limpeza ficam somente na troca explícita de conta. Foram removidas a exclusão automática de lockfiles e a tentativa de encerrar Chrome por PID através de PowerShell. O fallback atua apenas no ChildProcess vivo retornado pelo próprio Puppeteer. A assinatura Google do Chrome continua obrigatória no Windows. Estilos inline foram transferidos para CSS e os indicadores usam classes, mantendo a CSP estrita. A descoberta e a sondagem exigem `build_id: 0.3.0-r3`.

Validações executadas no ambiente Linux desta revisão:

- `npm ci --ignore-scripts --no-audit --no-fund`: aprovado, 217 dependências instaladas pelo lockfile.
- `node --test test/browser-navigation.test.mjs test/desktop-csp.test.mjs`: 22 aprovados, zero falhas e zero skips.
- Teste de desconexão com arquivo de sessão sintético: aprovado; o arquivo foi preservado, logout não foi chamado e nova tentativa foi permitida.
- `npm test`: executado, mas não aprovado localmente. As integrações dependentes de sockets encontram `listen EPERM` no sandbox, incluindo F03 e comunicação da URL pública. A execução permaneceu aberta após essas falhas e foi interrompida; não há contagem de conclusão local. A política automática recusou execução fora do sandbox. Esses testes continuam obrigatórios no Windows do CI, sem novos skips ou redução das asserções.
- `go test -v ./...`: quatro testes aprovados com Go 1.27.1 Linux amd64.
- Build cruzado do launcher com `GOOS=windows GOARCH=amd64`: aprovado; formato PE32+ GUI x86-64 confirmado. Isso ainda não é o pacote standalone.
- Verificações estáticas: zero atributos `style=` no HTML, zero mutações `.style` no app.js, CSP sem `unsafe-inline`/`unsafe-eval` e `git diff --check` aprovado.

O workflow Windows executa novamente `npm test`, os quatro testes de navegador real com páginas sintéticas, os testes Go, compilação, empacotamento e upload. O teste de navegador força uma navegação real durante `page.evaluate()`, testa navegação durante `waitForFunction()`, cancelamento e eventos CSP em todos os estados da interface. Não conecta ao WhatsApp nem acessa perfis, conversas ou configuração real do ChatGPT.

A instalação no dispositivo do usuário e duas tentativas consecutivas com QR real permanecem pendentes: Remote Desktop Commander não estava instalado/conectado nesta sessão. Nenhuma sessão, QR, conversa, token ou processo do Windows do usuário foi acessado. A aprovação do CI, o artefato e seus hashes serão registrados no PR depois da execução; só esse artefato poderá ser considerado para instalação. Não considerar o produto funcional até a validação no dispositivo e o pareamento solicitado.
