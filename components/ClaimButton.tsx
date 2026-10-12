'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import LineIcon from './LineIcon';
import RewardPopup, { type Chip } from './RewardPopup';

interface Props {
  url: string;
  body?: Record<string, unknown>;
  label: string;
  disabled?: boolean;
  /** Popup headline when the claim succeeds. */
  title?: string;
  bigIcon?: string;
}

/** POSTs to a claim endpoint and celebrates the server's answer. The server decides everything. */
export default function ClaimButton({ url, body, label, disabled, title = 'Reward claimed!', bigIcon = 'gift' }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ chips: Chip[]; streak?: number } | null>(null);

  async function claim() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) setMsg('Something went wrong. Try again.');
      else if (data.already_claimed === true) setMsg('Already claimed.');
      else if (data.completed === false) setMsg('Not complete yet. Keep playing!');
      else {
        const g = data.grant?.granted ?? {};
        const chips: Chip[] = [
          { icon: 'star', label: 'XP', value: g.xp ?? 0 },
          { icon: 'coin', label: 'Coins', value: g.coins ?? 0 },
          { icon: 'gem', label: 'Airdrop Points', value: g.airdrop_points ?? 0 },
        ].filter((c) => c.value > 0);
        setPopup({ chips, streak: data.streak });
      }
    } catch {
      setMsg('Could not reach the server.');
    }
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button className="btn primary" type="button" onClick={claim} disabled={busy || disabled}>
        <LineIcon name="gift" size={18} /> {label}
      </button>
      {msg ? <span className="notice" role="status">{msg}</span> : null}
      {popup ? (
        <RewardPopup
          variant="shell" title={title} bigIcon={bigIcon} chips={popup.chips}
          subtitle={popup.streak ? `${popup.streak} day streak!` : undefined}
          onClose={() => { setPopup(null); router.refresh(); }}
        />
      ) : null}
    </div>
  );
}
