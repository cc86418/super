# Wheel Run

Endless survival race driven by the live Squeekchain hamster wheel (`ACTIVE` RPM raises speed / hazards / score mult; `IDLE` calms the burrow; each `settledThroughRound` bump triggers a soft settlement quake).

**Live demo:** https://wheel-run-genesis-19080c.deed.page/

Built for Squeekchain Genesis Buildooooor: https://squeekchain.com/genesis

## Play

Open the live demo. Desktop: Space / ↑ jump, ↓ slide, Esc pause. Mobile: tap to jump.

## Stack

Static Vite build. Polls `https://api.squeekchain.com/v1/status` about every 1.5s. No wallet connect inside the game.

## Local

```bash
npm install
npm run dev
npm run build
```
