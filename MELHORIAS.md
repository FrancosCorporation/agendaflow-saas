# MELHORIAS — agendaflow-saas

> **Gerado por análise de código em 2026-10-02** · Stack: Node 22 (Express + `node:sqlite` + JWT + BCrypt)
> Branch `main` · base `3949fe3` (M2: planos + Stripe simulado + analytics, 12/12 testes) · 636 LOC · **2 suites de teste** · CI presente
>
> **Este arquivo é um plano de execução.** Cada item tem ID, `arquivo:linha`, mudança exata,
> critério de aceite e comando de verificação.

---

## 0. Como usar este documento

1. Execute na ordem **P0 → P1 → P2 → P3**, respeitando as ondas da §8.
2. Ao terminar um item: marque `- [x]`, rode o **Verificação**, comite `fix(<ID>): descrição`.
3. **Não reescreva o núcleo.** `src/nucleo.js` tem SQL parametrizado, transação implícita e 12
   testes verdes — os defeitos são de **autorização e de configuração**, não de modelagem.
4. **O agendamento público é intencional** (`POST /api/agendamentos` sem auth, `server.js:40` —
   é como cliente marca horário). Não "corrija" fechando-o; proteja-o de outro jeito (`SEC-05`).
5. **Idioma:** português; commits em inglês com `fix:`/`feat:`/`docs:`.

---

## 1. Diagnóstico executivo

SaaS de agendamentos multi-tenant: donos criam organizações e profissionais, clientes agendam por
horário livre, e o M2 adiciona planos (free/pro) com gate, checkout Stripe simulado e analytics do
dono. São 6 arquivos de código com 12 testes e CI — o projeto mais enxuto e mais testado da Wave 2.

**O que está bem (não refaça):**

| Item | Evidência |
|---|---|
| Senha com BCrypt custo 10 | `nucleo.js:39` |
| SQL 100% parametrizado | todas as queries usam `?` — `nucleo.js:37,39,57,63,79-81,90-95,110,115,123,131` |
| Regra de conflito coberta (criar **e** editar) | `nucleo.js:79-82` e `:109-112` (editar exclui o próprio com `id != ?`) |
| Cancelamento é soft delete (preserva histórico) | `nucleo.js:120-125` |
| Path traversal bloqueado no estático | `server.js:53` |
| Erro mapeado para status (401/404/409/400) | `server.js:17` |
| Login com resposta uniforme | `nucleo.js:45` (mesma mensagem para usuário inexistente e senha errada) |
| CI + 12 testes verdes | `ci.yml`, `test/nucleo-test.mjs` + `test/m2-test.mjs` |

**O que está quebrado:** o token prova identidade, mas nenhum handler de escrita **pergunta se a
org é do dono**. `listar`, `editar`, `cancelar`, `deletar` e `criarProfissional` aceitam qualquer
`orgId`/`:id` de qualquer token — BOLA em 5 rotas. Há ainda o fallback de segredo hardcoded, o
`.db` commitado, planos em memória (perdidos no restart) e `Math.random` no ID de sessão Stripe.

---

## 2. Tabela de prioridades

| ID | Título | Sev | Arquivo | Depende de |
|---|---|---|---|---|
| SEC-01 | Fallback de segredo JWT hardcoded | **P0** | `src/nucleo.js:8` | — |
| SEC-02 | BOLA: `listar/editar/cancelar/deletar` sem checagem de dono | **P0** | `src/nucleo.js:89,103,120,128` | SEC-06 |
| SEC-03 | BOLA: `criarProfissional` em org de outro dono | **P0** | `src/nucleo.js:61` | SEC-06 |
| SEC-04 | `GET /api/agendamentos/:id` público permite enumeração | **P1** | `server.js:42` | SEC-06 |
| SEC-05 | `POST /api/agendamentos` público sem rate limit (spam) | **P1** | `server.js:40` | — |
| SEC-06 | Token verificado mas claims nunca propagadas (`req.usuario` só no server) | **P0** | `server.js:21-27` | — |
| SEC-07 | Login/register sem rate limit | **P1** | `server.js:30-31` | — |
| BUG-01 | Race condition no conflito (check-then-insert sem lock) | **P1** | `src/nucleo.js:79-86` | — |
| BUG-02 | Planos em `Map` na memória (perdidos no restart) | **P1** | `src/m2.js:12` | — |
| BUG-03 | `Math.random` no ID de sessão Stripe | **P1** | `src/m2.js:44` | — |
| BUG-04 | `randomUUID().slice(0,10)` truncado (colisão) | **P2** | `src/nucleo.js:56,62,83` | — |
| IMP-01 | Gate de plano só no M2, bypassável pela rota direta | **P2** | `server.js:34-35` | BUG-02 |
| TEST-01 | Testes não cobrem BOLA nem dono | **P1** | `test/nucleo-test.mjs` | SEC-02 |
| TEST-02 | Sem teste de race condition no conflito | **P2** | novo `test/` | BUG-01 |
| DEVOPS-01 | `agendaflow.db` commitado no repo | **P1** | `agendaflow.db` | — |
| DEVOPS-02 | Sem `.env.example` | **P2** | *(ausente)* | SEC-01 |
| DOC-01 | README não documenta o modelo de acesso público vs. dono | **P2** | `README.md` (69 linhas) | SEC-04 |
| DOC-02 | Stripe simulado não está marcado como simulado no README | **P3** | `README.md` | BUG-03 |

**Placar: 4 P0 · 8 P1 · 5 P2 · 1 P3 = 18 itens.**

---

## 3. Segurança
### SEC-01 · Fallback de segredo JWT hardcoded · [P0]

- **Arquivo:** `src/nucleo.js:8`
- **Evidência:** `const SEGREDO = process.env.JWT_SECRET || 'agendaflow-dev-secret';`
- **Impacto:** sem `JWT_SECRET`, a API sobe com segredo público. Token forjável com `sub` à escolha —
  e com BOLA aberta (`SEC-02`), o token forjado acessa qualquer org. É o mesmo padrão das APIs
  irmãs, mas aqui o nome do fallback (`agendaflow-dev-secret`) pelo menos avisa; ainda assim sobe.
- **Mudança:** falhar na inicialização sem a variável (mínimo 32 bytes), espelhando o padrão já
  adotado na casa:
  ```javascript
  const SEGREDO = process.env.JWT_SECRET;
  if (!SEGREDO || Buffer.byteLength(SEGREDO, 'utf8') < 32)
    throw new Error('JWT_SECRET nao definido ou curto (min 32 bytes). Exporte antes de iniciar.');
  ```
- **Aceite:** sem `JWT_SECRET` o processo morre com mensagem clara; com < 32 bytes também.
- **Verificação:**
  ```bash
  grep -n 'agendaflow-dev-secret' src/nucleo.js && echo FALHA || echo OK
  unset JWT_SECRET; node server.js 2>&1 | grep -qi 'JWT_SECRET' && echo OK
  JWT_SECRET=$(openssl rand -hex 32) timeout 2 node server.js & sleep 1; kill %1 2>/dev/null
  ```

### SEC-06 · Token verificado mas identidade não chega ao núcleo · [P0]

- **Arquivo:** `server.js:21-27` + `src/nucleo.js:89,103,120,128`
- **Evidência:** o `auth` guarda `req.usuario = payload` (linha 25), mas os métodos do núcleo
  (`listar`, `editar`, `cancelar`, `deletar`) **não recebem** o usuário — recebem só `orgId`/`:id`.
  É o mesmo defeito estrutural da `api_mongodb_query_money` (`SEC-03` de lá): a identidade existe no
  middleware e morre ali.
- **Impacto:** é a **raiz** dos `SEC-02`/`SEC-03`/`SEC-04`. Sem propagar `sub`, nenhuma checagem de
  dono é possível — todos os itens de autorização dependem deste.
- **Mudança:** passar `donoId = req.usuario.sub` para todo método que toca org/agendamento, e exigir
  `dono_id = ?` no SQL (o `analytics` em `m2.js:50` já faz `WHERE id = ? AND dono_id = ?` — é o
  padrão a replicar).
- **Aceite:** todo método de escrita/leitura de org recebe `donoId` e filtra por ele.
- **Verificação:**
  ```bash
  grep -n 'dono_id = ?' src/nucleo.js   # presente em listar/editar/cancelar/deletar
  ```

### SEC-02 · BOLA em `listar/editar/cancelar/deletar` (sem checagem de dono) · [P0]

- **Arquivo:** `src/nucleo.js:89` (`listar`), `:103` (`editar`), `:120` (`cancelar`), `:128` (`deletar`)
- **Evidência:**
  ```javascript
  listar(orgId, filtro = {}) { ... 'SELECT * FROM agendamentos WHERE org_id = ?' ... }
  editar(id, mudancas = {}) { const ag = this.obter(id); ... }
  ```
  `listar` filtra por `orgId` vindo de `req.query.orgId` **sem** conferir dono (`server.js:41`).
  `editar`/`cancelar`/`deletar` operam por `:id` (`server.js:43-45`) sem conferir dono.
- **Impacto:** token do dono A lista, edita, cancela ou **deleta** agendamentos da org do dono B —
  basta conhecer o `orgId` (enumerável, ver `SEC-04`) ou o `:id` (10 chars, `BUG-04`). Deletar é
  **hard delete** (`nucleo.js:131`), sem volta. Numa agenda real, isso é sabotagem de negócio.
- **Mudança:** (requer `SEC-06`) em cada método, resolver a org do registro e comparar `dono_id`
  com o `sub` do token; divergência → `403` (nunca 404, para não vazar existência — ou 404
  uniforme, mas documentado; ver `TEST-01`).
- **Aceite:** token de A + `orgId`/`id` de B → `403` em listar, editar, cancelar e deletar.
- **Verificação:**
  ```bash
  # dono A logado, org de B conhecida:
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3111/api/agendamentos?orgId=$ORG_B" \
    -H "Authorization: Bearer $TOKEN_A"     # esperado 403
  curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:3111/api/agendamentos/$ID_B \
    -H "Authorization: Bearer $TOKEN_A"     # esperado 403
  ```

### SEC-03 · BOLA em `criarProfissional` (org de outro dono) · [P0]

- **Arquivo:** `src/nucleo.js:61-65` · rota `server.js:35`
- **Evidência:** `criarProfissional(orgId, nome, area)` insere com o `orgId` da URL
  (`req.params.id`) sem conferir dono. Pior: a mesma falha existe no `criarProfissionalComPlano`
  (`m2.js:32-39`), que também não checa dono — só conta o limite do plano.
- **Impacto:** dono A cria profissional na org de B (poluição de catálogo alheio) e ainda consome
  a cota do plano de B. Como `horariosLivres` e `agendar` não checam dono, o profissional injetado
  vira vetor para agendar na org alheia.
- **Mudança:** checar `dono_id` da org antes de inserir (o `analytics` já faz esse `WHERE` duplo —
  replicar). Aplicar **também** em `criarProfissionalComPlano`.
- **Aceite:** `POST /api/orgs/<org-de-B>/profissionais` com token de A → `403`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3111/api/orgs/$ORG_B/profissionais \
    -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' -d '{"nome":"x"}'
  # esperado 403
  ```

### SEC-04 · `GET /api/agendamentos/:id` público permite enumeração · [P1]

- **Arquivo:** `server.js:42` (sem `auth`) · `nucleo.js:98-100` (`obter`)
- **Evidência:** a rota de detalhe **não** passa pelo `auth`, enquanto `listar` (linha 41) passa.
  `obter` devolve o registro inteiro (incluindo `cliente_email` e `cliente_nome`).
- **Impacto:** `id` tem 10 chars (`BUG-04`), mas `listarProfissionais`/`horariosLivres` são públicos
  e o fluxo normal vaza IDs (confirmação de agendamento). Com o ID, qualquer um lê nome+e-mail do
  cliente de terceiro — vazamento de PII sem autenticação. A assimetria (listar exige token, detalhe
  não) sugere esquecimento, não decisão.
- **Mudança:** (1) exigir `auth` na rota; (2) **além** disso, checar dono (liga ao `SEC-02`);
  (3) se houver caso legítimo de "cliente vê seu agendamento", criar rota dedicada com token
  opaco de acesso único (não o `:id` sequencial).
- **Aceite:** `GET /api/agendamentos/<id>` sem token → `401`; com token de outro dono → `403`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3111/api/agendamentos/$ID   # 401
  ```

### SEC-05 · `POST /api/agendamentos` público sem rate limit · [P1]

- **Arquivo:** `server.js:40` (sem `auth`, por desenho — ver §0.4)
- **Evidência:** a rota de agendamento é pública **e** sem limite. Cada chamada faz 2-3 queries
  (conflito + insert + select).
- **Impacto:** spam de agendamentos falsos enche a agenda do profissional (e o banco), e cada um
  bloqueia horário real via regra de conflito — DoS de negócio: a agenda legítima fica indisponível.
  Sem rate limit, um loop preenche o dia inteiro em segundos.
- **Mudança:** (1) rate limit por IP (ex.: 10/h) + por `clienteEmail` + por `(profissionalId, data)`;
  (2) CAPTCHA ou prova leve (honeypot + tempo mínimo de preenchimento) no front; (3) confirmação
  por e-mail antes de bloquear o horário (reserva pendente com TTL, não bloqueio imediato).
- **Aceite:** 11º agendamento na mesma hora/IP → `429`; agendamento legítimo espaçado passa.
- **Verificação:**
  ```bash
  for i in $(seq 1 12); do
    curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3111/api/agendamentos \
      -H 'Content-Type: application/json' -d '{"orgId":"o","profissionalId":"p","clienteEmail":"s@s.com","clienteNome":"s","data":"2026-12-01","hora":"09:00"}'
  done; echo; # esperado: 201s e depois 429s
  ```

### SEC-07 · Login/register sem rate limit · [P1]

- **Arquivo:** `server.js:30-31`
- **Evidência:** rotas públicas diretas ao `nucleo.registrar`/`login` (bcrypt custo 10 por chamada).
  Nenhum contador, janela ou bloqueio.
- **Impacto:** brute-force de senha + enumeração de e-mail (o `409` de e-mail repetido em
  `nucleo.js:37` distingue "existe" de "não existe"). E cada tentativa custa um BCrypt — o atacante
  ainda impõe custo de CPU ao servidor (DoS assimétrico barato).
- **Mudança:** (1) rate limit por IP (ex.: 20/5 min) + por e-mail (5/5 min) → `429`;
  (2) resposta **uniforme** no register (não distinguir 409 de sucesso por tempo — ou documentar que
  o 409 é aceitável porque o e-mail é identificador público do negócio).
- **Aceite:** 6ª tentativa no mesmo e-mail em 5 min → `429`.
- **Verificação:**
  ```bash
  for i in $(seq 1 7); do
    curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3111/api/login \
      -H 'Content-Type: application/json' -d '{"email":"a@a.com","password":"x"}'
  done; echo   # esperado: 401s e depois 429s
  ```
---

## 4. Bugs e defeitos funcionais

### BUG-01 · Race condition no conflito (check-then-insert sem lock) · [P1]

- **Arquivo:** `src/nucleo.js:79-86`
- **Evidência:** SELECT de conflito (linhas 79-81) e INSERT (linhas 84-85) são **duas operações
  separadas**, sem transação e sem constraint no banco. O schema (`nucleo.js:22-28`) não tem
  `UNIQUE(profissional_id, data, hora)`.
- **Impacto:** dois agendamentos simultâneos para o mesmo profissional/horário **passam ambos** no
  SELECT e inserem duas linhas — double-booking real. Em produção com 2 clientes clicando juntos
  (ou retry de rede), o profissional tem 2 clientes no mesmo horário e só descobre na hora.
- **Mudança:** (1) adicionar `UNIQUE(profissional_id, data, hora, status)` — com `status` para
  permitir reagendar após cancelar (cancelado não conflita); (2) envolver SELECT+INSERT em transação
  (`db.exec('BEGIN IMMEDIATE')` — o `DatabaseSync` é síncrono, então basta a constraint + tratamento
  de `SQLITE_CONSTRAINT` → `409 conflito`); (3) teste de concorrência (`TEST-02`).
- **Aceite:** dois INSERTs simultâneos no mesmo slot → um `201`, outro `409`.
- **Verificação:**
  ```bash
  node --test test/concorrencia-test.mjs   # apos TEST-02
  sqlite3 agendaflow.db '.schema agendamentos' | grep -i unique
  ```

### BUG-02 · Planos em `Map` na memória (perdidos no restart) · [P1]

- **Arquivo:** `src/m2.js:12` (`const planos = new Map();`)
- **Evidência:** `upgrade()` (linha 20) escreve só no `Map`; `planoDe()` (linha 18) lê do `Map` com
  default `'free'`. Nada persiste.
- **Impacto:** **todo upgrade para `pro` é perdido no restart**. O cliente paga (Stripe simulado
  hoje, real amanhã), o servidor reinicia (deploy, crash, reboot) e ele volta a `free` — com orgs
  e profissionais acima do limite travados pelo gate (`criarOrgComPlano`, linha 23). É perda de
  direito adquirido + estado inconsistente (recursos que existem mas não podem ser criados de novo).
- **Mudança:** (1) tabela `planos (usuario_id PK, plano, atualizado_em)` no SQLite; (2) `upgrade` e
  `planoDe` leem/escrevem nela; (3) migração: na primeira execução, semear do `Map` atual (vazio —
  sem impacto, mas o código de migração evita surpresa futura).
- **Aceite:** `upgrade` → restart do processo → `planoDe` ainda devolve `pro`.
- **Verificação:**
  ```bash
  node -e "import('./src/m2.js').then(m=>{const n=m.criarNucleoM2(':memory:');n.upgrade('u1');console.log(n.planoDe('u1'))})"
  # apos a mudanca, repetir com restart real entre upgrade e leitura
  ```

### BUG-03 · `Math.random` no ID de sessão Stripe · [P1]

- **Arquivo:** `src/m2.js:44`
- **Evidência:** `` `cs_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` ``
- **Impacto:** `Math.random` **não** é CSPRNG — IDs de sessão de pagamento previsíveis permitem
  adivinhar sessão alheia e, se o checkout confiar no ID, sequestrar/confundir pagamento. Hoje é
  simulado (`m2.js:41-46`), mas o formato `cs_test_*` imita o real — quando ligar o Stripe de
  verdade, o padrão inseguro vai junto se ninguém trocar.
- **Mudança:** `randomUUID()` (já importado em `nucleo.js:6`) ou `randomBytes(16).toString('hex')`
  para o sufixo. Regra da casa: `Math.random` nunca em identificador de pagamento/sessão/token.
- **Aceite:** nenhum `Math.random` em `src/m2.js`.
- **Verificação:**
  ```bash
  grep -n 'Math.random' src/m2.js && echo FALHA || echo OK
  ```

### BUG-04 · `randomUUID().slice(0,10)` truncado (colisão) · [P2]

- **Arquivo:** `src/nucleo.js:56,62,83` (`randomUUID().slice(0, 10)`)
- **Evidência:** UUID v4 tem 122 bits; cortado para 10 chars hex = **40 bits**. Em `criarOrg`,
  `criarProfissional` e `agendar`.
- **Impacto:** com 40 bits, a colisão chega a 50% em ~1M de registros (aniversário) — improvável hoje,
  mas o truncamento também **reduz a imprevisibilidade** do ID (facilita `SEC-04`). E IDs curtos
  sequenciais aparentes são enumeráveis.
- **Mudança:** usar o UUID completo (36 chars) como PK — o SQLite não se importa; ou no mínimo 16
  chars hex (64 bits). Atualizar os 3 pontos juntos.
- **Aceite:** nenhum `.slice(0, 10)` em ID gerado.
- **Verificação:**
  ```bash
  grep -n 'slice(0, 10)' src/nucleo.js && echo FALHA || echo OK
  ```

### IMP-01 · Gate de plano bypassável pela rota direta · [P2]

- **Arquivo:** `server.js:34-35` (rotas chamam `criarOrg`/`criarProfissional` do M1, não o `...ComPlano` do M2)
- **Evidência:** as rotas usam `nucleo.criarOrg` e `nucleo.criarProfissional` — as versões **sem** gate.
  As versões com gate (`criarOrgComPlano`, `m2.js:23`; `criarProfissionalComPlano`, `m2.js:32`)
  **não são chamadas por nenhuma rota** (`grep` confirma: só o teste `m2-test.mjs` as usa).
- **Impacto:** o plano `free` **não limita nada** em produção — o gate existe só no teste. Usuário free
  cria N orgs pela API direta. É funcionalidade anunciada (commit `3949fe3`: "gate") que não está
  ligada.
- **Mudança:** (1) trocar as rotas para `criarOrgComPlano(req.usuario.sub, ...)` e
  `criarProfissionalComPlano(orgId, req.usuario.sub, ...)`; (2) mapear `codigo: 'plano'` para `403`
  no `erro()` (`server.js:17` — hoje cai em `500`); (3) `TEST-01` cobre o gate pela rota.
- **Aceite:** usuário free com 1 org → `POST /api/orgs` devolve `403 plano`.
- **Verificação:**
  ```bash
  # usuario free com 1 org existente:
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3111/api/orgs \
    -H "Authorization: Bearer $TOKEN_FREE" -H 'Content-Type: application/json' -d '{"nome":"x"}'
  # esperado 403 (hoje: 201)
  ```

---

## 5. Qualidade: testes, arquitetura e observabilidade

### TEST-01 · Testes cobrem CRUD mas não autorização · [P1]

- **Arquivo:** `test/nucleo-test.mjs` (101 linhas), `test/m2-test.mjs` (72 linhas)
- **Evidência:** 12 testes cobrem conflito, CRUD, planos e analytics — mas **nenhum** cria dois donos
  e tenta cruzar org. O `grep -c 'dono.*B\|outro.*dono\|403' test/*.mjs` retorna vazio.
- **Impacto:** os 3 P0 de BOLA (`SEC-02`, `SEC-03`) sobrevivem porque o teste valida "funciona para
  mim", nunca "não funciona para ele" — o mesmo padrão que deixou BOLA passar na
  `api_mongodb_query_money`.
- **Mudança:** adicionar casos que devem **falhar com 403**: A lista org de B; A edita/cancela/deleta
  agendamento de B; A cria profissional na org de B; free cria 2ª org (403 plano).
- **Aceite:** `npm test` inclui os 5 casos; remover uma checagem de dono quebra o build.
- **Verificação:**
  ```bash
  npm test 2>&1 | tail -3   # 17/17 (12 antigos + 5 novos)
  ```

### TEST-02 · Sem teste de concorrência no conflito · [P2]

- **Arquivo:** novo `test/concorrencia-test.mjs`
- **Evidência:** o `BUG-01` (race) não tem cobertura — o teste atual chama `agendar` sequencialmente.
- **Impacto:** a correção do `BUG-01` (constraint + transação) não tem como ser provada sem teste
  que dispare N agendamentos simultâneos no mesmo slot.
- **Mudança:** com `Promise.all` (ou workers), disparar 20 `agendar` no mesmo
  `(profissional, data, hora)`; assert: exatamente 1 `201` e 19 `409`.
- **Aceite:** o teste passa com a constraint e falha sem ela.
- **Verificação:**
  ```bash
  node --test test/concorrencia-test.mjs
  ```

---

## 6. DevOps / Infra

### DEVOPS-01 · `agendaflow.db` commitado no repo · [P1]

- **Arquivo:** `agendaflow.db` (na raiz, trackeado)
- **Evidência:** `git ls-files | grep '\.db$'` lista o arquivo; `.gitignore` (5 linhas) não o cobre.
- **Impacto:** **dados de usuário versionados**: cada `git pull` pode trazer (ou sobrescrever) banco
  com e-mails e agendamentos reais. E cada commit do dev inclui o banco local — histórico inchado
  com binário que muda a cada teste. O `server.js:11` usa `AGENDAFLOW_DB || 'agendaflow.db'`, então
  o default aponta para o arquivo commitado.
- **Mudança:** (1) `git rm --cached agendaflow.db`; (2) adicionar `*.db` ao `.gitignore`;
  (3) documentar que dev usa `:memory:` ou arquivo local ignorado; (4) o teste já usa banco próprio
  (conferir que `test/*.mjs` não escreve no `agendaflow.db` da raiz).
- **Aceite:** `git ls-files | grep '\.db$'` → vazio; testes continuam verdes.
- **Verificação:**
  ```bash
  git ls-files | grep -c '\.db$'   # 0
  npm test 2>&1 | tail -2
  ```

### DEVOPS-02 · Sem `.env.example` · [P2]

- **Arquivo:** *(ausente)* `.env.example`
- **Evidência:** `server.js:10-11` lê `PORT` e `AGENDAFLOW_DB`; `nucleo.js:8` lê `JWT_SECRET`.
  Nenhum exemplo versionado.
- **Impacto:** após o `SEC-01` (sem fallback), quem clona não sobe sem descobrir a variável por
  leitura de código.
- **Mudança:**
  ```
  PORT=3111
  AGENDAFLOW_DB=agendaflow.db
  JWT_SECRET=   # obrigatorio, min 32 bytes: openssl rand -hex 32
  ```
- **Aceite:** `.env.example` versionado cobre as 3 variáveis.
- **Verificação:** `diff` entre `process.env.*` do código e as chaves do exemplo.

---

## 7. Documentação

### DOC-01 · README não documenta o modelo de acesso público vs. dono · [P2]

- **Arquivo:** `README.md` (69 linhas)
- **Evidência:** o README descreve instalação e endpoints, mas não diz **quais rotas são públicas**
  (agendar, ver horários, ver profissionais) e **quais exigem dono**. Após `SEC-04`, a rota de
  detalhe muda de comportamento — sem doc, parece bug.
- **Impacto:** integrador não sabe o que expor no site do cliente vs. no painel do dono; e a
  assimetria atual (detalhe público, lista privada) parece intencional sem ser.
- **Mudança:** tabela público/privado por rota + nota sobre o token de acesso único (se adotado no
  `SEC-04`) + variáveis de ambiente.
- **Aceite:** tabela presente; exemplo de `curl` para os dois perfis.
- **Verificação:** `grep -n 'público\|dono\|token' README.md` retorna a seção.

### DOC-02 · Stripe simulado não está marcado como simulado · [P3]

- **Arquivo:** `README.md` · `src/m2.js:41-46`
- **Evidência:** o commit diz "Stripe test-mode", o código diz "SIMULADA", mas o README não
  avisa que **nenhuma cobrança real acontece**.
- **Impacto:** operador pode achar que o upgrade cobra de verdade — ou pior, ligar "o Stripe"
  sem implementar webhook de confirmação, liberando `pro` sem pagamento.
- **Mudança:** aviso explícito + checklist do que falta para Stripe real (webhook assinado,
  idempotência de evento, reconciliação — e `BUG-03` resolvido).
- **Aceite:** README diz "simulado" e lista os 3 requisitos para produção.
- **Verificação:** `grep -ni 'simulad' README.md`.

---

## 8. Ordem de execução (waves)

### Wave 1 — Travar autorização e segredo (P0)
1. **`SEC-06`** — propagar `donoId` do token para o núcleo. **Sem isso nada dos próximos é possível.**
2. **`SEC-01`** — remover o fallback e exigir `JWT_SECRET` (mínimo 32 bytes).
3. **`SEC-02`** — checagem de dono em `listar/editar/cancelar/deletar`.
4. **`SEC-03`** — checagem de dono em `criarProfissional` (+ versão com plano).

> Depois da Wave 1, um token só enxerga as próprias orgs.

### Wave 2 — Fechar a borda pública (P1)
5. **`SEC-04`** — `auth` + dono no detalhe (ou token opaco de acesso único).
6. **`SEC-05`** — rate limit no agendamento público (por IP, e-mail e slot).
7. **`SEC-07`** — rate limit no login/register.
8. **`BUG-01`** — `UNIQUE` + transação no conflito (com `TEST-02` junto).
9. **`BUG-02`** — persistir planos em tabela.
10. **`BUG-03`** — `randomUUID` no ID Stripe.
11. **`TEST-01`** — os 5 casos de autorização.

### Wave 3 — Ligar o que está solto (P2)
12. **`IMP-01`** — rotas passam a usar `...ComPlano` + `403 plano` mapeado.
13. **`BUG-04`** — UUID completo nos IDs.
14. **`DEVOPS-01`** — tirar o `.db` do índice + `*.db` no gitignore.
15. **`DEVOPS-02`** — `.env.example`.
16. **`DOC-01`** — tabela público/privado.

### Wave 4 — Avisos (P3)
17. **`DOC-02`** — marcar o Stripe como simulado + checklist do real.

**Dependências que não podem ser invertidas:**
`SEC-06` antes de `SEC-02`/`SEC-03`/`SEC-04` (sem identidade propagada não há comparação) ·
`BUG-01` junto com `TEST-02` (a correção precisa da prova) · `BUG-02` antes de `IMP-01` (o gate
precisa ler plano persistido) · `DEVOPS-01` antes de qualquer teste novo que escreva banco.

---

## 9. Fora de escopo / riscos

| Item | Decisão | Motivo |
|---|---|---|
| Fechar `POST /api/agendamentos` com auth | **Não** | É o fluxo do cliente final marcar horário; fechar quebra o produto. Proteger com rate limit (`SEC-05`), não com login. |
| Trocar SQLite por Postgres | **Não** | O volume não justifica; o `DatabaseSync` com constraint resolve o `BUG-01`. |
| Ligar o Stripe real | **Não, ainda** | Exige webhook assinado + idempotência + `BUG-03`. Ver `DOC-02`. |
| Migrar `m2.js` para tabelas normalizadas de billing | **Não** | Fora do escopo; a tabela `planos` do `BUG-02` basta. |
| Notificação por e-mail/SMS de agendamento | **Não** | Feature nova, não correção. |

**Riscos desta execução:**

- **`SEC-01` invalida todos os tokens.** Trocar o segredo desloga todo mundo — comunicar antes.
- **`SEC-04` pode quebrar link de confirmação.** Se o front manda o `:id` por e-mail/WhatsApp como
  "ver seu agendamento", fechar a rota exige o token opaco **na mesma mudança**.
- **`BUG-01` (`UNIQUE`) pode rejeitar dado legado.** Se o banco atual já tem duplicata (dois
  agendados no mesmo slot), a migração falha — limpar antes com query de deduplicação.
- **`BUG-02` (persistir planos) zera upgrades em memória.** Migrar os atuais (se houver) antes de
  trocar a implementação.

---

## 10. Definição de pronto (DoD)

**Segurança**
- [ ] `SEC-01` — sem fallback; sem `JWT_SECRET` (≥32 bytes) o processo não inicia
- [ ] `SEC-06` — todo método de org/agendamento recebe e filtra por `donoId`
- [ ] `SEC-02` — token de A em org/id de B → `403` nas 4 operações
- [ ] `SEC-03` — criar profissional em org alheia → `403`
- [ ] `SEC-04` — detalhe sem token → `401`; de outro dono → `403`
- [ ] `SEC-05` — 11º agendamento na hora/IP → `429`
- [ ] `SEC-07` — 6º login no e-mail em 5 min → `429`

**Funcional**
- [ ] `BUG-01` — 20 simultâneos no slot → 1×`201` + 19×`409`
- [ ] `BUG-02` — `upgrade` sobrevive ao restart
- [ ] `BUG-03` — nenhum `Math.random` em `src/m2.js`
- [ ] `BUG-04` — nenhum `.slice(0, 10)` em ID
- [ ] `IMP-01` — free com 1 org recebe `403 plano` na 2ª

**Testes e infra**
- [ ] `TEST-01` — 17/17 no `npm test` (12 + 5 de autorização)
- [ ] `TEST-02` — teste de concorrência verde (e vermelho sem a constraint)
- [ ] `DEVOPS-01` — nenhum `.db` no índice; testes verdes
- [ ] `DEVOPS-02` — `.env.example` com as 3 variáveis
- [ ] `DOC-01` — tabela público/privado no README
- [ ] `DOC-02` — aviso "simulado" + checklist Stripe real

**Validação final:**
```bash
npm test 2>&1 | tail -2   # 17/17
node --check server.js src/nucleo.js src/m2.js
git ls-files | grep -c '\\.db$'   # 0
```

---

*Fim do plano. Gerado por leitura direta do código em 2026-10-02. Nenhum item já estava corrigido*
*— todos apontam para defeitos ainda presentes.*
