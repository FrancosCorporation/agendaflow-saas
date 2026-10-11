# AgendaFlow

Aplicação de agendamentos para pequenos negócios. O painel permite administrar organizações,
profissionais e horários; a API mantém os dados em SQLite e separa as operações públicas das
operações do dono.

## Requisitos

- Node.js 22.5 ou superior (usa `node:sqlite`).
- Docker e Docker Compose, caso prefira executar em contêiner.
- `JWT_SECRET` com pelo menos 32 bytes.

## Executar localmente

Gere e exporte um segredo para o processo local:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
npm ci
npm start
```

Abra <http://localhost:3111>. Sem `JWT_SECRET` válido, o processo encerra na inicialização. O banco
local padrão é `agendaflow.db`; ele é ignorado pelo Git. Para usar outro caminho, defina
`AGENDAFLOW_DB`.

### Docker Compose

O Compose publica a porta apenas em `127.0.0.1` e mantém o banco em um volume persistente.
Copie `.env.example` para `.env`, substitua `JWT_SECRET` por um valor gerado com
`openssl rand -hex 32` e inicie:

```bash
docker compose up --build
```

Para expor o serviço na internet, use um proxy reverso com HTTPS e configure o proxy de confiança
na aplicação de acordo com a topologia real. O limitador de requisições usa o IP que o Express
conhece; por padrão, cabeçalhos `X-Forwarded-For` não são confiados.

## Acesso à API

As rotas públicas sustentam o fluxo de marcação. Rotas que mostram ou alteram dados do negócio
exigem `Authorization: Bearer <token>` obtido em `/api/login`.

| Acesso | Rota | Uso |
|---|---|---|
| Público, limitado | `POST /api/register` | Criar conta de dono |
| Público, limitado | `POST /api/login` | Entrar e receber token JWT |
| Público | `GET /api/orgs/:id/profissionais` | Mostrar a equipe disponível |
| Público | `GET /api/orgs/:id/horarios/:profId?data=YYYY-MM-DD` | Consultar horários livres |
| Público, limitado | `POST /api/agendamentos` | Marcar horário; o corpo inclui organização, profissional, nome/e-mail do cliente, data e hora |
| Dono | `GET /api/orgs` | Listar as próprias organizações |
| Dono | `POST /api/orgs` | Criar organização conforme o plano |
| Dono | `POST /api/orgs/:id/profissionais` | Adicionar profissional à própria organização |
| Dono | `GET /api/plano` | Consultar o plano da conta |
| Dono | `GET /api/orgs/:id/analytics` | Consultar indicadores da organização |
| Dono | `GET /api/agendamentos?orgId=:id` | Listar agendamentos da própria organização |
| Dono | `GET /api/agendamentos/:id` | Ver dados de um agendamento da própria organização |
| Dono | `PATCH /api/agendamentos/:id` | Alterar nome, data ou hora do cliente |
| Dono | `POST /api/agendamentos/:id/cancelar` | Cancelar sem apagar o histórico |
| Dono | `DELETE /api/agendamentos/:id` | Excluir permanentemente |

Exemplo de login e chamada autenticada:

```bash
TOKEN=$(curl -s http://localhost:3111/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dono@exemplo.com","senha":"senha-forte"}' | jq -r .token)
curl http://localhost:3111/api/orgs -H "Authorization: Bearer $TOKEN"
```

O token identifica o dono e cada consulta ou alteração de dados privados confere o vínculo com a
organização. O detalhe de agendamento exige autenticação; conhecer o identificador não concede
acesso aos dados do cliente.

### Limites e persistência

Login e cadastro permitem até 20 tentativas por IP e 5 por e-mail a cada cinco minutos. A criação
de agendamentos permite até 10 por IP e 5 por e-mail por hora, além de limitar tentativas por
profissional e data. Ao exceder o limite, a API responde `429` e informa `Retry-After`. Os contadores
são locais ao processo e reiniciam com ele; uma implantação com várias instâncias precisa de um
limitador compartilhado.

SQLite impede dois agendamentos ativos no mesmo horário, com transação e índice único parcial. Se
um banco antigo já tiver duplicatas ativas, a aplicação preserva os registros, avisa no log e não
cria o índice até que os conflitos sejam tratados. Não apague nem cancele reservas sem revisar os
dados primeiro.

## Planos e pagamentos

O plano `free` aceita uma organização e um profissional por dono; `pro` libera esses limites. O
estado do plano fica no SQLite e sobrevive a reinicializações. A rotina de checkout existente gera
apenas uma sessão de demonstração `cs_test_*`: não há cobrança real nem confirmação de upgrade por
provedor de pagamento.

Antes de integrar Stripe real, implemente validação de webhook assinado, idempotência de eventos e
reconciliação de assinaturas. O segredo JWT não tem fallback de desenvolvimento: trocá-lo invalida
tokens já emitidos, então planeje a rotação.

## Segurança

Consulte [SECURITY.md](SECURITY.md) para relatar vulnerabilidades. Nunca coloque o banco local,
segredos ou arquivos `.env` no Git.
