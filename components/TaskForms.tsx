'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LineIcon from './LineIcon';
import RewardPopup, { type Chip } from './RewardPopup';

const chipsFrom = (g: { xp?: number; coins?: number; airdrop_points?: number } = {}): Chip[] =>
  [
    { icon: 'star', label: 'XP', value: g.xp ?? 0 },
    { icon: 'coin', label: 'Coins', value: g.coins ?? 0 },
    { icon: 'gem', label: 'Airdrop Points', value: g.airdrop_points ?? 0 },
  ].filter((c) => c.value > 0);

/** Post on X, then submit the link. A reviewer approves it; nothing is verified automatically. */
export function SocialTask({ missionId, status, note }: { missionId: string; status: 'pending' | 'approved' | 'rejected' | null; note?: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/missions/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, url }),
      });
      const data = await res.json();
      if (data.error === 'invalid_url') setMsg('That does not look like a link to a tweet. It should look like https://x.com/yourname/status/123...');
      else if (data.error === 'url_already_used') setMsg('That tweet has already been submitted.');
      else if (!res.ok) setMsg('Something went wrong. Try again.');
      else { setUrl(''); router.refresh(); }
    } catch {
      setMsg('Could not reach the server.');
    }
    setBusy(false);
  }

  if (status === 'approved') return <span className="pill live"><LineIcon name="check" size={12} /> Approved and paid</span>;
  if (status === 'pending') return <span className="pill locked"><LineIcon name="clock" size={12} /> Submitted, waiting for review</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {status === 'rejected' ? <p className="notice bad">Your last link was not accepted{note ? `: ${note}` : ''}. You can submit a different tweet.</p> : null}
      <a className="btn" href="https://x.com/intent/post" target="_blank" rel="noopener noreferrer">Open X to post</a>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the link to your tweet"
          aria-label="Link to your tweet" style={{ flex: '1 1 220px' }}
        />
        <button className="btn primary" type="submit" disabled={busy}>Submit for review</button>
      </form>
      {msg ? <p className="notice" role="status">{msg}</p> : null}
    </div>
  );
}

/** A one-try-per-day question. The answer is checked on the server and is never sent to the browser. */
export function QuizTask({ missionId, question, options, done, isTest }: { missionId: string; question: string; options: string[]; done: boolean; isTest?: boolean }) {
  const router = useRouter();
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [popup, setPopup] = useState<Chip[] | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!choice) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/missions/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, answer: choice }),
      });
      const data = await res.json();
      if (!res.ok) setMsg('Something went wrong. Try again.');
      else if (data.locked) setMsg('You have used your try for today. Come back tomorrow.');
      else if (data.wrong_answer) setMsg('Not quite. That was your one try for today.');
      else if (data.completed) setPopup(chipsFrom(data.grant?.granted));
      else setMsg('Could not check that answer.');
    } catch {
      setMsg('Could not reach the server.');
    }
    setBusy(false);
  }

  if (done) return <span className="pill live"><LineIcon name="check" size={12} /> Done for today</span>;
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ fontWeight: 700, marginBottom: 6 }}>{question}</legend>
        {options.map((o) => (
          <label key={o} className="choice">
            <input type="radio" name={`q-${missionId}`} value={o} checked={choice === o} onChange={() => setChoice(o)} /> {o}
          </label>
        ))}
      </fieldset>
      {isTest ? <p className="notice">Test data: the answer is set by an admin until the stocks platform connection is approved.</p> : null}
      <button className="btn primary" type="submit" disabled={busy || !choice}>Submit answer</button>
      {msg ? <p className="notice" role="status">{msg}</p> : null}
      {popup ? <RewardPopup variant="shell" title="Correct" chips={popup} onClose={() => { setPopup(null); router.refresh(); }} /> : null}
    </form>
  );
}
