# Nexora

Web-based hybrid game platform, built from PRD v0.1. This is the first full build: the Beat Lanes game, the Supabase backend, and a Next.js app around it.

**Read this first: what is and is not verified.**

| Part | Status |
|---|---|
| Game core (`lib/beat-lanes/core.ts`), stamina maths | 11 automated tests pass |
| Playable prototype (`prototype/beat-lanes.html`) | Run in a headless browser: animated menu, calibration (start and cancel), live play with effects, miss feedback, results with stars and reward chips, keyboard and pointer input, bot detection. It uses the same engine, icons and stylesheet as the app. |
| Next.js app (`app/`, `components/`, `lib/`) | **Never installed or run.** Written without network access. A TypeScript pass found no syntax errors; every remaining error was a missing dependency. Expect to fix small things on first run. |
| Database migrations and dev seed (`supabase/`) | **Never run against Postgres.** Two self-checking test scripts are included; run them before trusting the schema. |

## Set up

Needs Node 22.13 or newer and a Supabase project (hosted, or local with `supabase start`).

1. **Database.** Run `supabase/migrations/0001_foundation.sql`, then `0002_engagement.sql` (SQL editor or `supabase db push`). Then run `supabase/tests/foundation_checks.sql` and `supabase/tests/engagement_checks.sql`. Each rolls back and ends with `ALL CHECKS PASSED`. Fix anything they report before going further.
2. **Auth settings** (Supabase dashboard, Authentication): enable email sign-up and email confirmation. Add `http://localhost:3000/auth/callback` to the redirect URLs.
3. **Environment.** `cp .env.example .env.local` and fill in the project URL, anon key and service-role key. The service-role key is server-only.
4. **Install and run.**
   ```bash
   npm install
   npm run typecheck     # should be clean once dependencies are installed
   npm test              # core and stamina tests
   npm run dev           # http://localhost:3000
   ```
5. **Create the admin account** (local development only). Run `supabase/seed_dev_admin.sql` in the SQL editor. It creates a confirmed account with email `admin@nexora.com`, username `admin` and password `Admin@1234`, and grants admin. That password is public in this file, so never run the script on a hosted or production project. There, sign up through the app and run only:
   ```sql
   insert into public.admin_users (user_id) select id from auth.users where email = 'you@example.com';
   ```
   Admin pages require a second factor (`aal2`). There is no MFA enrolment screen yet, so for local development set `ADMIN_REQUIRE_MFA=false`. Never do that in production.

To rebuild the standalone prototype: `npm run build:prototype`.

## What is in the app

- **Sign-in and sign-up** with email, referral links (`/login?ref=CODE`), email confirmation callback.
- **Dashboard:** level and XP progress, the three balances (XP, Coins, Airdrop Points), stamina, daily reward with streak.
- **Arena:** Beat Lanes, with difficulty unlocks by level, a tap-along calibration routine, timing offset and a sound toggle.
- **Missions:** three seeded missions that complete only from validated runs.
- **Leaderboard:** best accepted score per player, per difficulty. Flagged runs are excluded.
- **Referrals:** your link, pending and approved counts. A referral is approved when the referred player verifies email and has one accepted run.
- **Rewards:** your full ledger with the reason for every entry.
- **Admin:** review flagged runs, reject pending referrals, view recent ledger entries. All actions are audit-logged.

## The look and feel

Nexora is meant to feel like a game, not a dashboard.

- **In the game canvas** (`lib/beat-lanes/engine.ts`): an animated night sky with twinkling stars, floating notes and an equalizer that pulses on the beat; glossy candy tiles in four lane colors; colored piano keys; particle bursts and shockwave rings on every hit; judgement popups (Perfect, Good, Miss); combo counter with multiplier; milestone shout-outs at 10, 25, 50 and 100 with confetti and screen shake; hearts for lives that crack when lost; a 3-2-1-GO countdown; a fire glow when the multiplier is up; sound effects and an arpeggio fanfare; haptic taps on phones.
- **Around it** (`styles/game.css`, `components/`, `lib/icons.ts`): a bouncing mascot, hopping rainbow title, chunky pressable buttons, a colored difficulty picker, a 1 to 3 star rating, count-up scores and reward chips with coin, XP and gem icons, a level-up popup, a claim popup with confetti, and an animated floating backdrop behind every page.
- **Accessibility:** `prefers-reduced-motion` turns off shake, drift, pulses and CSS animations, and shrinks particles. Sound can be turned off, and the tiles are readable by color, shape and position.

Tweak colors in `LANE` and `C` at the top of `engine.ts` and the `:root` tokens in `styles/game.css`.

## How a run is secured

1. `POST /api/runs/start` spends stamina (`start_game_run`) and stores a random seed in a session.
2. Client and server both build the chart from the seed with `generateChart`.
3. The browser records a tap log. It submits only the taps and its timing offset: no score, no reward amount.
4. `POST /api/runs/[id]/submit` rebuilds the chart from the stored seed and calls `validateSubmission`. Structural, rate and clock checks reject a run. Statistical signals (timing too uniform) flag it.
5. `settle_game_run` closes the session exactly once, stores the score and credits the ledger through `grant_reward`. Flagged runs earn no Airdrop Points and land in `risk_flags`.

Clients can read their own rows and nothing else. Every write goes through a service-role-only database function. The ledger is append-only, and `reconcile_balances()` should always return zero rows.

## Deliberate differences from the PRD

- **Plain CSS** instead of Tailwind and shadcn/ui, to keep the first build free of extra configuration. The game styles are one shared stylesheet (`styles/game.css`), so a swap would be contained.
- **Card Clash is not built.** It needs a game design document first. The Arena has one game for now; the `games`-style rotation and Daily Chord depend on a second game.
- Placeholder economy values (rewards, caps, stamina, level thresholds, mission rewards) live in `rules_versions`, `level_config` and `missions`. Tune them after play-testing.

## Not built yet

- Card Clash, Daily Chord, Studio upgrades, Type Sprint, Market Detective.
- MFA enrolment screen, account deletion and data export, phone verification, wallet linking, token gating.
- Rate limiting on the API routes. Add it before any public launch.
- Referral reward reversal. Admins can reject pending referrals; approved ones cannot be clawed back yet.
- Real-device testing of audio latency and touch timing.
- Server and database clocks are compared with a 1.5 s tolerance in run validation; check this under real network conditions.
- Legal review of the points wording in `lib/copy.ts` and a trademark check on the name "Nexora".
