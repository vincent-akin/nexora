import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { DIFFICULTY, type Difficulty } from '@/lib/beat-lanes/core';

export const dynamic = 'force-dynamic';

export default async function Leaderboard({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const difficulty: Difficulty = d && d in DIFFICULTY ? (d as Difficulty) : 'normal';
  const supabase = await createClient();

  // Best accepted score per player. Flagged runs are excluded by the view.
  const { data: rows } = await supabase
    .from('leaderboard_best')
    .select('display_name,best_score,achieved_at')
    .eq('game', 'beat_lanes')
    .eq('difficulty', difficulty)
    .order('best_score', { ascending: false })
    .order('achieved_at', { ascending: true })
    .limit(50);

  return (
    <main className="page">
      <div>
        <h1>Leaderboard</h1>
        <p className="dim">Best accepted score per player. Ties go to whoever got there first.</p>
      </div>
      <nav className="tabs" aria-label="Difficulty">
        {(Object.keys(DIFFICULTY) as Difficulty[]).map((k) => (
          <Link key={k} href={`/leaderboard?d=${k}`} aria-current={k === difficulty ? 'page' : undefined}>
            {k[0].toUpperCase() + k.slice(1)}
          </Link>
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
          <p className="dim">No scores yet on {difficulty}. Play a run to take the first place.</p>
        )}
      </section>
    </main>
  );
}
