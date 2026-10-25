import Link from 'next/link';
import { isAdminSession } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';
import { levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import LineIcon from '@/components/LineIcon';

export const dynamic = 'force-dynamic';

interface GameInfo {
  slug: string;
  title: string;
  tagline: string;
  icon: string;
  art: string;
  minLevel: number;
  /** Built games link to their own screen. The rest show as upcoming. */
  live: boolean;
  meta: { icon: string; text: string }[];
}

// Each game gets its own screen and its own look. The hub only lists them.
const GAMES: GameInfo[] = [
  { slug: 'beat-lanes', title: 'Beat Lanes', tagline: 'Tap the falling tiles in time and make a tune.', icon: 'music', art: 'art-beat', minLevel: 1, live: true,
    meta: [{ icon: 'clock', text: '45 to 75 s' }, { icon: 'bolt', text: '1 stamina' }, { icon: 'star', text: '10 levels' }] },
  { slug: 'block-drop', title: 'Block Drop', tagline: 'Stack the colourful blocks. Every level falls faster.', icon: 'cards', art: 'art-blocks', minLevel: 2, live: true,
    meta: [{ icon: 'clock', text: 'Up to 2.5 min' }, { icon: 'bolt', text: '1 stamina' }, { icon: 'star', text: '15 levels' }] },
  { slug: 'type-sprint', title: 'Type Sprint', tagline: 'Words fall faster and get longer every level.', icon: 'keyboard', art: 'art-type', minLevel: 3, live: true,
    meta: [{ icon: 'clock', text: 'Up to 2.5 min' }, { icon: 'bolt', text: '1 stamina' }, { icon: 'star', text: '12 levels' }] },
  { slug: 'market-detective', title: 'Market Detective', tagline: 'Read the charts and spot the standout performer.', icon: 'chart', art: 'art-market', minLevel: 4, live: true,
    meta: [{ icon: 'clock', text: 'About 2 min' }, { icon: 'bolt', text: '1 stamina' }, { icon: 'star', text: '10 levels' }] },
];

function Art({ kind }: { kind: string }) {
  if (kind === 'art-market') {
    return (
      <div className="game-art art-market" aria-hidden="true">
        <svg viewBox="0 0 300 110" preserveAspectRatio="none">
          <polyline points="0,90 40,70 80,78 120,40 160,55 200,25 240,38 300,8" fill="none" stroke="#5B8CFF" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          <polyline points="0,100 50,92 90,96 140,80 190,86 240,70 300,62" fill="none" stroke="#2DD4BF" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" opacity=".7" />
        </svg>
      </div>
    );
  }
  return <div className={`game-art ${kind}`} aria-hidden="true"><i /><i /><i /><i /></div>;
}

export default async function Arena() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: bal }, { data: levels }] = await Promise.all([
    supabase.from('player_balances').select('xp').eq('user_id', user!.id).single(),
    supabase.from('level_config').select('level,name,xp_required'),
  ]);
  const level = levelForXp(Number(bal?.xp ?? 0), (levels ?? []) as LevelRow[]);
  const practice = await isAdminSession(supabase, user!.id);

  return (
    <main className="page">
      <section className="page-head">
        <h1>Arena</h1>
        {practice ? <p className="notice">Admin practice mode: every game and level is open, boosts are free, and nothing you play earns rewards or appears in analytics.</p> : null}
        <p className="dim">Pick a game. Every game has its own screen, and all of them share your level, balances and stamina.</p>
      </section>
      <section className="games" aria-label="Games">
        {GAMES.map((g) => {
          const unlocked = level.level >= g.minLevel || practice;
          const playable = g.live && unlocked;
          const body = (
            <>
              <Art kind={g.art} />
              <div className="game-body">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <h2>{g.title}</h2>
                  {playable ? <span className="pill live">Open</span> : <span className="pill locked"><LineIcon name="lock" size={12} /> {g.live ? `Level ${g.minLevel}` : 'Coming soon'}</span>}
                </div>
                <p className="dim">{g.tagline}</p>
                <div className="game-meta">
                  {g.meta.map((m) => <span key={m.text}><LineIcon name={m.icon} size={14} /> {m.text}</span>)}
                </div>
                <div className="game-foot">
                  {playable ? <span className="btn primary" style={{ width: '100%' }}><LineIcon name={g.icon} /> Play</span>
                    : <span className="btn" style={{ width: '100%', opacity: 0.6 }}>{g.live ? `Unlocks at level ${g.minLevel}` : 'In development'}</span>}
                </div>
              </div>
            </>
          );
          return playable
            ? <Link key={g.slug} href={`/arena/${g.slug}`} className="game-card live">{body}</Link>
            : <div key={g.slug} className="game-card soon" aria-disabled="true">{body}</div>;
        })}
      </section>
    </main>
  );
}
