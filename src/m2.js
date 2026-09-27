// AgendaFlow M2 — analytics do dono + planos (freemium gate) + Stripe test-mode (simulado).
import { criarNucleo } from './nucleo.js';

// planos: free (1 org, 1 profissional) / pro (ilimitado)
const PLANOS = {
  free: { maxOrgs: 1, maxProfissionais: 1 },
  pro: { maxOrgs: Infinity, maxProfissionais: Infinity }
};

export function criarNucleoM2(caminhoDb) {
  const nucleo = criarNucleo(caminhoDb);
  const planos = new Map(); // usuarioId -> 'free' | 'pro'

  return {
    ...nucleo,
    planos,

    planoDe(usuarioId) { return planos.get(usuarioId) || 'free'; },

    upgrade(usuarioId) { planos.set(usuarioId, 'pro'); return { plano: 'pro' }; },

    // gate: cria org respeitando o plano
    criarOrgComPlano(donoId, nome) {
      const plano = PLANOS[this.planoDe(donoId)];
      const orgs = nucleo.db.prepare('SELECT COUNT(*) AS n FROM organizacoes WHERE dono_id = ?').get(donoId).n;
      if (orgs >= plano.maxOrgs) {
        throw Object.assign(new Error(`Plano ${this.planoDe(donoId)}: limite de ${plano.maxOrgs} organização(ões). Faça upgrade para pro.`), { codigo: 'plano' });
      }
      return nucleo.criarOrg(donoId, nome);
    },

    criarProfissionalComPlano(orgId, donoId, nome, area) {
      const plano = PLANOS[this.planoDe(donoId)];
      const n = nucleo.db.prepare('SELECT COUNT(*) AS n FROM profissionais WHERE org_id = ?').get(orgId).n;
      if (n >= plano.maxProfissionais) {
        throw Object.assign(new Error(`Plano ${this.planoDe(donoId)}: limite de ${plano.maxProfissionais} profissional(is).`), { codigo: 'plano' });
      }
      return nucleo.criarProfissional(orgId, nome, area);
    },

    // Stripe test-mode: cria sessão de checkout SIMULADA (sem cobrança real)
    criarSessaoStripe(usuarioId, planoAlvo = 'pro') {
      if (planoAlvo !== 'pro') throw Object.assign(new Error('só upgrade para pro'), { codigo: 'dados' });
      const idSessao = `cs_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      return { id: idSessao, plano: planoAlvo, modo: 'test', url: `/checkout/${idSessao}` };
    },

    // analytics do dono: agendamentos/semana, no-show, taxa de conclusão, top profissional
    analytics(donoId, orgId) {
      const org = nucleo.db.prepare('SELECT * FROM organizacoes WHERE id = ? AND dono_id = ?').get(orgId, donoId);
      if (!org) throw Object.assign(new Error('org não encontrada'), { codigo: '404' });
      const total = nucleo.db.prepare('SELECT COUNT(*) AS n FROM agendamentos WHERE org_id = ?').get(orgId).n;
      const concluidos = nucleo.db.prepare("SELECT COUNT(*) AS n FROM agendamentos WHERE org_id = ? AND status = 'concluido'").get(orgId).n;
      const cancelados = nucleo.db.prepare("SELECT COUNT(*) AS n FROM agendamentos WHERE org_id = ? AND status = 'cancelado'").get(orgId).n;
      const agendados = nucleo.db.prepare("SELECT COUNT(*) AS n FROM agendamentos WHERE org_id = ? AND status = 'agendado'").get(orgId).n;
      // no-show: cancelados após a data? simplificação M2: cancelados/total
      const top = nucleo.db.prepare(`
        SELECT profissional_id, COUNT(*) AS total FROM agendamentos
        WHERE org_id = ? GROUP BY profissional_id ORDER BY total DESC LIMIT 1
      `).get(orgId);
      const profNome = top ? nucleo.db.prepare('SELECT nome FROM profissionais WHERE id = ?').get(top.profissional_id)?.nome : null;
      return {
        total, agendados, concluidos, cancelados,
        taxaConclusao: total ? (concluidos / total) * 100 : 0,
        taxaNoShow: total ? (cancelados / total) * 100 : 0,
        topProfissional: profNome
      };
    }
  };
}
