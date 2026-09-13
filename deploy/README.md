# Implantação VPS — WhatsApp Manutenção

Pacote alvo: Ubuntu 24.04 LTS, serviço privado em `127.0.0.1:8787`, Caddy na borda HTTPS e administração somente por túnel SSH.

## Pré-requisitos

- Droplet Ubuntu 24.04 LTS x64.
- 2 vCPU, 4 GB RAM e espaço SSD suficiente.
- Node.js 22.12 ou superior disponível em `/usr/bin/node`.
- Google Chrome ou Chromium em um dos caminhos suportados pelo provider.
- Caddy instalado e habilitado.
- DNS do domínio público apontando para a VPS.
- Portas públicas: 22/tcp e 443/tcp; 80/tcp somente quando necessário para emissão/redirect do certificado.
- Nenhuma porta da aplicação (`8787`) exposta no firewall público.

## Layout recomendado

- Código: `/opt/whatsapp-manutencao/releases/<commit>`.
- Symlink ativo: `/opt/whatsapp-manutencao/current`.
- Dados/sessão: `/var/lib/whatsapp-manutencao`.
- Ambiente: `/etc/whatsapp-manutencao/env`.
- Unit: `/etc/systemd/system/whatsapp-manutencao.service`.
- Caddy: `/etc/caddy/Caddyfile`.

## 1. Preparar usuário e diretórios

```bash
sudo useradd --system --home /var/lib/whatsapp-manutencao --shell /usr/sbin/nologin whatsapp-maint || true
sudo install -d -o whatsapp-maint -g whatsapp-maint -m 0700 /var/lib/whatsapp-manutencao
sudo install -d -o root -g root -m 0755 /opt/whatsapp-manutencao/releases
sudo install -d -o root -g root -m 0755 /etc/whatsapp-manutencao
```
## 2. Publicar uma release imutável

Substitua `<COMMIT>` pelo SHA aprovado no GitHub.

```bash
cd /opt/whatsapp-manutencao/releases
sudo git clone --no-checkout https://github.com/vanzer80/whatsapp.git <COMMIT>
cd <COMMIT>
sudo git checkout <COMMIT>
sudo env PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev
sudo chown -R root:root /opt/whatsapp-manutencao/releases/<COMMIT>
sudo ln -sfn /opt/whatsapp-manutencao/releases/<COMMIT> /opt/whatsapp-manutencao/current
```

Não copie `.env`, sessões, `access.json`, tokens ou dados do PC para dentro do repositório.

## 3. Configurar ambiente

```bash
sudo cp /opt/whatsapp-manutencao/current/deploy/env.example /etc/whatsapp-manutencao/env
sudo editor /etc/whatsapp-manutencao/env
sudo chown root:root /etc/whatsapp-manutencao/env
sudo chmod 0600 /etc/whatsapp-manutencao/env
```

Defina `WA_PUBLIC_BASE_URL` com o domínio HTTPS real. Mantenha `WA_DATA_DIRECTORY=/var/lib/whatsapp-manutencao` e `WA_PORT=8787` salvo decisão técnica explícita.

## 4. Preflight antes de iniciar

```bash
cd /opt/whatsapp-manutencao/current
npm run preflight:vps:static
sudo -u whatsapp-maint env WA_DATA_DIRECTORY=/var/lib/whatsapp-manutencao WA_PORT=8787 WA_PUBLIC_BASE_URL=https://SEU_DOMINIO npm run preflight:vps
```
## 5. Instalar e validar systemd

```bash
sudo cp deploy/systemd/whatsapp-manutencao.service /etc/systemd/system/whatsapp-manutencao.service
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/whatsapp-manutencao.service
```

Não inicie o serviço se o preflight ou `systemd-analyze verify` retornar erro.

## 6. Configurar Caddy

Copie `deploy/caddy/Caddyfile.example` e troque `whatsapp.example.com` pelo domínio real.

```bash
sudo cp deploy/caddy/Caddyfile.example /etc/caddy/Caddyfile
sudo editor /etc/caddy/Caddyfile
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

O Caddy deve publicar somente `/health` e `/gpt/*`. `/admin` deve continuar retornando 404 pela interface pública.

## 7. Iniciar serviço

```bash
sudo systemctl enable --now whatsapp-manutencao
sudo systemctl status whatsapp-manutencao --no-pager
curl --fail --silent http://127.0.0.1:8787/health
curl --fail --silent https://SEU_DOMINIO/health
```

O `/health` pode indicar WhatsApp ainda desconectado; ele não deve retornar QR, telefone, IDs, tokens ou lista de conversas.
## 8. Parear e autorizar pelo túnel SSH

No computador administrativo:

```bash
ssh -L 8787:127.0.0.1:8787 usuario@IP_DA_VPS
```

Em outro terminal autorizado, leia o token administrativo sem copiá-lo para o Git:

```bash
sudo cat /var/lib/whatsapp-manutencao/vps-admin.json
```

Abra `http://127.0.0.1:8787/admin`, informe o `admin_token`, inicie o pareamento, leia o QR pelo WhatsApp e selecione conversas/scopes. O token administrativo nunca deve ser colocado no Caddy, no GitHub ou no ChatGPT Action.

## 9. Homologação obrigatória

Antes de conectar definitivamente ao ChatGPT, validar:

- reinício do serviço sem novo QR;
- reinício da VPS sem novo QR;
- recuperação após queda do Chromium e da rede;
- envio e retry sem duplicação;
- criação de grupo e retry sem duplicação;
- atualização/gestão de grupo com idempotência;
- revogação de autorização;
- token GPT inválido = 401;
- `/admin` inacessível pelo domínio público;
- porta 8787 inacessível externamente;
- backup/restauração da sessão e dos estados privados;
- leitura e escrita pelo ChatGPT sem o PC Shark ligado.
## 10. Backup e restauração

A pasta `/var/lib/whatsapp-manutencao` contém sessão e credenciais operacionais. Trate qualquer backup como segredo.

Antes de upgrade relevante:

```bash
sudo systemctl stop whatsapp-manutencao
sudo tar --xattrs --acls -C /var/lib -czf /root/whatsapp-manutencao-state.tgz whatsapp-manutencao
sudo chmod 0600 /root/whatsapp-manutencao-state.tgz
sudo systemctl start whatsapp-manutencao
```

Prefira também snapshots/backups criptografados do provedor. Não envie esse arquivo por e-mail, chat ou GitHub.

## 11. Rollback de código

Mantenha a release anterior em `/opt/whatsapp-manutencao/releases`. Para voltar o código sem apagar dados/sessão:

```bash
sudo systemctl stop whatsapp-manutencao
sudo ln -sfn /opt/whatsapp-manutencao/releases/COMMIT_ANTERIOR /opt/whatsapp-manutencao/current
sudo systemctl start whatsapp-manutencao
curl --fail --silent http://127.0.0.1:8787/health
```

Não restaure um backup de estado antigo automaticamente durante rollback de código. Estado/sessão só deve ser restaurado quando houver evidência de corrupção ou procedimento de recuperação aprovado.
