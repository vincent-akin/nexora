import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const GAMES = { beat_lanes: 'Beat Lanes', card_clash: 'Card Clash' } as const;
const DIFFS = ['easy', 'normal', 'hard'] as const;
type Game = keyof typeof GAMES;
type Diff = (typeof DIFFS)[number];

export default async function Leaderboard({ searchParams }: { searchParams: Promise<{ g?: string; d?: string }> }) {
  const { g, d } = await searchParams;
  const game: Game = g && g in GAMES ? (g as Game) : 'beat_lanes';
  const difficulty: Diff = d && (DIFFS as readonly string[]).includes(d) ? (d as Diff) : 'normal';
  const supabase = await createClient();

  // Best accepted score per player. Flagged runs are excluded by the view.
  const { data: rows } = await supabase
    .from('leaderboard_best')
    .select('display_name,best_score,achieved_at')
    .eq('game', game)
    .eq('difficulty', difficulty)
    .order('best_score', { ascending: false })
    .order('achieved_at', { ascending: true })
    .limit(50);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Leaderboard</h1>
        <p className="dim">Best accepted score per player. Ties go to whoever got there first.</p>
      </div>
      <nav className="tabs" aria-label="Game">
        {(Object.keys(GAMES) as Game[]).map((k) => (
          <Link key={k} href={`/leaderboard?g=${k}&d=${difficulty}`} aria-current={k === game ? 'page' : undefined}>{GAMES[k]}</Link>
        ))}
      </nav>
      <nav className="tabs" aria-label="Difficulty">
        {DIFFS.map((k) => (
          <Link key={k} href={`/leaderboard?g=${game}&d=${k}`} aria-current={k === difficulty ? 'page' : undefined}>{k[0].toUpperCase() + k.slice(1)}</Link>
        ))}
      </nav>
      <section className="card">
        {rows && rows.length ? (
          <table>
            <thead><tr><th>Rank</th><th>Player</th><th>Score</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.display_name}-${i}`}><td>{i + 1}</td><td>{r.display_name}</td><td>{Number(r.best_score).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dim">No scores yet for {GAMES[game]} on {difficulty}. Play a run to take first place.</p>
        )}
      </section>
    </main>
  );
}
