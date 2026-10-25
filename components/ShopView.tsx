'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import LineIcon from './LineIcon';

export interface ShopItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: 'skin' | 'sound' | 'bonus';
  game: string;
  price_coins: number;
  effect: Record<string, unknown>;
  consumable: boolean;
  min_level: number;
}

interface Props {
  coins: number;
  level: number;
  items: ShopItem[];
  /** item id -> quantity owned */
  owned: Record<string, number>;
  /** ids of equipped skins and sound packs */
  equipped: string[];
}

const GAMES: Record<string, string> = {
  beat_lanes: 'Beat Lanes', block_drop: 'Block Drop', type_sprint: 'Type Sprint', market_detective: 'Market Detective', all: 'Any game',
};
const ORDER = ['beat_lanes', 'block_drop', 'type_sprint', 'market_detective', 'all'];
const CATEGORY: Record<string, string> = { skin: 'Skin', sound: 'Sound pack', bonus: 'Boost' };
const isBoost = (e: Record<string, unknown>) => e.type === 'boost';
const SWATCH: Record<string, string> = { amber: '#FFB84A', ice: '#7DE3FF', slate: '#A9B4C6', gold: '#F2C14E', emerald: '#12703F', obsidian: '#1E232E' };

/** A few colours that hint at what a skin looks like. */
function swatches(effect: Record<string, unknown>): string[] {
  const palette = effect.palette as { mid: string }[] | undefined;
  if (palette) return palette.map((p) => p.mid);
  const key = (effect.theme ?? effect.back) as string | undefined;
  return key && SWATCH[key] ? [SWATCH[key]] : [];
}

export default function ShopView({ coins, level, items, owned, equipped }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function call(url: string, body: Record<string, unknown>, id: string, ok: string) {
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.error === 'not_enough_coins') setMsg(`Not enough Coins. You need ${data.price} and have ${data.coins}.`);
      else if (data.error === 'locked') setMsg(`That unlocks at level ${data.required_level}.`);
      else if (data.error === 'already_owned') setMsg('You already own that.');
      else if (data.error === 'none_left') setMsg('You have none left to use.');
      else if (!res.ok) setMsg('Something went wrong. Try again.');
      else { setMsg(ok); router.refresh(); }
    } catch {
      setMsg('Could not reach the server.');
    }
    setBusy(null);
  }

  const groups = ORDER.map((g) => ({ game: g, items: items.filter((i) => i.game === g) })).filter((g) => g.items.length);

  return (
    <main className="page">
      <section className="page-head">
        <h1>Shop</h1>
        <p className="dim">Spend Coins on skins, sounds and boosts. Coins are earned by playing and are never real money. Skins and sounds change nothing about a run. A boost helps you in a single run, and a boosted run earns XP and Coins but no Airdrop Points and stays off the leaderboard.</p>
      </section>
      <div className="shop-bar">
        <span className="stat-ic coins"><Icon name="coin" size={18} /></span>
        <b>{coins.toLocaleString()}</b> <span className="dim">Coins</span>
        <span role="status" className="shop-msg">{msg}</span>
      </div>

      {groups.map((g) => (
        <section key={g.game} className="page" style={{ gap: 12 }}>
          <h2>{GAMES[g.game]}</h2>
          <div className="shop-grid">
            {g.items.map((it) => {
              const qty = owned[it.id] ?? 0;
              const isOwned = qty > 0;
              const isEq = equipped.includes(it.id);
              const sw = swatches(it.effect);
              const locked = level < it.min_level;
              const poor = coins < it.price_coins;
              return (
                <article className={`shop-item${isOwned && !it.consumable ? ' owned' : ''}`} key={it.id}>
                  <div className="shop-art" aria-hidden="true">
                    {sw.length ? sw.map((c, i) => <i key={i} style={{ background: c }} />) : <LineIcon name={it.category === 'sound' ? 'speaker' : it.category === 'bonus' ? 'bolt' : 'palette'} size={30} />}
                  </div>
                  <div className="shop-body">
                    <div className="shop-top"><h3>{it.name}</h3><span className="pill locked">{CATEGORY[it.category]}</span></div>
                    <p className="dim">{it.description}</p>
                    {it.consumable && qty > 0 ? <p className="notice">You have {qty}.{isBoost(it.effect) ? ' Pick it on the game\'s start screen.' : ''}</p> : null}
                  </div>
                  <div className="shop-foot">
                    {isOwned && !it.consumable ? (
                      <button className={`btn${isEq ? '' : ' primary'}`} type="button" disabled={busy === it.id}
                        onClick={() => call('/api/shop/equip', { itemId: it.id, on: !isEq }, it.id, isEq ? 'Unequipped.' : 'Equipped. It applies next time you open the game.')}>
                        {isEq ? 'Equipped' : 'Equip'}
                      </button>
                    ) : (
                      <>
                        <button className="btn primary" type="button" disabled={busy === it.id || locked || poor}
                          onClick={() => call('/api/shop/purchase', { itemId: it.id, requestId: crypto.randomUUID() }, it.id, `Bought ${it.name}.`)}>
                          {locked ? <><LineIcon name="lock" size={14} /> Level {it.min_level}</> : <><Icon name="coin" size={16} /> {it.price_coins.toLocaleString()}</>}
                        </button>
                        {it.consumable && qty > 0 && !isBoost(it.effect) ? (
                          <button className="btn" type="button" disabled={busy === it.id} onClick={() => call('/api/shop/use', { itemId: it.id }, it.id, 'Stamina added.')}>Use one</button>
                        ) : null}
                      </>
                    )}
                    {!isOwned && poor && !locked ? <span className="notice">Need {(it.price_coins - coins).toLocaleString()} more</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
