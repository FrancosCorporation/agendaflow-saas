# AgendaFlow — Multi-tenant Scheduling SaaS

![Status](https://img.shields.io/badge/status-em%20constru%C3%A7%C3%A3o-orange)
![Node](https://img.shields.io/badge/Node-%3E%3D18-green?logo=node.js&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-green)

A production-shaped scheduling SaaS: **multi-tenant** (organizations → professionals →
availability), JWT + roles (owner/staff/client), freemium plan gating, owner analytics
dashboard and transactional e-mails.

> 🇧🇷 Um SaaS de agendamentos com cara de produção: **multi-tenant** (organização →
> profissionais → horários), JWT + papéis (dono/equipe/cliente), planos free/pro,
> dashboard de analytics para o dono e e-mails transacionais.

## Why this project matters

Multi-tenancy, roles and plan-gating are the vocabulary of real SaaS engineering —
the #1 thing technical recruiters probe ("have you built software as a *product*?").
AgendaFlow grows out of two working projects of mine
([Marcacao_Horario](https://github.com/FrancosCorporation/Marcacao_Horario) front +
[back-end](https://github.com/FrancosCorporation/Marcacao_Horario_Back-End), Node/Mongo, boot-tested)
upgraded to the patterns of the best open-source SaaS boilerplates.

## Features (roadmap)

- [ ] **M1** — Multi-tenant model, JWT + roles, availability calendar, booking flow
- [ ] **M2** — Freemium gate (free/pro features), Stripe test-mode checkout, owner dashboard
- [ ] **M3** — Analytics (bookings/week, no-show), public documented API, e2e tests

## Architecture

```mermaid
graph TD
  A[React SPA] --> B[Express API + JWT roles]
  B --> C[(MongoDB)]
  B --> D[Stripe test-mode]
  B --> E[email service]
  F[owner dashboard] --> B
```

## Quick start (planned)

```bash
docker compose up   # app + mongo
```

## Built with

- [wasp-lang/open-saas](https://github.com/wasp-lang/open-saas) (MIT, 16k⭐) — SaaS
  patterns: org/user/plan entities, admin dashboard, Stripe test flow
- My boot-tested foundations: Marcacao_Horario (front + back), api_authentication,
  api_nest_run_container (JWT patterns)

## License

MIT — Rodolfo Franco ([FrancosCorporation](https://github.com/FrancosCorporation))

---

### 🇧🇷 Sobre (PT-BR)

SaaS de agendamentos multi-tenant evoluído dos meus projetos Marcacao_Horario
(front+back, boot testado) para os padrões do open-saas (MIT): roles, planos,
Stripe test-mode, dashboard do dono e analytics. Roadmap de 3 milestones no
PROJETOS_RH.md do workspace.
