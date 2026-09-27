// Testes do AgendaFlow — CRUD COMPLETO: registrar/login → agendar → editar → cancelar → deletar + conflito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarNucleo } from '../src/nucleo.js';

const novaAgenda = () => criarNucleo(join(mkdtempSync(join(tmpdir(), 'af-')), 't.db'));
const DATA = '2026-10-05';

test('registro + login (JWT)', () => {
  const agenda = novaAgenda();
  const u = agenda.registrar({ nome: 'Rodolfo', email: 'rodrigo@agenda.dev', senha: 'segredo123' });
  assert.ok(u.id);
  const l = agenda.login({ email: 'rodrigo@agenda.dev', senha: 'segredo123' });
  assert.ok(l.token);
  assert.ok(agenda.verificarToken(l.token).sub);
  assert.throws(() => agenda.login({ email: 'rodrigo@agenda.dev', senha: 'errada' }));
});

test('org + profissionais + horários livres', () => {
  const agenda = novaAgenda();
  const u = agenda.registrar({ nome: 'Dono', email: 'dono@agenda.dev', senha: 'segredo123' });
  const org = agenda.criarOrg(u.id, 'Barbearia Franco');
  const prof = agenda.criarProfissional(org.id, 'Rodolfo', 'corte');
  assert.equal(agenda.listarProfissionais(org.id).length, 1);
  assert.equal(agenda.horariosLivres(prof.id, DATA).length, 10); // 8h-17h
});

test('CRUD: agendar → listar → editar → cancelar → deletar', () => {
  const agenda = novaAgenda();
  const u = agenda.registrar({ nome: 'Dono', email: 'dono@agenda.dev', senha: 'segredo123' });
  const org = agenda.criarOrg(u.id, 'Studio');
  const prof = agenda.criarProfissional(org.id, 'Rodolfo');

  // CRIAR
  const ag = agenda.agendar({ orgId: org.id, profissionalId: prof.id, clienteEmail: 'cliente@x.dev', clienteNome: 'Maria', data: DATA, hora: '10:00' });
  assert.equal(ag.status, 'agendado');
  // horário ficou ocupado
  assert.ok(!agenda.horariosLivres(prof.id, DATA).includes('10:00'));

  // LISTAR
  assert.equal(agenda.listar(org.id).length, 1);
  assert.equal(agenda.listar(org.id, { clienteEmail: 'cliente@x.dev' }).length, 1);

  // EDITAR (muda a hora)
  const editado = agenda.editar(ag.id, { hora: '14:00' });
  assert.equal(editado.hora, '14:00');
  assert.ok(agenda.horariosLivres(prof.id, DATA).includes('10:00'), '10:00 liberou');

  // CANCELAR (soft)
  const cancelado = agenda.cancelar(ag.id);
  assert.equal(cancelado.status, 'cancelado');
  assert.ok(agenda.listar(org.id, { status: 'cancelado' }).length, 1);

  // DELETAR (de verdade)
  const del = agenda.deletar(ag.id);
  assert.equal(del.deletado, true);
  assert.equal(agenda.listar(org.id).length, 0);
});

test('CONFLITO: mesmo profissional, mesmo horário => 409', () => {
  const agenda = novaAgenda();
  const org = agenda.criarOrg('dono', 'S');
  const prof = agenda.criarProfissional(org.id, 'R');
  agenda.agendar({ orgId: org.id, profissionalId: prof.id, clienteEmail: 'a@x', clienteNome: 'A', data: DATA, hora: '09:00' });
  assert.throws(() =>
    agenda.agendar({ orgId: org.id, profissionalId: prof.id, clienteEmail: 'b@x', clienteNome: 'B', data: DATA, hora: '09:00' }),
    /já ocupado/);
});

test('CONFLITO: profissionais DIFERENTES no mesmo horário => OK', () => {
  const agenda = novaAgenda();
  const org = agenda.criarOrg('dono', 'S');
  const p1 = agenda.criarProfissional(org.id, 'R1');
  const p2 = agenda.criarProfissional(org.id, 'R2');
  agenda.agendar({ orgId: org.id, profissionalId: p1.id, clienteEmail: 'a@x', clienteNome: 'A', data: DATA, hora: '09:00' });
  const ag2 = agenda.agendar({ orgId: org.id, profissionalId: p2.id, clienteEmail: 'b@x', clienteNome: 'B', data: DATA, hora: '09:00' });
  assert.equal(ag2.status, 'agendado');
});

test('editar com conflito rejeitado (exceto o próprio)', () => {
  const agenda = novaAgenda();
  const org = agenda.criarOrg('dono', 'S');
  const prof = agenda.criarProfissional(org.id, 'R');
  const ag1 = agenda.agendar({ orgId: org.id, profissionalId: prof.id, clienteEmail: 'a@x', clienteNome: 'A', data: DATA, hora: '09:00' });
  const ag2 = agenda.agendar({ orgId: org.id, profissionalId: prof.id, clienteEmail: 'b@x', clienteNome: 'B', data: DATA, hora: '11:00' });
  // editar ag2 para 09:00 (ocupado pelo ag1) => conflito
  assert.throws(() => agenda.editar(ag2.id, { hora: '09:00' }), /já ocupado/);
  // editar ag1 para a PRÓPRIA hora => ok
  assert.equal(agenda.editar(ag1.id, { hora: '09:00' }).hora, '09:00');
});

test('dados inválidos: data/hora malformadas rejeitadas', () => {
  const agenda = novaAgenda();
  const org = agenda.criarOrg('d', 'S');
  const prof = agenda.criarProfissional(org.id, 'R');
  assert.throws(() => agenda.agendar({ orgId: org.id, profissionalId: prof.id, clienteEmail: 'a@x', clienteNome: 'A', data: '05/10/2026', hora: '09:00' }), /YYYY-MM-DD/);
  assert.throws(() => agenda.agendar({ orgId: org.id, profissionalId: prof.id, clienteEmail: 'a@x', clienteNome: 'A', data: DATA, hora: '9h' }), /HH:MM/);
});
