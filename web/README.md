# Lotus web

Next.js 14 PWA (TypeScript strict). Map (MapLibre + OSM tiles), wallet login, crate opening, prizes, vault, admin.

## Run
```
cp .env.example .env.local   # fill LOTUS_SESSION_SECRET, LOTUS_ADMIN_WALLETS
npm install
npm run dev
```
Works out of the box against an in-memory stub game server (`lib/server/stub.ts`).
To use the real one: set `DATABASE_URL`, `LOTUS_USE_STUB=0`, and add `"@lotus/server"` to dependencies (+ `transpilePackages: ['@lotus/server']` in next.config.mjs).
All game calls go through `lib/server/types.ts` (`GameServer`); the contract adapter is `lib/server/real.ts`.

## Notes
- Client decides nothing: location + crate id go up, server returns result. The 40m "Open" button state is a UI hint only.
- Auth lives in `lib/auth/` (server session cookie + client `useAuth`). Email login = add a method in `client.tsx` and a route that calls `startSession`.
- Geolocation needs HTTPS (or localhost) on phones.

## Integration checklist
- Layout assumed: `lotus/web` next to `lotus/server`; `next.config.mjs` aliases `@lotus/server` and `@lotus/anticheat` to `../server`.
- Run `npm install` in both `server` and `web`. Needed env: `DATABASE_URL`, `LOTUS_USE_STUB=0`, `LOTUS_SESSION_SECRET`, `LOTUS_ADMIN_WALLETS`, plus whatever the anti-cheat/Upstash config in `server` expects.
- Geolocation requires HTTPS on phones (Vercel preview/prod is fine).
