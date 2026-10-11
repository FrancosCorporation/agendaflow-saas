// AgendaFlow M1 — núcleo: usuários (JWT) + organizações + profissionais + horários + agendamentos (CRUD completo).
// Regra de conflito: um profissional não pode ter 2 agendamentos no mesmo horário.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const SEGREDO = process.env.JWT_SECRET ?? (
  process.env.NODE_ENV === 'test' ? 'agendaflow-test-secret-only-32-bytes-min' : undefined
);
if (!SEGREDO || Buffer.byteLength(SEGREDO, 'utf8') < 32) {
  throw new Error('JWT_SECRET ausente ou curto — defina um segredo com pelo menos 32 bytes.');
}

function falha(codigo, mensagem) {
  return Object.assign(new Error(mensagem), { codigo });
}

function emailNormalizado(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function dataValida(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const valor = new Date(`${data}T00:00:00Z`);
  return Number.isFinite(valor.valueOf()) && valor.toISOString().slice(0, 10) === data;
}

export function criarNucleo(caminhoDb = 'agendaflow.db') {
  const db = new DatabaseSync(caminhoDb);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS organizacoes (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL, dono_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profissionais (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, nome TEXT NOT NULL, area TEXT DEFAULT 'geral'
  );
  CREATE TABLE IF NOT EXISTS agendamentos (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, profissional_id TEXT NOT NULL,
    cliente_email TEXT NOT NULL, cliente_nome TEXT NOT NULL,
    data TEXT NOT NULL, hora TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','concluido','cancelado')),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);

  // Bancos antigos podem conter reservas duplicadas. Nesse caso, preservamos os
  // registros e mantemos a transação BEGIN IMMEDIATE como proteção para novas reservas.
  const duplicadoAtivo = db.prepare(`
    SELECT 1 FROM agendamentos
    WHERE status = 'agendado'
    GROUP BY profissional_id, data, hora
    HAVING COUNT(*) > 1
    LIMIT 1
  `).get();
  if (!duplicadoAtivo) {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_agendamentos_horario_ativo
      ON agendamentos (profissional_id, data, hora) WHERE status = 'agendado'`);
  } else {
    console.warn('[AgendaFlow] Há horários ativos duplicados no banco legado; índice único não criado. Resolva os conflitos existentes para habilitá-lo.');
  }
  const emailDuplicadoPorCaixa = db.prepare('SELECT 1 FROM usuarios GROUP BY lower(email) HAVING COUNT(*) > 1 LIMIT 1').get();
  if (!emailDuplicadoPorCaixa) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email_canonico ON usuarios (lower(email))');
  } else {
    console.warn('[AgendaFlow] Há contas com e-mails que diferem apenas por maiúsculas/minúsculas; índice de e-mail normalizado não criado.');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS planos (
      usuario_id TEXT PRIMARY KEY,
      plano TEXT NOT NULL CHECK (plano IN ('free', 'pro')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return {
    db,

    // ---- auth ----
    registrar({ nome, email, senha } = {}) {
      const emailCanonico = emailNormalizado(email);
      if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 120 ||
          !/^[^\s@]+@[^\s@]+$/.test(emailCanonico) || emailCanonico.length > 254 ||
          typeof senha !== 'string' || senha.length < 6 || senha.length > 128) {
        throw falha('dados', 'nome, e-mail e senha (>=6) obrigatórios');
      }
      if (db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(emailCanonico)) throw falha('email', 'E-mail já cadastrado');
      const id = randomUUID();
      try {
        db.prepare('INSERT INTO usuarios (id, nome, email, senha_hash) VALUES (?, ?, ?, ?)').run(id, nome.trim(), emailCanonico, bcrypt.hashSync(senha, 10));
      } catch (e) {
        if (String(e.message).includes('UNIQUE constraint failed: usuarios.email') || String(e.message).includes('ux_usuarios_email_canonico')) throw falha('email', 'E-mail já cadastrado');
        throw e;
      }
      return { id, nome: nome.trim(), email: emailCanonico };
    },

    login({ email, senha } = {}) {
      const emailCanonico = emailNormalizado(email);
      const u = db.prepare('SELECT * FROM usuarios WHERE lower(email) = ?').get(emailCanonico);
      if (!u || typeof senha !== 'string' || !bcrypt.compareSync(senha, u.senha_hash)) throw falha('credenciais', 'Credenciais inválidas');
      const token = jwt.sign({ sub: u.id, nome: u.nome }, SEGREDO, { expiresIn: '24h' });
      return { token, usuario: { id: u.id, nome: u.nome, email: u.email } };
    },

    verificarToken(token) {
      try {
        const payload = jwt.verify(token, SEGREDO, { algorithms: ['HS256'] });
        return typeof payload.sub === 'string' && payload.sub ? payload : null;
      } catch { return null; }
    },

    // ---- organização/profissionais ----
    criarOrg(donoId, nome) {
      if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 120) throw falha('dados', 'nome da organização obrigatório (até 120 caracteres)');
      const id = randomUUID();
      db.prepare('INSERT INTO organizacoes (id, nome, dono_id) VALUES (?, ?, ?)').run(id, nome.trim(), donoId);
      return { id, nome: nome.trim() };
    },

    listarOrgs(donoId) {
      return db.prepare('SELECT id, nome FROM organizacoes WHERE dono_id = ? ORDER BY nome, id').all(donoId);
    },

    criarProfissional(donoId, orgId, nome, area = 'geral') {
      const org = db.prepare('SELECT id FROM organizacoes WHERE id = ? AND dono_id = ?').get(orgId, donoId);
      if (!org) {
        const existe = db.prepare('SELECT id FROM organizacoes WHERE id = ?').get(orgId);
        throw falha(existe ? '403' : '404', existe ? 'acesso negado' : 'organização não encontrada');
      }
      if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 120) throw falha('dados', 'nome do profissional obrigatório (até 120 caracteres)');
      const id = randomUUID();
      const areaNormalizada = typeof area === 'string' && area.trim() ? area.trim().slice(0, 80) : 'geral';
      db.prepare('INSERT INTO profissionais (id, org_id, nome, area) VALUES (?, ?, ?, ?)').run(id, orgId, nome.trim(), areaNormalizada);
      return { id, nome: nome.trim(), area: areaNormalizada };
    },

    listarProfissionais(orgId) {
      return db.prepare('SELECT * FROM profissionais WHERE org_id = ?').all(orgId);
    },

    // ---- agendamentos (CRUD COMPLETO: criar, listar, editar, deletar, cancelar) ----
    agendar({ orgId, profissionalId, clienteEmail, clienteNome, data, hora } = {}) {
      if ([orgId, profissionalId, clienteEmail, clienteNome, data, hora].some((valor) => typeof valor !== 'string' || !valor.trim())) {
        throw falha('dados', 'todos os campos obrigatórios');
      }
      if (!dataValida(data)) throw falha('data', 'data YYYY-MM-DD inválida');
      if (typeof hora !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw falha('hora', 'hora HH:MM inválida');
      const emailCanonico = emailNormalizado(clienteEmail);
      if (!/^[^\s@]+@[^\s@]+$/.test(emailCanonico) || emailCanonico.length > 254 ||
          typeof clienteNome !== 'string' || !clienteNome.trim() || clienteNome.trim().length > 120) {
        throw falha('dados', 'nome e e-mail válidos são obrigatórios');
      }
      const profissional = db.prepare('SELECT org_id FROM profissionais WHERE id = ?').get(profissionalId);
      if (!profissional || profissional.org_id !== orgId) throw falha('dados', 'profissional não pertence à organização');

      let transacaoAberta = false;
      try {
        db.exec('BEGIN IMMEDIATE');
        transacaoAberta = true;
        const conflito = db.prepare(
          "SELECT id FROM agendamentos WHERE profissional_id = ? AND data = ? AND hora = ? AND status = 'agendado'"
        ).get(profissionalId, data, hora);
        if (conflito) throw falha('conflito', 'Horário já ocupado para este profissional');
        const id = randomUUID();
        db.prepare('INSERT INTO agendamentos (id, org_id, profissional_id, cliente_email, cliente_nome, data, hora) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, orgId, profissionalId, emailCanonico, clienteNome.trim(), data, hora);
        const agendamento = this.obter(id);
        db.exec('COMMIT');
        transacaoAberta = false;
        return agendamento;
      } catch (e) {
        if (transacaoAberta) db.exec('ROLLBACK');
        if (e.codigo === 'conflito') throw e;
        const conflito = db.prepare(
          "SELECT id FROM agendamentos WHERE profissional_id = ? AND data = ? AND hora = ? AND status = 'agendado'"
        ).get(profissionalId, data, hora);
        if (conflito) throw falha('conflito', 'Horário já ocupado para este profissional');
        throw e;
      }
    },

    listar(donoId, orgId, filtro = {}) {
      const org = db.prepare('SELECT id FROM organizacoes WHERE id = ? AND dono_id = ?').get(orgId, donoId);
      if (!org) throw Object.assign(new Error('organização não encontrada'), { codigo: '404' });
      let sql = 'SELECT * FROM agendamentos WHERE org_id = ?';
      const params = [orgId];
      if (filtro.clienteEmail) { sql += ' AND cliente_email = ?'; params.push(filtro.clienteEmail); }
      if (filtro.status) { sql += ' AND status = ?'; params.push(filtro.status); }
      sql += ' ORDER BY data, hora';
      return db.prepare(sql).all(...params);
    },

    obter(id) {
      return db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id) || null;
    },

    // D1: garante que o agendamento pertence a uma org do usuário (anti-IDOR)
    obterDe(donoId, id) {
      const ag = this.obter(id);
      if (!ag) throw Object.assign(new Error('agendamento não encontrado'), { codigo: '404' });
      const org = db.prepare('SELECT id FROM organizacoes WHERE id = ? AND dono_id = ?').get(ag.org_id, donoId);
      if (!org) throw Object.assign(new Error('acesso negado'), { codigo: '403' });
      return ag;
    },

    // EDITAR: muda data/hora/nome (com checagem de conflito exceto o próprio)
    editar(donoId, id, mudancas = {}) {
      if (!mudancas || typeof mudancas !== 'object' || Array.isArray(mudancas)) throw falha('dados', 'alterações inválidas');
      db.exec('BEGIN IMMEDIATE');
      try {
        const ag = this.obterDe(donoId, id);
        const novaData = mudancas.data || ag.data;
        const novaHora = mudancas.hora || ag.hora;
        if (mudancas.data && !dataValida(novaData)) throw falha('data', 'data YYYY-MM-DD inválida');
        if (mudancas.hora && (typeof novaHora !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(novaHora))) {
          throw falha('hora', 'hora HH:MM inválida');
        }
        if (ag.status === 'agendado' && (mudancas.data || mudancas.hora)) {
          if (!dataValida(novaData)) throw falha('data', 'data YYYY-MM-DD inválida');
          if (typeof novaHora !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(novaHora)) throw falha('hora', 'hora HH:MM inválida');
          const conflito = db.prepare(
            "SELECT id FROM agendamentos WHERE profissional_id = ? AND data = ? AND hora = ? AND status = 'agendado' AND id != ?"
          ).get(ag.profissional_id, novaData, novaHora, id);
          if (conflito) throw falha('conflito', 'Horário já ocupado para este profissional');
        }
        const nome = typeof mudancas.clienteNome === 'string' && mudancas.clienteNome.trim()
          ? mudancas.clienteNome.trim().slice(0, 120) : ag.cliente_nome;
        db.prepare('UPDATE agendamentos SET data = ?, hora = ?, cliente_nome = ? WHERE id = ?').run(novaData, novaHora, nome, id);
        const atualizado = this.obter(id);
        db.exec('COMMIT');
        return atualizado;
      } catch (e) {
        db.exec('ROLLBACK');
        if (e.codigo === 'conflito') throw e;
        if (String(e.message).includes('UNIQUE constraint failed: agendamentos.profissional_id')) {
          throw falha('conflito', 'Horário já ocupado para este profissional');
        }
        throw e;
      }
    },

    // CANCELAR (soft delete: status cancelado — histórico preservado)
    cancelar(donoId, id) {
      const ag = this.obterDe(donoId, id);
      db.prepare("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?").run(id);
      return this.obter(id);
    },

    // DELETAR de verdade (remove do banco — o cliente quer sumir com aquilo)
    deletar(donoId, id) {
      this.obterDe(donoId, id);
      db.prepare('DELETE FROM agendamentos WHERE id = ?').run(id);
      return { deletado: true, id };
    },

    // libera o horário ao cancelar/deletar (o conflito some)
    horariosLivres(profissionalId, data, orgId) {
      if (!dataValida(data)) return [];
      if (orgId) {
        const profissional = db.prepare('SELECT id FROM profissionais WHERE id = ? AND org_id = ?').get(profissionalId, orgId);
        if (!profissional) return [];
      }
      const ocupados = db.prepare(
        "SELECT hora FROM agendamentos WHERE profissional_id = ? AND data = ? AND status = 'agendado'"
      ).all(profissionalId, data).map((r) => r.hora);
      const todos = [];
      for (let h = 8; h < 18; h++) todos.push(`${String(h).padStart(2, '0')}:00`);
      return todos.filter((h) => !ocupados.includes(h));
    }
  };
}
