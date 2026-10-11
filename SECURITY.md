# Segurança

## Relatar uma vulnerabilidade

Não publique detalhes de uma vulnerabilidade ainda explorável em uma issue pública. Entre em
contato com a equipe responsável pelo repositório e inclua os passos para reproduzir, o impacto
observado e uma forma segura de contato.

## Controles atuais

- `JWT_SECRET` é obrigatório e precisa ter ao menos 32 bytes; a troca invalida os tokens existentes.
- Tokens são verificados com HS256 e as rotas privadas conferem a organização do dono.
- Limites de tentativas são mantidos em memória por processo. Em produção com múltiplas réplicas,
  use um armazenamento compartilhado e configure proxies confiáveis de acordo com a topologia.
- Dados de clientes só são retornados em rotas privadas. O agendamento público valida que o
  profissional pertence à organização informada e impede reservas ativas duplicadas.
- SQLite e arquivos de ambiente locais são ignorados pelo Git e excluídos do contexto Docker.
- O checkout atual é uma simulação; não aceite pagamentos reais com ele.
