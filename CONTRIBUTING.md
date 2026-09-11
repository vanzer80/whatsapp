# Como contribuir

O objetivo é entregar um aplicativo para Windows que uma pessoa consiga baixar e executar, com QR e escolha de conversas, sem terminal, instalação manual de dependências, túnel ou chave de API.

## Antes de alterar

Leia `README.md`, `RELATORIO-VALIDACAO.md` e a tarefa correspondente em `docs/tarefas`. O ponto de partida é a versão 0.3.0 existente. Preserve o trabalho aproveitável e registre qualquer incompatibilidade encontrada com evidência reproduzível.

Abra uma branch por alteração e um pull request focado. Uma revisão de documentação não precisa de testes novos; alterações de autenticação, autorização, concorrência e instalação precisam de verificações que demonstrem o comportamento relevante.

## Preparar e verificar

Use o lockfile e `npm ci --ignore-scripts --no-audit --no-fund`. Rode `npm test` e informe quantos testes passaram, falharam ou ficaram sem execução. Rode `go test ./...` dentro de `launcher` quando alterar o iniciador. Na tarefa de empacotamento, use a versão Node prevista no documento de desenvolvimento e registre a procedência dos componentes.

Os testes automáticos usam dados simulados. Não altere os testes para acessar contas reais. Testes manuais de WhatsApp devem usar uma conta de teste autorizada, fora de CI e sem compartilhar a sessão com outras pessoas.

## Regras do produto

- O MCP só pode publicar operações de leitura. A seleção de conversas e a autorização ficam no painel local.
- Acesso inexistente, inválido, revogado ou de outra conta bloqueia a consulta. Revalidar antes de devolver o resultado.
- Bloquear deve interromper também operações pendentes e invalidar callbacks de sessões anteriores.
- Preservar a configuração existente do ChatGPT e respeitar suas políticas. Qualquer incompatibilidade deve aparecer no relatório.
- Manter instalação como usuário comum e verificação dos componentes. Não orientar a desativar as proteções do Windows.
- Manter QR, segredos locais e sessão fora do repositório, dos logs e dos resultados MCP.

## Relatório do pull request

Descreva o problema, o comportamento resultante, os arquivos relevantes e os testes realizados. Indique sistema operacional, versões de Node/Go/Chrome/ChatGPT quando afetarem o resultado. Separe testes executados de verificações pendentes. Anexe capturas apenas com dados simulados e sem QR, URLs de sessão ou identificadores reais.

## Quando algo fica pronto

Uma tarefa só muda para concluída com evidências dos critérios de aceitação. Um `.exe` compilado ainda é um candidato até passar pela instalação e pelo uso real no Windows. Registrar pendências é preferível a marcar validação que não aconteceu.
