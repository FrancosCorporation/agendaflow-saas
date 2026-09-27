// AgendaFlow M1 — núcleo: usuários (JWT) + organizações + profissionais + horários + agendamentos (CRUD completo).
// Regra de conflito: um profissional não pode ter 2 agendamentos no mesmo horário.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const SEGREDO = process.env.JWT_SECRET || 'agendaflow-dev-secret';

export function criarNucleo(caminhoDb = 'agendaflow.db') {
  const db = new DatabaseSync(caminhoDb);
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

  return {
    db,

    // ---- auth ----
    registrar({ nome, email, senha }) {
      if (!nome || !email || !senha || senha.length < 6) throw Object.assign(new Error('nome, email e senha (>=6) obrigatórios'), { codigo: 'dados' });
      if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) throw Object.assign(new Error('E-mail já cadastrado'), { codigo: 'email' });
      const id = randomUUID();
      db.prepare('INSERT INTO usuarios (id, nome, email, senha_hash) VALUES (?, ?, ?, ?)').run(id, nome, email, bcrypt.hashSync(senha, 10));
      return { id, nome, email };
    },

    login({ email, senha }) {
      const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
      if (!u || !bcrypt.compareSync(senha, u.senha_hash)) throw Object.assign(new Error('Credenciais inválidas'), { codigo: 'credenciais' });
      const token = jwt.sign({ sub: u.id, nome: u.nome }, SEGREDO, { expiresIn: '24h' });
      return { token, usuario: { id: u.id, nome: u.nome, email: u.email } };
    },

    verificarToken(token) {
      try { return jwt.verify(token, SEGREDO); } catch { return null; }
    },

    // ---- organização/profissionais ----
    criarOrg(donoId, nome) {
      const id = randomUUID().slice(0, 10);
      db.prepare('INSERT INTO organizacoes (id, nome, dono_id) VALUES (?, ?, ?)').run(id, nome, donoId);
      return { id, nome };
    },

    criarProfissional(orgId, nome, area = 'geral') {
      const id = randomUUID().slice(0, 10);
      db.prepare('INSERT INTO profissionais (id, org_id, nome, area) VALUES (?, ?, ?, ?)').run(id, orgId, nome, area);
      return { id, nome, area };
    },

    listarProfissionais(orgId) {
      return db.prepare('SELECT * FROM profissionais WHERE org_id = ?').all(orgId);
    },

    // ---- agendamentos (CRUD COMPLETO: criar, listar, editar, deletar, cancelar) ----
    agendar({ orgId, profissionalId, clienteEmail, clienteNome, data, hora }) {
      if (!orgId || !profissionalId || !clienteEmail || !clienteNome || !data || !hora) {
        throw Object.assign(new Error('todos os campos obrigatórios'), { codigo: 'dados' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw Object.assign(new Error('data YYYY-MM-DD'), { codigo: 'data' });
      if (!/^\d{2}:\d{2}$/.test(hora)) throw Object.assign(new Error('hora HH:MM'), { codigo: 'hora' });
      // REGRA DE CONFLITO: profissional já tem agendamento ATIVO nesse horário?
      const conflito = db.prepare(
        "SELECT id FROM agendamentos WHERE profissional_id = ? AND data = ? AND hora = ? AND status = 'agendado'"
      ).get(profissionalId, data, hora);
      if (conflito) throw Object.assign(new Error('Horário já ocupado para este profissional'), { codigo: 'conflito' });
      const id = randomUUID().slice(0, 10);
      db.prepare('INSERT INTO agendamentos (id, org_id, profissional_id, cliente_email, cliente_nome, data, hora) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, orgId, profissionalId, clienteEmail, clienteNome, data, hora);
      return this.obter(id);
    },

    listar(orgId, filtro = {}) {
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

    // EDITAR: muda data/hora/nome (com checagem de conflito exceto o próprio)
    editar(id, mudancas = {}) {
      const ag = this.obter(id);
      if (!ag) throw Object.assign(new Error('agendamento não encontrado'), { codigo: '404' });
      const novaData = mudancas.data || ag.data;
      const novaHora = mudancas.hora || ag.hora;
      if (mudancas.data || mudancas.hora) {
        const conflito = db.prepare(
          "SELECT id FROM agendamentos WHERE profissional_id = ? AND data = ? AND hora = ? AND status = 'agendado' AND id != ?"
        ).get(ag.profissional_id, novaData, novaHora, id);
        if (conflito) throw Object.assign(new Error('Horário já ocupado para este profissional'), { codigo: 'conflito' });
      }
      const nome = mudancas.clienteNome || ag.cliente_nome;
      db.prepare('UPDATE agendamentos SET data = ?, hora = ?, cliente_nome = ? WHERE id = ?').run(novaData, novaHora, nome, id);
      return this.obter(id);
    },

    // CANCELAR (soft delete: status cancelado — histórico preservado)
    cancelar(id) {
      const ag = this.obter(id);
      if (!ag) throw Object.assign(new Error('agendamento não encontrado'), { codigo: '404' });
      db.prepare("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?").run(id);
      return this.obter(id);
    },

    // DELETAR de verdade (remove do banco — o cliente quer sumir com aquilo)
    deletar(id) {
      const ag = this.obter(id);
      if (!ag) throw Object.assign(new Error('agendamento não encontrado'), { codigo: '404' });
      db.prepare('DELETE FROM agendamentos WHERE id = ?').run(id);
      return { deletado: true, id };
    },

    // libera o horário ao cancelar/deletar (o conflito some)
    horariosLivres(profissionalId, data) {
      const ocupados = db.prepare(
        "SELECT hora FROM agendamentos WHERE profissional_id = ? AND data = ? AND status = 'agendado'"
      ).all(profissionalId, data).map((r) => r.hora);
      const todos = [];
      for (let h = 8; h < 18; h++) todos.push(`${String(h).padStart(2, '0')}:00`);
      return todos.filter((h) => !ocupados.includes(h));
    }
  };
}
