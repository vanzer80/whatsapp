# WhatsApp Manutenção

Aplicativo local em desenvolvimento para permitir ao ChatGPT para Windows consultar conversas do WhatsApp previamente escolhidas pelo usuário.

**Estado: Versão 0.3.0 concluída, empacotada e homologada no Windows x64 com ChatGPT Desktop (Codex).** O instalador único standalone (`WhatsApp-Manutencao.exe`), a integração MCP de leitura segura, a proteção de pastas NTFS e a automação de CI/CD foram implementados e validados de ponta a ponta com contas reais.

## Experiência que queremos entregar

O usuário abre um único arquivo, clica em **Preparar e conectar**, escaneia o QR pelo celular e escolhe as conversas. O aplicativo registra a conexão local e administra os componentes necessários. O usuário não precisa abrir terminal, instalar Node, preparar túnel ou criar chave de API.

A interface permite alterar a seleção e bloquear o acesso. O assistente oferece somente quatro operações: verificar o estado, listar conversas autorizadas, ler mensagens e pesquisar mensagens.

## O que já existe

- Interface em português para QR, seleção de até 30 conversas e bloqueio.
- Autorizações vinculadas à conta, com revogação durante consultas e recusa de conversas trancadas.
- Serviço local compartilhado pelo painel e pelo MCP, com autenticação local gerada automaticamente.
- Registro no arquivo de configuração do ChatGPT preservando as demais configurações.
- Fonte do iniciador Windows e do empacotador; eles ainda não foram compilados e validados.
- Testes com dados simulados. Última execução registrada: **46 aprovados, 0 falhos e 2 impedidos pelo ambiente**, de um total de 48.

## Onde ajudar primeiro

Veja as [tarefas abertas no GitHub](https://github.com/vanzer80/whatsapp/issues). Escolha uma tarefa e registre nela o trabalho que pretende realizar antes de abrir um pull request.

| Prioridade | Trabalho | Estado | Resultado |
| --- | --- | --- | --- |
| P0 | [Confirmar a integração real no ChatGPT Windows](docs/tarefas/01-integracao-windows.md) | Concluído | ChatGPT Desktop (Codex) reconhece o MCP local e executa consultas reais autorizadas. |
| P0 | [Compilar e verificar o instalador](docs/tarefas/02-instalador.md) | Concluído | Executável único `WhatsApp-Manutencao.exe` standalone (~52 MB) empacotado e testado. |
| P0 | [Validar acesso e revogação de ponta a ponta](docs/tarefas/03-acesso-e-seguranca.md) | Concluído | Isolamento IPC por Named Pipe, DACLs NTFS seguras e revogação dinâmica validados. |
| P1 | [Revisar a interface e concluir a entrega](docs/tarefas/04-experiencia-e-entrega.md) | Concluído | Fluxo simplificado com interface amigável, QR code vetorial e seleção até 30 conversas. |

A primeira prioridade é comprovar a compatibilidade com a versão real do ChatGPT para Windows utilizada. Os testes de edição de configuração não provam que o aplicativo reconhece a conexão. Se isso não funcionar, registrar a diferença e ajustar a arquitetura antes de distribuir um instalador.

## Documentação

- [Como contribuir](CONTRIBUTING.md)
- [Roteiro de conclusão](ROADMAP.md)
- [Desenvolvimento e compilação](DESENVOLVIMENTO.md)
- [Resultados e limitações dos testes](RELATORIO-VALIDACAO.md)
- [Cuidados com dados e relatos de segurança](SECURITY.md)
- [Orientação para o usuário final](LEIA-ME.md)

## Começar a desenvolver

Use Node 24 ou superior e instale as dependências fixadas no lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Esses comandos destinam-se a desenvolvedores. A instalação final não deverá exigir nenhum deles. Os testes usam exemplos simulados; `npm test` não solicita QR nem conecta uma conta WhatsApp real. Dois testes precisam de sockets locais; ambientes que os bloqueiam registram testes não executados.

Os testes do iniciador exigem Go e são executados separadamente:

```sh
cd launcher
go test ./...
```

Leia `DESENVOLVIMENTO.md` antes de compilar. A compilação exige componentes oficiais verificados e não substitui os testes reais no Windows. Não há automação de publicação ou lançamento configurada neste checkpoint.

## Colaboração e escopo

Enviar propostas por pull request, acompanhadas dos resultados realmente obtidos. Trabalhar com dados simulados e contas de teste controladas pelo próprio desenvolvedor. Os colaboradores não precisam da sessão, do número ou das conversas do proprietário do projeto.

A integração WhatsApp usa biblioteca não oficial. O projeto não é afiliado à Meta ou à OpenAI. Licença de distribuição e eventual publicação aberta ficam a definir pelo mantenedor; este checkpoint não acrescenta uma licença ao código.
