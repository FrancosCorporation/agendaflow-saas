// AgendaFlow — servidor: API completa (auth + orgs + CRUD de agendamentos) + painel do dono.
import express from 'express';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarNucleoM2 } from './src/m2.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3111;
const nucleo = criarNucleoM2(process.env.AGENDAFLOW_DB || 'agendaflow.db');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '32kb' }));

function criarLimitador(limite, janelaMs, maxChaves = 20_000) {
  const janelas = new Map();
  let operacoes = 0;
  return (chave) => {
    const agora = Date.now();
    let janela = janelas.get(chave);
    if (!janela || janela.ate <= agora) {
      janela = { usos: 0, ate: agora + janelaMs };
      janelas.set(chave, janela);
    }
    const permitido = janela.usos < limite;
    if (permitido) janela.usos += 1;
    if (++operacoes % 256 === 0 || janelas.size > maxChaves) {
      for (const [k, v] of janelas) if (v.ate <= agora) janelas.delete(k);
      while (janelas.size > maxChaves) janelas.delete(janelas.keys().next().value);
    }
    return { permitido, aguardeMs: Math.max(1, janela.ate - agora) };
  };
}

const limiteAuthIp = criarLimitador(20, 5 * 60 * 1000);
const limiteAuthEmail = criarLimitador(5, 5 * 60 * 1000);
const limiteAgendamentoIp = criarLimitador(10, 60 * 60 * 1000);
const limiteAgendamentoEmail = criarLimitador(5, 60 * 60 * 1000);
const limiteAgendamentoDia = criarLimitador(10, 60 * 60 * 1000);

function limitar(res, resultados) {
  const bloqueados = resultados.filter((r) => !r.permitido);
  if (!bloqueados.length) return false;
  const segundos = Math.max(1, Math.ceil(Math.max(...bloqueados.map((r) => r.aguardeMs)) / 1000));
  res.setHeader('Retry-After', String(segundos));
  res.status(429).json({ erro: { codigo: 'limite', mensagem: 'Muitas tentativas. Aguarde antes de tentar novamente.' } });
  return true;
}

function limiteAuth(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'desconhecido';
  const emailBruto = req.body?.email;
  const email = typeof emailBruto === 'string' && emailBruto.length <= 254 ? emailBruto.trim().toLowerCase() : '';
  const resultados = [limiteAuthIp(ip)];
  if (email) resultados.push(limiteAuthEmail(email));
  if (limitar(res, resultados)) return;
  next();
}

function limiteAgendamento(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'desconhecido';
  const emailBruto = req.body?.clienteEmail;
  const email = typeof emailBruto === 'string' && emailBruto.length <= 254 ? emailBruto.trim().toLowerCase() : '';
  const profissionalId = typeof req.body?.profissionalId === 'string' && req.body.profissionalId.length <= 64 ? req.body.profissionalId : '';
  const data = typeof req.body?.data === 'string' && req.body.data.length === 10 ? req.body.data : '';
  const resultados = [limiteAgendamentoIp(ip)];
  if (email) resultados.push(limiteAgendamentoEmail(email));
  if (profissionalId && data) resultados.push(limiteAgendamentoDia(`${ip}:${profissionalId}:${data}`));
  if (limitar(res, resultados)) return;
  next();
}

function erro(e, res) {
  const status = { dados: 400, data: 400, hora: 400, credenciais: 401, token: 401, email: 409, conflito: 409, plano: 403, 403: 403, '404': 404 }[e.codigo] || 500;
  if (status === 500) console.error('[AgendaFlow] Erro interno:', e);
  const mensagem = status === 500 ? 'Erro interno do servidor' : e.message;
  res.status(status).json({ erro: { codigo: status === 500 ? 'interno' : e.codigo, mensagem } });
}

function auth(req, res, next) {
  const cab = req.headers.authorization;
  const payload = cab?.startsWith('Bearer ') ? nucleo.verificarToken(cab.slice(7)) : null;
  if (!payload) return res.status(401).json({ erro: { codigo: 'token', mensagem: 'Token ausente/inválido' } });
  req.usuario = payload;
  next();
}

// ---- auth ----
app.post('/api/register', limiteAuth, (req, res) => { try { res.status(201).json(nucleo.registrar(req.body ?? {})); } catch (e) { erro(e, res); } });
app.post('/api/login', limiteAuth, (req, res) => { try { res.json(nucleo.login(req.body ?? {})); } catch (e) { erro(e, res); } });

// ---- organizações/profissionais ----
app.get('/api/orgs', auth, (req, res) => res.json(nucleo.listarOrgs(req.usuario.sub)));
app.post('/api/orgs', auth, (req, res) => { try { res.status(201).json(nucleo.criarOrgComPlano(req.usuario.sub, req.body?.nome)); } catch (e) { erro(e, res); } });
app.post('/api/orgs/:id/profissionais', auth, (req, res) => { try { res.status(201).json(nucleo.criarProfissionalComPlano(req.params.id, req.usuario.sub, req.body?.nome, req.body?.area)); } catch (e) { erro(e, res); } });
app.get('/api/plano', auth, (req, res) => res.json({ plano: nucleo.planoDe(req.usuario.sub) }));
app.get('/api/orgs/:id/analytics', auth, (req, res) => { try { res.json(nucleo.analytics(req.usuario.sub, req.params.id)); } catch (e) { erro(e, res); } });
// Leitura pública mínima para agendamento (vitrine): profissionais e horários — sem dados de clientes
app.get('/api/orgs/:id/profissionais', (req, res) => res.json(nucleo.listarProfissionais(req.params.id)));
app.get('/api/orgs/:id/horarios/:profId', (req, res) => res.json(nucleo.horariosLivres(req.params.profId, req.query.data, req.params.id)));

// ---- agendamentos (CRUD completo) ----
app.post('/api/agendamentos', limiteAgendamento, (req, res) => { try { res.status(201).json(nucleo.agendar(req.body ?? {})); } catch (e) { erro(e, res); } });
app.get('/api/agendamentos', auth, (req, res) => { try { res.json(nucleo.listar(req.usuario.sub, req.query.orgId, { clienteEmail: req.query.cliente, status: req.query.status })); } catch (e) { erro(e, res); } });
app.get('/api/agendamentos/:id', auth, (req, res) => { try { res.json(nucleo.obterDe(req.usuario.sub, req.params.id)); } catch (e) { erro(e, res); } });
app.patch('/api/agendamentos/:id', auth, (req, res) => { try { res.json(nucleo.editar(req.usuario.sub, req.params.id, req.body ?? {})); } catch (e) { erro(e, res); } });
app.post('/api/agendamentos/:id/cancelar', auth, (req, res) => { try { res.json(nucleo.cancelar(req.usuario.sub, req.params.id)); } catch (e) { erro(e, res); } });
app.delete('/api/agendamentos/:id', auth, (req, res) => { try { res.json(nucleo.deletar(req.usuario.sub, req.params.id)); } catch (e) { erro(e, res); } });

// estático (painel do dono)
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  try {
    const pastaPublica = resolve(ROOT, 'public');
    const arquivo = resolve(pastaPublica, `.${req.path}`);
    if (arquivo !== pastaPublica && !arquivo.startsWith(`${pastaPublica}${sep}`)) throw new Error('fora');
    const dados = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': MIME[extname(arquivo)] || 'text/html; charset=utf-8' });
    res.end(dados);
  } catch {
    try {
      const indice = await readFile(join(ROOT, 'public/index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indice);
    } catch { res.writeHead(500); res.end('erro'); }
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ erro: { codigo: '404', mensagem: 'Rota não encontrada' } });
});

app.use((e, req, res, next) => {
  if (res.headersSent) return next(e);
  const status = Number.isInteger(e.status) && e.status >= 400 && e.status < 500 ? e.status : 500;
  if (status === 500) console.error('[AgendaFlow] Erro HTTP interno:', e);
  const mensagem = status === 413 ? 'Corpo da requisição excede o limite de 32 KiB' : status === 400 ? 'JSON inválido' : 'Erro interno do servidor';
  res.status(status).json({ erro: { codigo: status === 500 ? 'interno' : 'requisicao_invalida', mensagem } });
});

const server = http.createServer(app);
export { server, nucleo };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`AgendaFlow em http://localhost:${PORT} (painel do dono + API)`));
}
