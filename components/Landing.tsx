import Link from 'next/link';
import Logo from './Logo';
import Icon from './Icon';
import LineIcon from './LineIcon';
import Reveal from './Reveal';
import { POINTS_DISCLAIMER } from '@/lib/copy';

interface Props { signedIn: boolean }

const TASKS = [
  { icon: 'users', title: 'Refer 3 friends', note: 'Milestone', progress: 66, reward: '+5 Airdrop Points' },
  { icon: 'target', title: 'Tweet about the RWAINC token', note: 'Daily, reviewed by a person', progress: 100, reward: '+1 Airdrop Point' },
  { icon: 'chart', title: 'Spot the top performer on the RWA stocks platform', note: 'Daily', progress: 40, reward: '+1 Airdrop Point' },
  { icon: 'lock', title: 'Buy RWAINC tokens', note: 'Coming soon', progress: 0, reward: '+10 Airdrop Points' },
];

/** The public homepage. Presentational only: the page decides whether the visitor is signed in. */
export default function Landing({ signedIn }: Props) {
  const primary = signedIn ? { href: '/dashboard', label: 'Open dashboard' } : { href: '/login?mode=up', label: 'Start playing' };
  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden="true">
        <span className="aurora a1" /><span className="aurora a2" /><span className="aurora a3" /><span className="grid" />
      </div>

      <header className="lp-nav">
        <Link href="/" className="brand"><Logo size={30} /> Nexora</Link>
        <nav aria-label="Sections" className="lp-links">
          <a href="#games">Games</a><a href="#how">How it works</a><a href="#tasks">Tasks</a>
        </nav>
        <div className="lp-nav-cta">
          {signedIn ? null : <Link className="btn ghost" href="/login">Sign in</Link>}
          <Link className="btn primary" href={primary.href}>{primary.label}</Link>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-copy">
            <p className="lp-kicker"><span className="dot" /> Free to play. No token purchase needed.</p>
            <h1>Play short games. <span className="shine">Build your place</span> in the RWA ecosystem.</h1>
            <p className="lp-sub">Nexora is a hybrid game platform. Skill-based games, daily tasks and referrals earn you XP, Coins and Airdrop Points, all tracked on an auditable ledger.</p>
            <div className="lp-cta">
              <Link className="btn primary big-btn" href={primary.href}>{primary.label} <LineIcon name="back" size={16} /></Link>
              <a className="btn big-btn" href="#how">See how it works</a>
            </div>
            <ul className="lp-trust">
              <li><LineIcon name="shield" size={16} /> Rewards decided on the server</li>
              <li><LineIcon name="receipt" size={16} /> Every point has a reason on record</li>
            </ul>
          </div>

          <div className="lp-stage" aria-hidden="true">
            <div className="lp-device lp-beat">
              <div className="lp-lanes">
                {[0, 1, 2, 3].map((l) => (
                  <div className={`lane l${l}`} key={l}><i className="t t1" /><i className="t t2" /></div>
                ))}
              </div>
              <div className="lp-keys"><b>D</b><b>F</b><b>J</b><b>K</b></div>
            </div>
            <div className="lp-device lp-cards">
              <div className="lp-grid6">
                {[0, 1, 2, 3, 4, 5].map((c) => (
                  <div className={`fc f${c}`} key={c}><span className="inner"><span className="back" /><span className="front"><Icon name={['coin', 'star', 'gem', 'bolt', 'heart', 'trophy'][c]} size={26} /></span></span></div>
                ))}
              </div>
            </div>
            <span className="lp-pop p1"><Icon name="star" size={18} /> +25 XP</span>
            <span className="lp-pop p2"><Icon name="coin" size={18} /> +12 Coins</span>
            <span className="lp-pop p3"><Icon name="gem" size={18} /> +2 Airdrop Points</span>
          </div>
        </section>

        <section id="games" className="lp-section">
          <Reveal><h2>Two games live, more on the way</h2><p className="lp-lead">Each game has its own look and feel. They all share one account, one level and one reward ledger.</p></Reveal>
          <div className="lp-games">
            <Reveal delay={0}>
              <article className="lp-game lp-game-beat">
                <div className="art"><i /><i /><i /><i /></div>
                <div className="body"><h3>Beat Lanes</h3><p>Tap the falling tiles in time and make a tune. Quick rhythm runs with combos and star ratings.</p><span className="tag"><LineIcon name="music" size={14} /> 45 to 75 second runs</span></div>
              </article>
            </Reveal>
            <Reveal delay={120}>
              <article className="lp-game lp-game-cards">
                <div className="art"><i /><i /><i /></div>
                <div className="body"><h3>Card Clash</h3><p>Find every pair before the vault locks. The deck lives on the server, so every flip is fair.</p><span className="tag"><LineIcon name="cards" size={14} /> Unlocks at level 2</span></div>
              </article>
            </Reveal>
            <Reveal delay={240}>
              <article className="lp-game lp-game-soon">
                <div className="art soon"><LineIcon name="lock" size={30} /></div>
                <div className="body"><h3>Type Sprint and Market Detective</h3><p>Typing races and RWA market puzzles are in development.</p><span className="tag"><LineIcon name="clock" size={14} /> Coming soon</span></div>
              </article>
            </Reveal>
          </div>
        </section>

        <section id="how" className="lp-section">
          <Reveal><h2>How it works</h2></Reveal>
          <ol className="lp-steps">
            {[
              ['gamepad', 'Play', 'Pick a game and play short runs. Scores are checked on the server, never in your browser.'],
              ['target', 'Complete tasks', 'Daily tasks, referrals and milestones add XP, Coins and Airdrop Points to your balance.'],
              ['trophy', 'Climb', 'Level up to unlock new games, and compete on the leaderboard for each game.'],
            ].map(([ic, t, d], i) => (
              <Reveal key={t} delay={i * 140}>
                <li><span className="num">{i + 1}</span><span className="ic"><LineIcon name={ic} size={22} /></span><h3>{t}</h3><p>{d}</p></li>
              </Reveal>
            ))}
          </ol>
        </section>

        <section id="tasks" className="lp-section lp-split">
          <Reveal>
            <h2>Tasks that count</h2>
            <p className="lp-lead">A mix of play, community and ecosystem tasks. Game tasks complete from validated runs. Social tasks are reviewed by a person before they pay out.</p>
            <p className="lp-fine">{POINTS_DISCLAIMER}</p>
          </Reveal>
          <Reveal delay={150} className="lp-tasks-wrap">
            <div className="lp-tasks">
              {TASKS.map((t) => (
                <div className={`task${t.note === 'Coming soon' ? ' soon' : ''}`} key={t.title}>
                  <span className="ic"><LineIcon name={t.icon} size={18} /></span>
                  <div className="meta"><b>{t.title}</b><small>{t.note}</small><div className="bar"><span style={{ ['--w' as string]: `${t.progress}%` }} /></div></div>
                  <span className="rw">{t.reward}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="lp-final">
          <Reveal>
            <h2>Ready to play?</h2>
            <p className="lp-lead">Create a free account and start earning in under a minute.</p>
            <Link className="btn primary big-btn" href={primary.href}>{primary.label}</Link>
          </Reveal>
        </section>
      </main>

      <footer className="lp-foot">
        <span className="brand"><Logo size={22} /> Nexora</span>
        <p>{POINTS_DISCLAIMER} Nexora is not investment advice, and playing never requires buying a token.</p>
      </footer>
    </div>
  );
}
