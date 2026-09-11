# Validação — WhatsApp Manutenção 0.3.0

Data: 11/09/2026. **Versão em desenvolvimento, sem executável gerado.**

## Resultado efetivamente obtido

No código atual, `npm test` terminou com **48 testes: 46 aprovados, 0 falhos e 2 não executados por restrição do ambiente**. Foram verificadas também a sintaxe de 20 arquivos JavaScript, a sintaxe do empacotador Python e a estrutura dos manifestos pelo validador de plugins. Node usado nos testes locais: v24.19.0. A versão planejada para o pacote Windows é v24.21.0 e ainda não foi obtida nem testada.

Os 46 testes aprovados cobrem:

- Leitura somente das conversas autorizadas, sem enumeração global pelo MCP; bloqueio inicial sem permissões; vínculo com a conta; recusa de conversas trancadas.
- Revogação durante leitura, troca de conta, limites de resultados, pseudônimos de autores, validação estrita de parâmetros, frequência e concorrência.
- MCP por stdio com dados simulados, apenas quatro ferramentas de leitura, sem envio e sem vazamento dos erros internos ou variáveis de ambiente de teste.
- Registro TOML com preservação de outras configurações, cópia anterior, idempotência e recusa de conflitos, marcadores adulterados e links.
- Seleção local, bloqueio durante conexão e autorização, callbacks antigos, geração local do QR e invalidação da sessão.
- Tratador HTTP exercitado diretamente em memória: Host, Origin, autenticação, limites de corpo, rotas permitidas e respostas sem tokens.
- Transporte MCP autenticado em memória: negociação, consulta e revogação; autenticação ausente ou inválida encerra o canal antes de processar MCP.

## Verificações que não foram concluídas

| Verificação | Estado e motivo |
| --- | --- |
| Servidor HTTP real e canal IPC real | Dois testes assinalados como não executados: o ambiente retornou `listen EPERM` ao abrir o socket local. Os testes em memória não substituem essa integração. |
| Obtenção de Node oficial para Windows e compilador Go | A revisão automática rejeitou a etapa, informando limite de uso das ferramentas. Os diretórios de componentes continuaram vazios. Não foi tentado contornar a rejeição. |
| Testes Go e compilação do iniciador | Não executados: compilador indisponível. Fonte e testes foram escritos, mas não validados por compilação. |
| Empacotador Python | Sintaxe validada; não executado com componentes reais. |
| Instalação, ACL e atalho no Windows | Não executados; não há ambiente Windows nem `.exe` nesta entrega de código. |
| QR e WhatsApp reais | Não testados; nenhum aparelho ou conta WhatsApp foi conectado. |
| Registro e descoberta no ChatGPT para Windows | Algoritmo de edição de configuração testado com arquivos temporários. Reconhecimento pelo aplicativo real ainda pendente. |
| Interface em navegador real | Ainda sem validação visual ou de acessibilidade. |
| Auditoria atual das dependências e assinatura própria | Auditoria desta variante ainda pendente; não existe certificado próprio nem executável assinado. Não transportar o resultado da auditoria da versão anterior para esta versão. |

## Alterações em relação à versão 0.2.0

A versão anterior passou novamente nos 39 testes antes da introdução dos testes novos. Nesta variante, foram retirados o fluxo de túnel, os scripts de configuração manual e os sete testes que tratavam especificamente do túnel ou da seleção pelo terminal. Permaneceram 32 testes relevantes do núcleo anterior; foram adicionados 16 testes do fluxo desktop, dos quais 14 passaram e 2 ficaram bloqueados pelo ambiente.

As proteções anteriores do leitor foram mantidas. O novo código acrescenta interface local, registro automático, serviço único compartilhado pelo painel e pelo MCP, segredos locais gerados automaticamente e um iniciador Windows cuja compilação ainda depende dos componentes oficiais.

## Condição de entrega

O ZIP deste checkpoint contém fontes, manifestos, arquivos de dependências e documentação. Não contém Node, compilador, `node_modules`, sessão, credenciais ou instalador pronto. O arquivo não deve ser apresentado como a experiência final de baixar e executar solicitada pelo usuário.

O roteiro para concluir a compilação e os testes no Windows está em `DESENVOLVIMENTO.md`. A entrega pronta continua pendente até que essas verificações sejam concluídas.
