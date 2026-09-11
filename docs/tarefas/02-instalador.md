# P0 — Compilar e verificar um único instalador Windows

**Estado:** a fazer. [Issue #2](https://github.com/vanzer80/whatsapp/issues/2); sem responsável definido.

## Problema

O iniciador Go e o empacotador Python foram escritos, mas ainda não foram compilados juntos nem executados. Não há `.exe` pronto. A obtenção dos componentes ficou bloqueada no ambiente anterior.

## Trabalho

Seguir `DESENVOLVIMENTO.md`, conferir componentes oficiais e seus hashes, rodar os testes Go e revisar o empacotador. Gerar somente um candidato para aceitação. Registrar a origem de cada componente e a versão do ambiente de compilação.

## Aceitação

- [ ] Testes Go executados e fonte compilada para Windows x64.
- [ ] Runtime oficial verificado, licença incluída e dependências conferidas.
- [ ] Instalação como usuário comum, com caminhos contendo espaços e acentos.
- [ ] ACL real limita acesso conforme o desenho; verificar especialmente o proprietário de pastas em máquinas e runners Windows.
- [ ] Atalho criado e primeira e segunda aberturas funcionam.
- [ ] Componentes alterados ou inesperados são recusados.
- [ ] Não se exige terminal, instalação manual de Node, túnel ou chave de API do usuário.
- [ ] Hash, estado da assinatura e pendências acompanham o candidato.

A futura assinatura precisa respeitar o formato do payload anexado. Não tratar a geração do candidato como aprovação para distribuição.
