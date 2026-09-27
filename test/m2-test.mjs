// Testes M2 do AgendaFlow — planos/gate, Stripe test, analytics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarNucleoM2 } from '../src/m2.js';

const nova = () => criarNucleoM2(join(mkdtempSync(join(tmpdir(), 'af2-')), 't.db'));
const DATA = '2026-10-05';

test('plano free: limite de 1 org e 1 profissional (gate)', () => {
  const a = nova();
  const u = a.registrar({ nome: 'D', email: 'd@x', senha: 'segredo123' });
  const org = a.criarOrgComPlano(u.id, 'Org 1');
  assert.throws(() => a.criarOrgComPlano(u.id, 'Org 2'), /Plano free/);
  a.criarProfissionalComPlano(org.id, u.id, 'R1');
  assert.throws(() => a.criarProfissionalComPlano(org.id, u.id, 'R2'), /Plano free/);
});

test('upgrade para pro: limites liberados', () => {
  const a = nova();
  const u = a.registrar({ nome: 'D', email: 'd@x', senha: 'segredo123' });
  a.upgrade(u.id);
  assert.equal(a.planoDe(u.id), 'pro');
  const org1 = a.criarOrgComPlano(u.id, 'Org 1');
  const org2 = a.criarOrgComPlano(u.id, 'Org 2'); // pro: ilimitado
  assert.ok(org1.id && org2.id);
  a.criarProfissionalComPlano(org1.id, u.id, 'R1');
  a.criarProfissionalComPlano(org1.id, u.id, 'R2'); // pro: ok
});

test('Stripe test: sessão simulada com id cs_test', () => {
  const a = nova();
  const u = a.registrar({ nome: 'D', email: 'd@x', senha: 'segredo123' });
  const s = a.criarSessaoStripe(u.id);
  assert.ok(s.id.startsWith('cs_test_'));
  assert.equal(s.modo, 'test');
  assert.throws(() => a.criarSessaoStripe(u.id, 'free'), /só upgrade/);
});

test('analytics: taxa de conclusão, no-show, top profissional', () => {
  const a = nova();
  const u = a.registrar({ nome: 'D', email: 'd@x', senha: 'segredo123' });
  const org = a.criarOrgComPlano(u.id, 'S');
  a.upgrade(u.id);
  const p1 = a.criarProfissionalComPlano(org.id, u.id, 'R1');
  const p2 = a.criarProfissionalComPlano(org.id, u.id, 'R2');
  const ag1 = a.agendar({ orgId: org.id, profissionalId: p1.id, clienteEmail: 'a@x', clienteNome: 'A', data: DATA, hora: '09:00' });
  const ag2 = a.agendar({ orgId: org.id, profissionalId: p1.id, clienteEmail: 'b@x', clienteNome: 'B', data: DATA, hora: '10:00' });
  const ag3 = a.agendar({ orgId: org.id, profissionalId: p2.id, clienteEmail: 'c@x', clienteNome: 'C', data: DATA, hora: '11:00' });
  a.transicionarM2 ? null : null;
  // usa o transicionar do nucleo (herdado)
  a.db.prepare("UPDATE agendamentos SET status = 'concluido' WHERE id = ?").run(ag1.id);
  a.db.prepare("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?").run(ag3.id);

  const m = a.analytics(u.id, org.id);
  assert.equal(m.total, 3);
  assert.equal(m.concluidos, 1);
  assert.equal(m.cancelados, 1);
  assert.ok(Math.abs(m.taxaConclusao - 33.33) < 0.1);
  assert.ok(Math.abs(m.taxaNoShow - 33.33) < 0.1);
  assert.equal(m.topProfissional, 'R1', 'top: 2 agendamentos');
});

test('analytics: org de outro dono => 404', () => {
  const a = nova();
  const u1 = a.registrar({ nome: 'D1', email: 'd1@x', senha: 'segredo123' });
  const u2 = a.registrar({ nome: 'D2', email: 'd2@x', senha: 'segredo123' });
  const org = a.criarOrgComPlano(u1.id, 'S');
  assert.throws(() => a.analytics(u2.id, org.id), /não encontrada/);
});
