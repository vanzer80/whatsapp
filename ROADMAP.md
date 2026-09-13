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

## 5. Consolidar o código funcional antes da VPS

Em 13/09/2026 o usuário confirmou em testes reais que a aplicação local consegue executar operações de escrita, incluindo envio de mensagens e criação/gestão de grupos. O estado atualmente confirmado neste repositório, porém, ainda descreve predominantemente a versão somente leitura e não comprova conter todas as funções que foram testadas no computador.

**Regra de continuidade:** não implantar a VPS diretamente a partir do estado atual do GitHub antes de localizar, comparar e versionar o código local que realizou os testes funcionais.

Ordem aprovada:

1. localizar no PC Shark a pasta/processo exato usado nos testes;
2. registrar `git status`, branch, commit, remotes e diferenças locais;
3. comparar o código local com `vanzer80/whatsapp`;
4. preservar e versionar leitura, envio, criação e gestão de grupos;
5. criar um ponto conhecido de homologação, sugerido `v0.4.0-vps-alpha`;
6. revisar a segurança das operações de escrita antes da implantação.

A execução desta frente está registrada na [Issue #7 — P0 — Consolidar código funcional e preparar migração para VPS DigitalOcean](https://github.com/vanzer80/whatsapp/issues/7).

## 6. Arquitetura alvo — operação 24/7 em VPS

Após a consolidação do código funcional, evoluir para operação permanente na DigitalOcean, eliminando a dependência do PC Shark permanecer ligado.

Arquitetura alvo:

`ChatGPT -> HTTPS fixo -> Caddy/Nginx -> API local -> fila/política de ações -> whatsapp-web.js -> Chromium -> WhatsApp Web`

Configuração inicial recomendada para homologação:

- DigitalOcean Droplet Basic;
- Ubuntu 24.04 LTS x64;
- 2 vCPU;
- 4 GB RAM;
- aproximadamente 80 GB SSD;
- região inicial NYC3, sujeita a teste de disponibilidade/latência;
- 2 GB de swap;
- Node.js compatível com o projeto (`>=24` no `package.json` atual);
- Google Chrome ou Chromium;
- `systemd` para manter o processo ativo e reiniciar em falhas;
- Caddy ou Nginx para HTTPS e reverse proxy;
- aplicação vinculada apenas a `127.0.0.1`;
- portas públicas apenas 22 e 443, com 80 somente se necessário;
- backups e Monitoring habilitados.

A administração, QR Code, troca de conta e funções sensíveis não devem ficar expostos publicamente. Preferir SSH Tunnel, Tailscale ou mecanismo equivalente.

## 7. Requisitos adicionais para escrita

Antes de considerar produção:

- separar permissões de leitura, envio e gestão de grupos;
- adicionar idempotência para impedir ações duplicadas em retries;
- aplicar rate limiting específico para escrita;
- serializar ações sensíveis com fila interna;
- manter segredos e sessões fora do GitHub;
- gerar logs de auditoria sem conteúdo integral das mensagens por padrão;
- implementar `/health` sem expor telefone, QR, mensagens ou tokens;
- definir política para ações destrutivas/sensíveis.

## 8. Homologação obrigatória da VPS

A migração só será considerada concluída quando forem comprovados:

- reinício da aplicação sem necessidade de novo QR;
- reinício da VPS com reconexão automática;
- recuperação de queda do Chromium;
- recuperação de falha temporária de internet;
- regeneração segura de QR quando necessário;
- envio sem duplicação em retry;
- criação de grupo sem duplicação em retry;
- leitura e listagem funcionando;
- revogação de autorização efetiva;
- token inválido recusado;
- portas internas e painel administrativo inacessíveis publicamente;
- backup e restauração testados;
- uso pelo ChatGPT sem depender do PC Shark ligado.

## Organização no GitHub

Repositório público criado pelo mantenedor: https://github.com/vanzer80/whatsapp

As quatro frentes de trabalho originais estão abertas como issues, com problema, critérios de aceitação e arquivos de referência:

- [#1 — P0 — Confirmar integração real no ChatGPT para Windows](https://github.com/vanzer80/whatsapp/issues/1)
- [#2 — P0 — Compilar e verificar um único instalador Windows](https://github.com/vanzer80/whatsapp/issues/2)
- [#3 — P0 — Validar autorização, bloqueio e canal local de ponta a ponta](https://github.com/vanzer80/whatsapp/issues/3)
- [#4 — P1 — Validar as telas e preparar a entrega para usuário comum](https://github.com/vanzer80/whatsapp/issues/4)
- [#7 — P0 — Consolidar código funcional e preparar migração para VPS DigitalOcean](https://github.com/vanzer80/whatsapp/issues/7)

O mantenedor pode revisar as contribuições por pull request. Os arquivos em `docs/tarefas` preservam o escopo inicial; o andamento de cada trabalho deve ser registrado na respectiva issue.

Nenhuma pessoa foi convidada, marcada ou contatada. Nenhum workflow de compilação remota foi disparado por esta atualização. A licença de distribuição ainda será definida pelo mantenedor.
