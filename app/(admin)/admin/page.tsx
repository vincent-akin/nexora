import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { GAMES, type GameKey } from '@/lib/levels';

interface Analytics {
  players_total: number; players_new_7d: number; players_suspended: number; active_24h: number; active_7d: number;
  runs_total: number; runs_24h: number; runs_flagged_7d: number; runs_rejected_7d: number; boosted_runs_7d: number;
  coins_issued_7d: number; coins_spent_7d: number; points_issued_7d: number; points_issued_total: number;
  pending_tweets: number; pending_flags: number; pending_referrals: number;
  per_game: { game: string; runs: number; players: number; avg_score: number; avg_level: number; flagged: number }[];
  per_day: { day: string; runs: number; players: number; signups: number }[];
  top_players: { name: string; xp: number; coins: number; points: number }[];
  best_sellers: { name: string; game: string; sold: number }[];
}

const n = (v: number | undefined) => Number(v ?? 0).toLocaleString();
const gameName = (g: string) => GAMES[g as GameKey]?.label ?? (g === 'card_clash' ? 'Card Clash (retired)' : g);

export default async function Overview({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: d } = await searchParams;
  const days = [7, 14, 30].includes(Number(d)) ? Number(d) : 14;
  const { data, error } = await createAdminClient().rpc('admin_analytics', { p_days: days });
  if (error || !data) {
    return (
      <>
        <h1>Overview</h1>
        <p className="adm-msg bad">Analytics could not load. Apply supabase/migrations/0006_levels_boosts_admin.sql. ({error?.message})</p>
      </>
    );
  }
  const a = data as Analytics;
  const maxRuns = Math.max(1, ...a.per_day.map((x) => x.runs));
  const maxSign = Math.max(1, ...a.per_day.map((x) => x.signups));
  const waiting = a.pending_tweets + a.pending_flags + a.pending_referrals;
  const flaggedRate = a.runs_total ? Math.round((a.runs_flagged_7d / Math.max(1, a.per_day.reduce((s, x) => s + x.runs, 0))) * 100) : 0;

  return (
    <>
      <div className="adm-head">
        <div>
          <h1>Overview</h1>
          <p className="dim">How the game is doing, and what needs you.</p>
        </div>
        <div className="adm-tabs" aria-label="Range">
          {[7, 14, 30].map((x) => <Link key={x} href={`/admin?days=${x}`} aria-current={x === days ? 'page' : undefined}>{x} days</Link>)}
        </div>
      </div>

      {waiting > 0 ? (
        <p className="adm-note">
          <b>{waiting}</b> item{waiting === 1 ? '' : 's'} waiting for review: {a.pending_tweets} tweet{a.pending_tweets === 1 ? '' : 's'}, {a.pending_flags} flagged run{a.pending_flags === 1 ? '' : 's'}, {a.pending_referrals} referral{a.pending_referrals === 1 ? '' : 's'}. <Link href="/admin/reviews">Open reviews</Link>
        </p>
      ) : null}

      <section className="adm-grid adm-kpis" aria-label="Key numbers">
        <div className="adm-kpi"><span>Players</span><b>{n(a.players_total)}</b><small>{n(a.players_new_7d)} new this week</small></div>
        <div className="adm-kpi"><span>Active, last 24 h</span><b>{n(a.active_24h)}</b><small>{n(a.active_7d)} in 7 days</small></div>
        <div className="adm-kpi"><span>Runs, last 24 h</span><b>{n(a.runs_24h)}</b><small>{n(a.runs_total)} all time</small></div>
        <div className={`adm-kpi${a.runs_flagged_7d ? ' warn' : ''}`}><span>Flagged runs, 7 days</span><b>{n(a.runs_flagged_7d)}</b><small>{a.runs_rejected_7d} rejected outright, {flaggedRate}% of runs flagged</small></div>
        <div className="adm-kpi"><span>Coins issued, 7 days</span><b>{n(a.coins_issued_7d)}</b><small>{n(a.coins_spent_7d)} spent in the shop</small></div>
        <div className="adm-kpi"><span>Airdrop Points, 7 days</span><b>{n(a.points_issued_7d)}</b><small>{n(a.points_issued_total)} issued in total</small></div>
        <div className="adm-kpi"><span>Boosted runs, 7 days</span><b>{n(a.boosted_runs_7d)}</b><small>No Airdrop Points paid on these</small></div>
        <div className={`adm-kpi${a.players_suspended ? ' warn' : ''}`}><span>Suspended players</span><b>{n(a.players_suspended)}</b><small><Link href="/admin/players">Manage players</Link></small></div>
      </section>

      <section className="adm-card" aria-labelledby="runs-h">
        <div className="adm-head">
          <h2 id="runs-h">Runs and sign-ups per day</h2>
          <div className="adm-legend"><span><i />Runs</span><span><i className="alt" />Sign-ups</span></div>
        </div>
        <div className="adm-bars" role="img" aria-label={`Runs and sign-ups for the last ${days} days`}>
          {a.per_day.map((x) => (
            <div key={x.day} title={`${x.day}: ${x.runs} runs, ${x.players} players, ${x.signups} sign-ups`}>
              <i style={{ height: `${(x.runs / maxRuns) * 100}%` }} />
              <i className="alt" style={{ height: `${(x.signups / maxSign) * 30}%` }} />
              <span>{x.day.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="adm-grid adm-two">
        <section className="adm-card scroll" aria-labelledby="games-h">
          <h2 id="games-h">Games, last {days} days</h2>
          {a.per_game.length ? (
            <table>
              <thead><tr><th>Game</th><th>Runs</th><th>Players</th><th>Avg score</th><th>Avg level</th><th>Flagged</th></tr></thead>
              <tbody>{a.per_game.map((g) => (
                <tr key={g.game}><td>{gameName(g.game)}</td><td>{n(g.runs)}</td><td>{n(g.players)}</td><td>{n(g.avg_score)}</td><td>{g.avg_level}</td>
                  <td>{g.flagged ? <span className="adm-pill bad">{g.flagged}</span> : 0}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="dim">No runs in this period.</p>}
        </section>

        <section className="adm-card scroll" aria-labelledby="top-h">
          <h2 id="top-h">Top players by XP</h2>
          {a.top_players.length ? (
            <table>
              <thead><tr><th>Player</th><th>XP</th><th>Coins</th><th>Points</th></tr></thead>
              <tbody>{a.top_players.map((p, i) => <tr key={i}><td>{p.name}</td><td>{n(p.xp)}</td><td>{n(p.coins)}</td><td>{n(p.points)}</td></tr>)}</tbody>
            </table>
          ) : <p className="dim">No players yet.</p>}
        </section>

        <section className="adm-card scroll" aria-labelledby="sell-h">
          <h2 id="sell-h">Best sellers in the shop</h2>
          {a.best_sellers.length ? (
            <table>
              <thead><tr><th>Item</th><th>Game</th><th>Sold</th></tr></thead>
              <tbody>{a.best_sellers.map((s, i) => <tr key={i}><td>{s.name}</td><td>{s.game === 'all' ? 'Any' : gameName(s.game)}</td><td>{n(s.sold)}</td></tr>)}</tbody>
            </table>
          ) : <p className="dim">Nothing sold yet.</p>}
        </section>
      </div>
    </>
  );
}
