import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { BOOST_TEXT, GAME_BOOSTS } from '@/lib/boosts';
import { GAMES, GAME_KEYS } from '@/lib/levels';

interface PerGame { game: string; runs: number; players: number; avg_score: number; avg_level: number; flagged: number }

export default async function GamesAdmin() {
  const { data } = await createAdminClient().rpc('admin_analytics', { p_days: 30 });
  const stats = new Map<string, PerGame>(((data?.per_game ?? []) as PerGame[]).map((g) => [g.game, g]));

  return (
    <>
      <div><h1>Games</h1><p className="dim">Open any game to test it. In practice mode every level and boost is open and free. Nothing you play earns rewards, changes a ladder, or shows up in analytics or on the leaderboard.</p></div>
      <div className="adm-grid adm-two">
        {GAME_KEYS.map((k) => {
          const g = GAMES[k], s = stats.get(k);
          return (
            <section className="adm-card" key={k}>
              <div className="adm-head"><h2>{g.label}</h2><span className="adm-pill amber">{g.maxLevel} levels</span></div>
              <p className="dim">
                Players reach it at level {g.minAccountLevel}. Boosts: {GAME_BOOSTS[k].map((b) => BOOST_TEXT[k][b]?.name).join(', ')}.
              </p>
              <p>{s ? <>Last 30 days: <b>{s.runs}</b> runs by <b>{s.players}</b> players, average level <b>{s.avg_level}</b>, <b>{s.flagged}</b> flagged.</> : <span className="dim">No runs in the last 30 days.</span>}</p>
              <div className="adm-row"><Link className="adm-btn primary" href={`/arena/${g.slug}`}>Open in practice mode</Link></div>
            </section>
          );
        })}
      </div>
    </>
  );
}
