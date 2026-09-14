# Handoff técnico — WhatsApp Manutenção

Este documento é a entrada recomendada para qualquer desenvolvedor ou time que assumir a continuidade do projeto. Ele registra o estado técnico aprovado, as fontes de verdade, os caminhos relevantes, as regras de segurança e o trabalho que ainda falta até a homologação da VPS.

## 1. Resumo executivo

Objetivo do produto: permitir que o ChatGPT consulte e execute operações controladas no WhatsApp autorizado pelo usuário, incluindo leitura de conversas, envio de mensagens e criação/gestão de grupos, com controle de acesso, idempotência, rate limiting, auditoria e operação 24/7 sem depender do PC Shark ligado.

Estado atual: o pacote de código para VPS está tecnicamente fechado e aprovado em CI Linux e Windows. O próximo estágio é **deploy e homologação real em VPS**. A migração ainda não deve ser considerada concluída.

**Não implantar a partir de `main`.** O ponto de partida aprovado é a branch e o SHA abaixo.

## 2. Fonte de verdade e prioridade documental

Use esta ordem quando houver divergência entre documentos:

1. `HANDOFF.md` — estado operacional atual para continuidade.
2. Issue #7 e seu checkpoint mais recente — execução e pendências de migração.
3. `deploy/README.md` — procedimento de deploy/homologação/backup/rollback.
4. Código e testes da branch `feat/write-operations-vps` no SHA aprovado.
5. Documento oficial no Google Drive — histórico, decisões e checkpoint gerencial.
6. `README.md` e `ROADMAP.md` — contêm partes históricas da versão Windows 0.3 e **não devem ser usados isoladamente como estado atual da migração VPS**.

## 3. Repositório e versão aprovada

- GitHub: `vanzer80/whatsapp`
- URL: https://github.com/vanzer80/whatsapp
- Remote: `https://github.com/vanzer80/whatsapp.git`
- Branch técnica atual: `feat/write-operations-vps`
- Baseline de runtime aprovada: `59ea523eec75de8da72dc5fcfe253f92a7f4617b`
- Commit de hardening/deploy imediatamente anterior: `72d1d0e69248a82d250e10b21c47908620d45612`
- Issue de continuidade: https://github.com/vanzer80/whatsapp/issues/7
- Tag planejada: `v0.4.0-vps-alpha` **somente após homologação real na VPS**.

A branch default do repositório continua sendo `main`. Não assuma que `main` já contém o pacote VPS aprovado.

## 4. Caminhos locais no PC Shark

Existem dois worktrees com finalidades diferentes:

### Worktree da migração VPS

- Caminho: `C:\dev\whatsapp-write-vps`
- Branch: `feat/write-operations-vps`
- SHA de referência: `59ea523eec75de8da72dc5fcfe253f92a7f4617b`

### Runtime Windows existente

- Caminho: `C:\dev\whatsapp`
- Branch observada: `feat/windows-release-ci`
- SHA observado: `95a1c01cba71fd008ea94bff67635f999177c413`
- Serviço desktop escuta localmente em `127.0.0.1:60234` quando ativo.

**Não matar, limpar sessão, trocar branch ou alterar o runtime Windows existente como parte do trabalho de VPS sem necessidade explícita.** O desenvolvimento da VPS deve permanecer isolado no worktree `C:\dev\whatsapp-write-vps` ou em um clone próprio do desenvolvedor.

## 5. Google Drive oficial

Drive oficial do projeto:

`SUPERVISOR IA - MANUTENÇÃO`

Pasta de decisões:

`SUPERVISOR IA - MANUTENÇÃO > 00 - GESTÃO DO PROJETO > 05 - Decisões e Alterações`

Documento canônico de continuidade:

`2026-09-13 - Plano de Continuidade - WhatsApp Manutenção e VPS DigitalOcean`

IDs úteis:

- Pasta raiz do projeto: `1tfFbUydAWbA3_oS7s-OhAm_SBqkXlbLe`
- Pasta `00 - GESTÃO DO PROJETO`: `1E3KeN4hrAAED_dZr9ooGhqwuQ76l4PM1`
- Pasta `05 - Decisões e Alterações`: `13brnLa1PMraPqVFPZO39hxgikA7pYu1E`
- Documento de continuidade: `1VlSRiOHnN3ac0mKiBFTRLo7w__uj6pQtN1JMrftxrjs`

Credenciais e segredos não devem ser duplicados neste documento, em issues ou no GitHub. A estrutura do Drive possui `00 - GESTÃO DO PROJETO > 06 - Acessos e Credenciais`; qualquer acesso sensível deve ser concedido separadamente e pelo princípio do menor privilégio.

## 6. Arquitetura alvo

Fluxo público:

`ChatGPT -> HTTPS fixo -> Caddy -> API local -> política/fila de ações -> whatsapp-web.js -> Chromium -> WhatsApp Web`

Administração:

`Computador administrativo -> túnel SSH -> 127.0.0.1:8787/admin`

Princípios obrigatórios:

- aplicação ouvindo somente em `127.0.0.1`;
- porta interna padrão `8787` nunca exposta diretamente à Internet;
- Caddy publica apenas `/health` e `/gpt/*`;
- `/admin/*` e QR permanecem privados, via túnel SSH;
- domínio HTTPS fixo configurado por `WA_PUBLIC_BASE_URL`;
- falha de configuração crítica deve ocorrer em modo fail-closed.

## 7. Capacidades implementadas

### Leitura

- `get_status`
- `list_chats`
- `read_messages`
- `search_messages`

### Escrita controlada

- `send_message`
- `create_group`
- `update_group`
- `manage_group_participants`

Scopes existentes:

- `whatsapp.read`
- `whatsapp.send`
- `whatsapp.group.create`
- `whatsapp.group.manage`

Políticas legadas v1 continuam somente leitura; escrita exige autorização explícita.

## 8. Controles de segurança já implementados

- allowlist de conversas autorizadas;
- scopes separados para leitura e escrita;
- fila serializada de mutações;
- revalidação da autorização antes e depois da mutação;
- idempotência persistente por 24 horas nas quatro operações de escrita;
- estado `pending` impede retry automático quando o resultado externo ficou indeterminado;
- rate limiting persistente por conta/operação;
- auditoria persistente e rotacionada sem corpo de mensagem, chat ID bruto ou chave de idempotência;
- erros públicos sanitizados;
- `/health` sem QR, telefone, IDs, mensagens ou tokens;
- admin token separado do token usado pelo GPT;
- estados privados e sessões fora do Git.

Nunca registrar em Git, issue, log público ou documento de handoff: QR, sessão WhatsApp, cookies, token administrativo, token GPT, conteúdo de mensagens, backups da pasta de estado ou arquivos `.env` reais.

## 9. Arquivos de estado privado

No ambiente VPS, a pasta de dados recomendada é:

`/var/lib/whatsapp-manutencao`

Exemplos de estado privado que não devem entrar no Git:

- sessão/auth do WhatsApp;
- `access.json`;
- `write-idempotency.json`;
- `write-rate.json`;
- `write-audit.jsonl` e rotações;
- `vps-admin.json`;
- configuração/token GPT;
- qualquer backup da pasta de dados.

Arquivo de ambiente de produção:

`/etc/whatsapp-manutencao/env` — propriedade `root:root`, modo `0600`.

## 10. Requisitos de desenvolvimento

O `package.json` atual exige:

- Node.js `>=22.12.0`;
- `whatsapp-web.js` `1.34.7`;
- MCP SDK `1.30.0`;
- Zod `3.25.76`.

Para build Windows também são usados Go e Python conforme workflow de CI.

Comandos mínimos para validar um clone:

```bash
npm ci
npm test
npm run preflight:vps:static
```

Para preflight real Linux/VPS:

```bash
WA_DATA_DIRECTORY=/var/lib/whatsapp-manutencao \
WA_PORT=8787 \
WA_PUBLIC_BASE_URL=https://SEU_DOMINIO \
npm run preflight:vps
```

## 11. Gate já aprovado

No SHA final aprovado:

- suíte local: 107 testes;
- 104 aprovados;
- 0 falhas;
- 3 skips específicos de plataforma;
- `git diff --check`: aprovado;
- `node --check`: aprovado;
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades no checkpoint;
- fail-closed testado para ausência de `WA_PUBLIC_BASE_URL`;
- exceções/rejeições fatais encerram o processo com código 1 para permitir `systemd Restart=on-failure`.

CI final:

- Linux VPS CI — run `34789374797` — SUCCESS, Ubuntu 24.04.
- Windows Build/Package — run `34789374810` — SUCCESS.

Workflows relevantes:

- `.github/workflows/linux-vps-ci.yml`
- `.github/workflows/build.yml`

## 12. Layout recomendado da VPS

Conforme `deploy/README.md`:

- Código imutável: `/opt/whatsapp-manutencao/releases/<commit>`
- Symlink ativo: `/opt/whatsapp-manutencao/current`
- Estado/sessão: `/var/lib/whatsapp-manutencao`
- Ambiente: `/etc/whatsapp-manutencao/env`
- systemd: `/etc/systemd/system/whatsapp-manutencao.service`
- Caddy: `/etc/caddy/Caddyfile`
- Usuário de serviço: `whatsapp-maint`
- Bind da aplicação: `127.0.0.1:8787`

Base recomendada: Ubuntu 24.04 LTS x64, 2 vCPU, 4 GB RAM, SSD suficiente, Chrome/Chromium, Node compatível, Caddy, firewall e backup/monitoramento do provedor.

## 13. O que ainda falta — ordem recomendada

1. Criar ou obter acesso à VPS de homologação e ao DNS/domínio.
2. Fazer deploy **do SHA `59ea523eec75de8da72dc5fcfe253f92a7f4617b`**, seguindo `deploy/README.md`.
3. Instalar/configurar Node, Chrome/Chromium, Caddy, usuário de serviço, diretórios, environment e unit systemd.
4. Confirmar firewall: somente 22/443 públicos; 80 apenas se necessário; 8787 privado.
5. Executar `preflight:vps:static`, `preflight:vps`, `systemd-analyze verify` e `caddy validate` no servidor real.
6. Iniciar serviço e validar `/health` local e público.
7. Abrir túnel SSH para `/admin`, obter o admin token localmente e parear o WhatsApp por QR.
8. Autorizar conversas e scopes de teste sem copiar sessão/QR/tokens para tickets ou chats.
9. Executar a homologação ponta a ponta descrita abaixo.
10. Configurar a integração definitiva do ChatGPT somente depois da homologação.
11. Após homologação aprovada, criar `v0.4.0-vps-alpha`, decidir PR/merge para `main`, atualizar README/ROADMAP e fechar a Issue #7 quando os critérios finais forem atendidos.

## 14. Homologação obrigatória

O time deve registrar evidência para cada item:

- restart do serviço mantém sessão sem novo QR;
- reboot da VPS mantém sessão sem novo QR;
- recuperação após queda do Chromium;
- recuperação após queda temporária de rede;
- QR expirado/regeneração segura;
- leitura/listagem funcionando;
- envio ocorre uma única vez;
- retry de envio não duplica mensagem;
- criação de grupo ocorre uma única vez;
- retry de criação não duplica grupo;
- update/manage de grupo respeitam idempotência;
- revogação bloqueia novas operações;
- token GPT inválido retorna 401;
- `/admin` é inacessível pelo domínio público;
- porta 8787 é inacessível externamente;
- backup e restauração do estado são testados;
- ChatGPT lê e escreve com o PC Shark desligado.

Não marcar um item como concluído sem evidência objetiva.

## 15. Backup e rollback

Seguir exatamente `deploy/README.md`.

Regras:

- backup de `/var/lib/whatsapp-manutencao` é segredo;
- parar o serviço antes de backup consistente quando indicado;
- não enviar backup por e-mail, chat ou GitHub;
- rollback de código deve trocar apenas o symlink para uma release anterior;
- não restaurar estado antigo automaticamente durante rollback de código.

## 16. Fluxo de desenvolvimento recomendado

1. Partir de `feat/write-operations-vps` no SHA final aprovado ou de uma branch criada a partir dele.
2. Não trabalhar diretamente em `main` enquanto o pacote VPS não for integrado formalmente.
3. Fazer mudanças pequenas e revisáveis.
4. Rodar a suíte completa antes de push.
5. Exigir Linux VPS CI e Windows Build/Package verdes.
6. Registrar avanço e evidências na Issue #7.
7. Para mudanças de arquitetura/segurança/deploy, atualizar este handoff e o documento oficial do Drive.
8. Não reescrever histórico nem apagar branches de backup sem decisão explícita do mantenedor.

## 17. Dívida documental conhecida

O `README.md` da branch ainda contém linguagem da versão 0.3 orientada a leitura e números antigos de teste. O `ROADMAP.md` também preserva o roteiro inicial do projeto. Esses arquivos são históricos até serem atualizados após a homologação/integração da linha VPS.

Por isso, **não use `README.md` ou `ROADMAP.md` como fonte única para decidir o estado da migração**.

## 18. Primeira hora de um novo desenvolvedor

1. Ler `HANDOFF.md` inteiro.
2. Ler a Issue #7 e o checkpoint mais recente.
3. Ler `deploy/README.md`.
4. Clonar `vanzer80/whatsapp`.
5. Checkout `feat/write-operations-vps`, registrar HEAD e comparar o runtime com a baseline `59ea523e...`; commits apenas documentais podem estar à frente.
6. Rodar `npm ci`, `npm test` e `npm run preflight:vps:static`.
7. Revisar `.github/workflows/linux-vps-ci.yml` e `.github/workflows/build.yml`.
8. Só depois iniciar alterações ou o deploy de homologação.

## 19. Critério de conclusão da migração

A migração estará concluída somente quando:

- a VPS estiver estável e reiniciável;
- sessão e estados persistirem corretamente;
- leitura e escrita estiverem homologadas ponta a ponta;
- controles de acesso/idempotência/rate limit/auditoria estiverem preservados;
- superfície pública estiver restrita ao necessário;
- backup/restore tiver sido testado;
- ChatGPT funcionar sem dependência do PC Shark;
- Issue #7 estiver com todas as evidências registradas;
- tag/release de homologação estiver criada conforme decisão do mantenedor.

Até lá, a Issue #7 permanece aberta.

## 20. Checkpoint de continuidade — 2026-09-14

### Estado revalidado

- GitHub e worktree `C:\dev\whatsapp-write-vps` conferidos na branch `feat/write-operations-vps`, HEAD observado `ca12d8926d66184848508695339c7701c6592e36`.
- Worktree limpo antes e depois dos testes; `git ls-remote` confirmou o mesmo SHA no GitHub.
- A comparação `59ea523e...HEAD` listou somente `HANDOFF.md`; a baseline de runtime aprovada permanece `59ea523eec75de8da72dc5fcfe253f92a7f4617b`.
- CI confirmada no HEAD documental observado: Linux VPS CI [34790008186](https://github.com/vanzer80/whatsapp/actions/runs/34790008186) SUCCESS e Windows [34790008170](https://github.com/vanzer80/whatsapp/actions/runs/34790008170) SUCCESS.
- Nova execução no Shark com Node v24.5.0 e ComSpec definido: `npm test` — 107 testes, 104 aprovados, 0 falhas, 3 skips; exit 0.
- `npm run preflight:vps:static`, `git diff --check` e `node --check` nos 33 arquivos JS/MJS rastreados: aprovados.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades; exit 0.
- O serviço Windows existente foi observado em `127.0.0.1:60234`. Não foi alterado, encerrado ou usado para testar escrita.

### Bloqueio externo confirmado

Não foram localizados destino/IP, usuário SSH nem domínio/DNS da VPS de homologação do WhatsApp no handoff, na Issue #7, no documento canônico ou na pasta oficial de acessos. Isso não prova que o Droplet não exista na conta.

No Shark, o arquivo de configuração SSH não possui entradas de hosts; `doctl` não foi localizado e não há configuração do doctl nem token DigitalOcean nas variáveis consultadas. A VPS do projeto Live IA não foi usada como destino presumido.

Foi identificado um plugin DigitalOcean disponível, ainda não conectado, cuja descrição informa provisionamento de Droplet como workspace remoto. Suas capacidades para este deploy precisam ser verificadas após a conexão; não há garantia prévia de compatibilidade com a arquitetura exigida.

### Próximo passo executável

Conectar a DigitalOcean para inspecionar as capacidades disponíveis, ou identificar a VPS de homologação e disponibilizar acesso SSH por chave a um usuário administrativo com sudo para a instalação. Para HTTPS, será necessário o domínio/subdomínio destinado ao WhatsApp e acesso de edição somente ao registro DNS correspondente.

Depois de obter esse acesso, confirmar Ubuntu 24.04, capacidade, serviços e firewall reais; seguir `deploy/README.md` com a baseline aprovada. Não iniciar o serviço sem os preflights reais, validação systemd/Caddy e configuração HTTPS.

### Limites das evidências

Este checkpoint revalida código e configuração estática no Windows, além da CI já executada. Não equivale a implantação ou homologação real da VPS. Preflight no servidor, pareamento, restart/reboot, recuperação de Chromium/rede, operações reais, firewall externo, backup/restauração e uso pelo ChatGPT com o Shark desligado continuam pendentes. Nenhuma mensagem foi enviada, grupo criado, tag publicada ou merge realizado nesta retomada.
