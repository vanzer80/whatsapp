# Dados e relatos de segurança

Este projeto lida com uma sessão de WhatsApp e com acesso a conversas. Para contribuir, use exemplos simulados e contas de teste sob seu controle. O código não exige que o proprietário do projeto compartilhe a própria sessão com os desenvolvedores.

Não envie ao repositório, às issues ou aos pull requests:

- Sessões do WhatsApp, QR code, tokens, cookies, arquivos `.env` ou chaves.
- Exportações de conversas, contatos, nomes reais de clientes ou documentos de manutenção.
- Arquivos locais `access.json`, `desktop-service.json`, perfis de navegador ou conteúdo da pasta de dados do aplicativo.

Se identificar uma falha que permita acessar dados ou executar código, primeiro comunique ao mantenedor por um canal privado já combinado. Não publique a prova com credenciais ou dados reais. O canal formal de relato ainda deverá ser configurado no repositório.

O escopo atual publica apenas ferramentas de leitura. A biblioteca da sessão não é uma barreira contra malware executando como o mesmo usuário ou como administrador. As proteções implementadas e os limites estão descritos em `DESENVOLVIMENTO.md`; os resultados realmente verificados estão em `RELATORIO-VALIDACAO.md`.
