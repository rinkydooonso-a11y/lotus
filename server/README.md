# @lotus/server

Game logic for Lotus: crate spawner, odds roller, shards/tickets, open-crate flow, prize send queue.
API and rules: `../docs/contracts.md`. Schema: `../db/migrations`.

```
npm install
DATABASE_URL=postgres://... npm run migrate     # applies ../db/migrations in order
DATABASE_URL=postgres://... npm test            # needs a scratch Postgres with PostGIS; TRUNCATEs tables
npm run typecheck
```

Uses `node:crypto`, so Next.js routes that import it must use the Node runtime (not Edge).
`server/anticheat/` belongs to the anti-cheat thread; route handlers pass its `validateOpen` into `openCrate`.
