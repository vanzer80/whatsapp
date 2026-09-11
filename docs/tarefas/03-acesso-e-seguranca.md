# P0 — Validar autorização, bloqueio e canal local de ponta a ponta

**Estado:** a fazer. Rascunho de issue; ainda sem responsável ou issue remota.

## Problema

Os testes em memória passaram, mas dois testes de servidor HTTP/IPC real não executaram no ambiente anterior por `listen EPERM`. As permissões de arquivos e os fluxos de sessão também precisam de verificação no Windows.

## Aceitação

- [ ] Dois testes de integração HTTP/IPC executados com sucesso em ambiente que permita sockets locais.
- [ ] Autenticação ausente/incorreta, origem inesperada, corpo excessivo e ação não prevista recusados pelo servidor real.
- [ ] Sessão e segredos locais inacessíveis a outro usuário comum da máquina.
- [ ] Conversas ausentes, inválidas, trancadas ou de outra conta permanecem bloqueadas.
- [ ] Bloquear durante leitura, pareamento ou autorização impede devolver dados e reabrir acesso por callback antigo.
- [ ] Alterar conversas revoga a seleção anterior; falhar no meio não amplia acesso.
- [ ] Reinício e falha de rede não transferem autorizações para outra conta.
- [ ] Segredos, QR e detalhes internos não aparecem nas respostas MCP nem nos logs publicados.
- [ ] Auditoria atual das dependências registrada e eventuais resultados tratados.

Contas e dados reais do proprietário do projeto não são necessários. Usar fixtures e conta de teste controlada pelo desenvolvedor.
