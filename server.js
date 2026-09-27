// AgendaFlow — servidor: API completa (auth + orgs + CRUD de agendamentos) + painel do dono.
import express from 'express';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarNucleo } from './src/nucleo.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3111;
const nucleo = criarNucleo(process.env.AGENDAFLOW_DB || 'agendaflow.db');

const app = express();
app.use(express.json());

function erro(e, res) {
  const status = { dados: 400, data: 400, hora: 400, credenciais: 401, email: 409, conflito: 409, '404': 404 }[e.codigo] || 500;
  res.status(status).json({ erro: { codigo: e.codigo, mensagem: e.message } });
}

function auth(req, res, next) {
  const cab = req.headers.authorization;
  const payload = cab?.startsWith('Bearer ') ? nucleo.verificarToken(cab.slice(7)) : null;
  if (!payload) return res.status(401).json({ erro: { codigo: 'token', mensagem: 'Token ausente/inválido' } });
  req.usuario = payload;
  next();
}

// ---- auth ----
app.post('/api/register', (req, res) => { try { res.status(201).json(nucleo.registrar(req.body)); } catch (e) { erro(e, res); } });
app.post('/api/login', (req, res) => { try { res.json(nucleo.login(req.body)); } catch (e) { erro(e, res); } });

// ---- organizações/profissionais ----
app.post('/api/orgs', auth, (req, res) => { try { res.status(201).json(nucleo.criarOrg(req.usuario.sub, req.body.nome)); } catch (e) { erro(e, res); } });
app.post('/api/orgs/:id/profissionais', auth, (req, res) => { try { res.status(201).json(nucleo.criarProfissional(req.params.id, req.body.nome, req.body.area)); } catch (e) { erro(e, res); } });
app.get('/api/orgs/:id/profissionais', (req, res) => res.json(nucleo.listarProfissionais(req.params.id)));
app.get('/api/orgs/:id/horarios/:profId', (req, res) => res.json(nucleo.horariosLivres(req.params.profId, req.query.data)));

// ---- agendamentos (CRUD completo) ----
app.post('/api/agendamentos', (req, res) => { try { res.status(201).json(nucleo.agendar({ ...req.body, orgId: req.body.orgId })); } catch (e) { erro(e, res); } });
app.get('/api/agendamentos', auth, (req, res) => res.json(nucleo.listar(req.query.orgId, { clienteEmail: req.query.cliente, status: req.query.status })));
app.get('/api/agendamentos/:id', (req, res) => { const ag = nucleo.obter(req.params.id); ag ? res.json(ag) : erro(Object.assign(new Error(), { codigo: '404' }), res); });
app.patch('/api/agendamentos/:id', auth, (req, res) => { try { res.json(nucleo.editar(req.params.id, req.body)); } catch (e) { erro(e, res); } });
app.post('/api/agendamentos/:id/cancelar', auth, (req, res) => { try { res.json(nucleo.cancelar(req.params.id)); } catch (e) { erro(e, res); } });
app.delete('/api/agendamentos/:id', auth, (req, res) => { try { res.json(nucleo.deletar(req.params.id)); } catch (e) { erro(e, res); } });

// estático (painel do dono)
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  try {
    let arquivo = normalize(join(ROOT, 'public', req.path));
    if (!arquivo.startsWith(ROOT)) throw new Error('fora');
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

const server = http.createServer(app);
export { server, nucleo };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`AgendaFlow em http://localhost:${PORT} (painel do dono + API)`));
}
