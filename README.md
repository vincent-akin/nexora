# Nexora

Web-based hybrid game platform, built from PRD v0.1: four games with level ladders and purchasable boosts, a Supabase backend, a Next.js app, and a separate admin console.

**Read this first: what is and is not verified.**

| Part | Status |
|---|---|
| Game cores and stamina maths | **53 automated tests pass** (`npm test`): Beat Lanes, Type Sprint, Block Drop, Market Detective, stamina. They cover the level ladders, every boost, rewards, replay validation, bots versus humans and forged logs. |
| Database (`supabase/`) | **All six migrations and all six check scripts pass** on PostgreSQL 16, with a stub standing in for Supabase's `auth` schema. Not yet run on a real Supabase project: run the check scripts there too. |
| Database through the API layer | The new server paths (starting a run with boosts, unlocking levels, saving state, the admin operations, analytics) were exercised through a real PostgREST with supabase-js. |
| Type Sprint, Block Drop, Beat Lanes boards | Each run in a headless browser. Type Sprint and Block Drop: typed and played for real, checked the animations and the effects, and confirmed the server-side replay of the logged input equals what the browser computed. Beat Lanes: its bot played at level 1 and level 10. Sound is wired in but a headless browser cannot hear it. |
| Market Detective, shop, admin pages | Type-checked and built. **Not rendered or clicked through**: that needs Supabase sign-in, which was not available. |
| Next.js app | `npm run typecheck` is clean and `next build` succeeds. It has **not been run against a live Supabase project**: expect to fix small things on first run. |
| Real devices | Touch controls, audio latency and key repeat were not tested on real phones or keyboards. |

## Set up

Needs Node 22.13 or newer and a Supabase project (hosted, or local with `supabase start`).

1. **Database.** Run the migrations in order, `0001_foundation.sql` to `0007_admin_practice_rules.sql` (SQL editor or `supabase db push`). Every migration is needed: skipping `0003`, `0006` or `0007` is the usual cause of a game failing to start or save. Then run the check scripts: `foundation_checks.sql`, `engagement_checks.sql`, `card_clash_checks.sql` (it tests the shared state-saving function, still used by Market Detective), `task_checks.sql`, `shop_checks.sql`, `levels_checks.sql` and `admin_checks.sql`. Each rolls back and ends with `ALL CHECKS PASSED`. Fix anything they report before going further.
2. **Auth settings** (Supabase dashboard, Authentication): enable email sign-up and email confirmation. Add `http://localhost:3000/auth/callback` to the redirect URLs.
3. **Environment.** `cp .env.example .env.local` and fill in the project URL, anon key and service-role key. The service-role key is server-only.
4. **Install and run.**
   ```bash
   npm install
   npm run typecheck     # should be clean once dependencies are installed
   npm test              # 53 tests: the four game cores and stamina
   npm run dev           # http://localhost:3000
   ```
5. **Create the admin account** (local development only). Run `supabase/seed_dev_admin.sql` in the SQL editor. It creates a confirmed account with email `admin@nexora.com`, username `admin` and password `Admin@1234`, and grants admin. That password is public in this file, so never run the script on a hosted or production project. There, sign up through the app and run only:
   ```sql
   insert into public.admin_users (user_id) select id from auth.users where email = 'you@example.com';
   ```
   The admin console (`/admin`) requires a second factor (`aal2`). There is no MFA enrolment screen yet, so for local development set `ADMIN_REQUIRE_MFA=false`. Never do that in production.

The standalone HTML prototypes were retired: they were built from the old game engines and would have shown the old rules.

## What is in the app

- **Sign-in and sign-up** with email, referral links (`/login?ref=CODE`), email confirmation callback.
- **Dashboard:** level and XP progress, the three balances (XP, Coins, Airdrop Points), stamina, daily reward with a 7-day streak tracker.
- **Arena (the lobby):** cards for every game with its number of levels.
- **Beat Lanes** (`/arena/beat-lanes`): 10 levels, a calibration routine, timing offset. Opens at player level 1.
- **Block Drop** (`/arena/block-drop`): colourful falling blocks, 15 levels. Opens at player level 2.
- **Type Sprint** (`/arena/type-sprint`): falling words, 12 levels. Opens at player level 3.
- **Market Detective** (`/arena/market-detective`): a chart-reading puzzle, 10 levels. Opens at player level 4.
- **Shop** (`/shop`): skins, sound packs, a stamina refill and boosts, bought with Coins.
- **Tasks** (`/missions`), **Leaderboard**, **Referrals**, **Rewards**: as before. The leaderboard excludes flagged and boosted runs.
- **Admin console** (`/admin`): a separate interface, described below. Admins see an "Admin console" link in the player menu.

## Levels in every game

Each game has its own ladder. The player picks any level up to the highest one unlocked, so there is no separate easy, normal and hard picker any more.

| Game | Levels | What changes as you climb | A level unlocks when |
|---|---|---|---|
| Beat Lanes | 10 | 80 to 128 bpm, denser notes, faster tiles, longer song, 10 hearts down to 6 | you finish the song at 60% accuracy or better |
| Block Drop | 15 | gravity speeds up every 8 lines cleared, within a run and between starting levels | you reach it during a run |
| Type Sprint | 12 | words fall faster, appear closer together, and grow from 4 to 9 or more letters; awkward letters (j, q, x, z, k, v, w, y) appear more often from level 7 | you clear every word of the level before it |
| Market Detective | 10 | 5 to 10 rounds, 26 s down to 9 s per round, 3 to 5 companies, closer calls, harder question types | you get 60% right or better |

Only **accepted** runs move the ladder. A flagged run keeps its XP and Coins but does not unlock anything. Rewards grow 10% per level for XP and Coins. Airdrop Points stay tied to the easy, normal or hard third of the ladder. Progress is stored in `player_game_levels` and written only by the server (`unlock_game_level`).

## Boosts

Boosts are consumables bought in the shop and chosen on a game's start screen (up to two per run). They are spent in the same database transaction that spends stamina, so a failed start costs nothing.

| Game | Boost | Effect |
|---|---|---|
| Beat Lanes | Extra hearts | +3 hearts |
| Block Drop | Slow drop | blocks fall 30% slower |
| Block Drop | Second chance | once, when the stack tops out, the top half clears and the run goes on |
| Type Sprint | Spare life | +1 life |
| Type Sprint | Slow words | words fall 25% slower |
| Market Detective | Extra time | +10 s every round |
| Market Detective | Cross out two | two wrong answers are struck out each round, chosen on the server |

**The rule: a boosted run earns XP and Coins but never Airdrop Points, and its score stays off the leaderboard.** Without it, Coins could buy Airdrop Points and the airdrop would be pay-to-win. The database enforces it in `settle_game_run` and the leaderboard view, so no game code can get it wrong. The server also takes the boosts from its own session record, never from the browser.

## The admin console

Admins get a separate interface at `/admin` with its own layout, a light interface with an amber sidebar, and no game navigation. Every page checks the admin gate on the server, and every action checks it again, validates its input and writes an audit record.

- **Overview:** players, activity, runs, flagged and rejected runs, Coins and Airdrop Points issued, boosted runs, a runs and sign-ups chart (7, 14 or 30 days), a per-game table, top players and best sellers. A banner links to anything waiting for review.
- **Reviews:** tweets to approve or reject, flagged runs, pending referrals, recent ledger entries.
- **Tasks:** create tasks (first run, runs, score, referrals, tweet, quiz), edit targets and rewards, turn them on or off. Quiz answers are stored where players cannot read them.
- **Players:** search, suspend and reactivate, give XP or Coins with a required reason. **Airdrop Points cannot be granted by hand**, so they only come from play.
- **Games:** open any of the four games in **practice mode**. Every level and every boost is open and free, and no stamina is spent. A practice run pays nothing, never moves a level ladder, never reaches the leaderboard and is left out of analytics. The database enforces this, so an admin test can never become airdrop points. Players who are admins also see every game open in the Arena, with a notice. Practice follows the same admin gate, including the second factor.
- **Rules:** the economy settings: stamina cap, seconds to earn a point of stamina, stamina a run costs, how long a run may stay open, and the daily caps on XP, Coins and Airdrop Points. Publishing creates a new numbered version that is live at once, with a required note. The database refuses unsafe values (a run must be allowed to stay open at least 240 seconds because the longest run is 150, and a zero cap is refused). Any earlier version can be switched back to. Every reward in the ledger already records which version paid it. The level ladders, game speeds and word lengths belong to the games and change in the code.
- **Shop:** change name, description, price, level lock and availability; add items, including boosts, which can only be built from a kind the game understands.
- **Audit log:** every admin action, newest first.

The "token purchase" task cannot be switched on from the console, because it cannot be verified yet.

## Two interfaces, on purpose

- **The platform shell is mature and calm.** Dashboard, game hub, missions, leaderboard, referrals, rewards and sign-in share one restrained design: a dark neutral palette, one violet accent, clean type (Sora and Manrope), refined line icons and a quiet confirmation modal. Styles: `app/globals.css`.
- **Each game has its own interface.** The Arena (`/arena`) is a lobby that lists the games. Each game lives on its own page with its own look, sound and motion. Beat Lanes is candy-bright (`styles/game.css`), Type Sprint is a green console (`styles/sprint.css`), Block Drop is a colourful neon well (`styles/blockdrop.css`), and Market Detective is an analyst desk. The admin console has its own look (`styles/admin.css`). Adding a game means a page under `app/(app)/arena/<game>/`, its own component and stylesheet, and one entry in the `GAMES` list in `app/(app)/arena/page.tsx`. Level, balances, stamina and the reward ledger are shared.
- Adding a game means: a page under `app/(app)/arena/<game>/`, its own component and stylesheet, and one entry in the `GAMES` list in `app/(app)/arena/page.tsx`. Level, balances, stamina and the reward ledger are shared.

## Tasks

Tasks live on `/missions` (daily tasks reset at 00:00 UTC). Reward numbers are placeholders to tune.

| Task | Type | How it is checked |
|---|---|---|
| Tweet something about RWAINC token | Daily | **Manual review.** The player posts on X and submits the link. An admin opens it, checks it, and approves or rejects it in the Admin page. Approval pays the reward once. Nothing is checked against X automatically. A tweet can only be used once across all accounts, and a rejected link can be replaced. |
| Spot the top performer on the RWA stocks platform | Daily quiz | The server checks the answer; the correct answer is never sent to the browser. One try per day. **Test data:** the options and answer are placeholders (Stock A to D) until the stocks platform connection is approved. An admin sets the real question in the `missions` table. |
| Refer 3 friends | Milestone | Counts approved referrals (verified email plus one accepted game run). Each approved referral also pays its own reward on top. |
| Buy RWAINC tokens | Milestone | **Disabled.** Verifying a purchase needs the token's blockchain and contract address and the amount to hold, none of which are confirmed. The task shows as "Coming soon" and the server refuses to pay it. |

## Branding

All colours live in `styles/brand.css`. **The palette there is provisional and is not yet matched to claim.rwaops.com**, which could not be read automatically because it renders with JavaScript. Replace the values in that one file and the shell, homepage, buttons, glows and logo all follow. The game themes (Beat Lanes candy, Block Drop neon) keep their own palettes on purpose.

## Game locks

Beat Lanes opens at player level 1, Block Drop at 2, Type Sprint at 3 and Market Detective at 4 (`lib/levels.ts`). Locked games show a lock in the Arena lobby, their pages redirect back to the lobby, and the start API refuses the request, so the lock cannot be bypassed from the browser. Player level thresholds are in `level_config`. This is separate from the level ladder inside each game.

## The shop

Everything is bought with Coins, the in-game currency earned by playing. Coins are never real money and are not redeemable. A purchase writes a **negative ledger entry** and updates the balance in the same transaction (`purchase_item`), so `reconcile_balances()` still returns zero rows. Each purchase carries a client-generated request id, so a retried click never charges twice.

| Kind | What it does | Sold today |
|---|---|---|
| Skin | Re-colours a game. Beat Lanes tile palettes, Block Drop block colours, Type Sprint consoles, Market Detective desks. | 8 |
| Sound pack | Changes the sound of a game: Beat Lanes note voices, Block Drop chimes, Type Sprint keystrokes. | 5 |
| Stamina refill | +5 stamina. | 1 |
| Boost | One run's advantage in one game (see Boosts above). | 7 |

Skins and sounds never change how a run is scored. Boosts do help a run, which is why a boosted run earns no Airdrop Points. Buying with real money or tokens is not built and should not be added without legal review. Card Clash's three skins moved to Block Drop with their owners.

## How the games are secured

- **Type Sprint** and **Block Drop** use the same model as Beat Lanes: the browser runs a deterministic simulation (`SprintSim`, `BlockSim`) so the screen knows where everything is, logs its keystrokes or moves, and submits only that log. The server replays the log through the **same class** and decides the result. A run is rejected if the log is malformed, too fast, in the future, or submitted before the replay says the run could have ended. Superhuman pace (Type Sprint: 170 wpm or perfectly even timing; Block Drop: more than 4.5 blocks a second) flags the run and withholds Airdrop Points.
- **Market Detective** is dealt one round at a time by the server, which times each answer and reveals the right answer only after the player commits. **All charts are test data.** A script could compute the answer from the charts, so instant or evenly spaced answers flag the run. To use real data, replace the series source in `lib/market-detective/core.ts`.
- A determined script can imitate human timing, so the daily reward caps are the real backstop.

## Troubleshooting: a game answers HTTP 409 or 500

A 409 used to be returned for two different problems that look nothing alike: a session that really was closed, and a database that is missing a migration (the session lookup failed, and the failure was read as "no session"). It also happens if the server's clock is more than five minutes ahead of the database's. Now:

- A database missing a migration returns **500 `schema_out_of_date`** and logs the real error in the terminal that runs `npm run dev` (look for `[loadSession]` or `[start_run]`). Apply `0003`, `0006` and `0007`, then reload the schema cache (Supabase: Settings, API, Reload schema, or run `notify pgrst, 'reload schema';`).
- A 409 `session_closed` now carries `reason`: `closed` (already submitted) or `expired` (older than five minutes).
- Check the columns exist: `select column_name from information_schema.columns where table_name = 'game_sessions' and column_name in ('state', 'state_version', 'level', 'boosts');` must return four rows.

## Type Sprint

Words fall from the top; type the first letter to lock on, finish the word to clear it. A wrong key costs 5 points and your streak, a word that lands costs a life and 10 points, and clearing every word of a level starts the next, faster one. A run ends when the lives run out or after 150 seconds. Letters fly off as you type them, a finished word bursts into sparks, a wrong key shakes the screen, and a landed word breaks a heart. The tune rises as your streak grows, and every outcome has its own sound. `prefers-reduced-motion` removes the flying letters, sparks and shaking.

## Block Drop

A 10 by 20 well, seven shapes dealt from a shuffled bag, hold, ghost outline, three-piece preview. Every 8 lines the level rises and gravity speeds up (880 ms a row at level 1, 60 ms at level 15). The background colour shifts with each level. Keyboard: arrows, Up or X, Z, Space, C. On touch screens a button pad appears.

## Diagnosing a "409" or "could not start" error

An earlier version returned 409 for several different problems, which made a missing migration look like a game bug. Now:

- **500 with `schema_out_of_date`** means the database is missing a migration (`0003`, `0006` or `0007`). The terminal also logs the real database error.
- **409 `session_closed`** with a `reason` of `closed` or `expired` is a genuine finished or timed-out session.
- **409 `conflict`** is two requests racing on one session. Retrying is safe.
- If every session looks expired, compare the clocks of the machine running Next and the database. Run validation allows 1.5 seconds of drift, and sessions last 5 minutes.

## How tapping works

Tap a tile anywhere on screen and it pops. The score depends on how close to the keys you tap it: Perfect and Good near the line, **Early** further up (a little credit, no life lost, combo untouched). Tapping an empty lane, or a tile that has not appeared yet, costs a life. Button-mashing pops tiles but can never reach the accuracy needed for Airdrop Points (covered by a test).

## The look and feel of Beat Lanes

Beat Lanes is meant to feel like a game, not a dashboard.

- **In the game canvas** (`lib/beat-lanes/engine.ts`): an animated night sky with twinkling stars, floating notes and an equalizer that pulses on the beat; glossy candy tiles in four lane colors; colored piano keys; particle bursts and shockwave rings on every hit; judgement popups (Perfect, Good, Miss); combo counter with multiplier; milestone shout-outs at 10, 25, 50 and 100 with confetti and screen shake; hearts for lives that crack when lost; a 3-2-1-GO countdown; a fire glow when the multiplier is up; sound effects and an arpeggio fanfare; haptic taps on phones.
- **Around it** (`styles/game.css`, `components/BeatLanes.tsx`, `lib/icons.ts`): a bouncing mascot, hopping rainbow title, chunky pressable buttons, a colored difficulty picker, a 1 to 3 star rating, count-up scores and reward chips with coin, XP and gem icons, and a level-up popup with confetti.
- **Accessibility:** `prefers-reduced-motion` turns off shake, drift, pulses and CSS animations, and shrinks particles. Sound can be turned off, and the tiles are readable by color, shape and position.

Tweak colors in `LANE` and `C` at the top of `engine.ts` and the `:root` tokens in `styles/game.css`.

## How a Beat Lanes run is secured

1. `POST /api/runs/start` spends stamina and spends any boosts (`begin_level_run`) and stores a random seed in a session.
2. Client and server both build the chart from the seed with `generateChart`.
3. The browser records a tap log. It submits only the taps and its timing offset: no score, no reward amount.
4. `POST /api/runs/[id]/submit` rebuilds the chart from the stored seed and calls `validateSubmission`. Structural, rate and clock checks reject a run. Statistical signals (timing too uniform) flag it.
5. `settle_game_run` closes the session exactly once, stores the score and credits the ledger through `grant_reward`. Flagged runs earn no Airdrop Points and land in `risk_flags`.

Clients can read their own rows and nothing else. Every write goes through a service-role-only database function. The ledger is append-only, and `reconcile_balances()` should always return zero rows.

## Deliberate differences from the PRD

- **Tasks are not auto-verified.** X and on-chain purchases need decisions and credentials that do not exist yet (see the Tasks table).
- **Plain CSS** instead of Tailwind and shadcn/ui, to keep the first build free of extra configuration. The game styles are one shared stylesheet (`styles/game.css`), so a swap would be contained.
- **Card Clash was replaced by Block Drop.** Its old sessions stay in the database as history, and the shared state-saving function it used still serves Market Detective.
- Placeholder economy values (rewards, caps, stamina, level thresholds, mission rewards) live in `rules_versions`, `level_config` and `missions`. Tune them after play-testing.

## Not built yet

- Daily Chord and Studio upgrades.
- A Block Drop prototype and any standalone prototypes (retired with the old engines).
- Rate limiting on the new game routes and on the admin actions.
- MFA enrolment screen, account deletion and data export, phone verification, wallet linking, token gating.
- Rate limiting on the API routes. Add it before any public launch.
- Referral reward reversal. Admins can reject pending referrals; approved ones cannot be clawed back yet.
- Real-device testing of audio latency and touch timing.
- Server and database clocks are compared with a 1.5 s tolerance in run validation; check this under real network conditions.
- Legal review of the points wording in `lib/copy.ts` and a trademark check on the name "Nexora".

  
