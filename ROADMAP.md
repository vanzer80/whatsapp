# Roteiro para a primeira versão utilizável

Estado inicial deste roteiro: fontes disponíveis, 46 testes aprovados e 2 integrações locais não executadas. Nenhum executável pronto, sessão real conectada ou teste completo no ChatGPT Windows foi demonstrado.

## 1. Comprovar a integração real

Responsabilidade: desenvolvedor com Windows e acesso ao aplicativo ChatGPT para Windows. Confirmar que a versão instalada aceita o MCP local pelo mecanismo previsto. Registrar versões e resultado. Fazer uma consulta usando somente uma conta de teste e uma conversa autorizada. Ver [tarefa 01](docs/tarefas/01-integracao-windows.md).

## 2. Concluir o candidato de instalação

Responsabilidade: desenvolvedor de Windows/Go/empacotamento. Obter componentes oficiais, conferir integridade, executar testes Go, concluir o empacotador e gerar um único candidato `.exe`. Demonstrar abertura como usuário comum e recusa de componentes adulterados. Ver [tarefa 02](docs/tarefas/02-instalador.md).

## 3. Validar as permissões no sistema real

Responsabilidade: revisão técnica independente da alteração, quando houver outro colaborador disponível. Rodar as integrações HTTP/IPC, testar QR, seleção, bloqueio, trocas de conta, falhas e reinício. Revisar também permissões de arquivos no Windows. Ver [tarefa 03](docs/tarefas/03-acesso-e-seguranca.md).

## 4. Simplificar e entregar

Responsabilidade: desenvolvimento da interface e teste com usuário. Conferir telas, teclado, instruções e mensagens de erro. Documentar exatamente qual arquivo baixar e executar. Decidir como distribuir e assinar a versão. Ver [tarefa 04](docs/tarefas/04-experiencia-e-entrega.md).

## Organização no GitHub

Repositório público criado pelo mantenedor: https://github.com/vanzer80/whatsapp

As quatro frentes em `docs/tarefas` serão registradas como issues neste repositório durante o envio inicial. Cada tarefa informa o problema, os critérios de aceitação e os arquivos de referência. O mantenedor poderá revisar as contribuições por pull request.

Nenhuma pessoa foi convidada, marcada ou contatada. Nenhum workflow de compilação remota foi disparado. A licença de distribuição ainda será definida pelo mantenedor.
