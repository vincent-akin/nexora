import { createAdminClient } from '@/lib/supabase/admin';
import AdminMsg from '@/components/AdminMsg';
import { BOOST_TEXT, GAME_BOOSTS } from '@/lib/boosts';
import { GAMES, type GameKey } from '@/lib/levels';
import { createShopItem, updateShopItem } from '../actions';

const gameLabel = (g: string) => (g === 'all' ? 'Any game' : GAMES[g as GameKey]?.label ?? g);

export default async function ShopAdmin({ searchParams }: { searchParams: Promise<{ msg?: string; bad?: string }> }) {
  const sp = await searchParams;
  const { data: items } = await createAdminClient().from('shop_items').select('id,slug,name,description,category,game,price_coins,min_level,active,consumable,effect').order('game').order('sort_order');
  const boostChoices = (Object.keys(GAME_BOOSTS) as GameKey[]).flatMap((g) => GAME_BOOSTS[g].map((k) => ({ value: `${g}:${k}`, label: `${GAMES[g].label}: ${BOOST_TEXT[g][k]?.name}` })));

  return (
    <>
      <div><h1>Shop</h1><p className="dim">Prices, level locks and availability. Players who already own an item keep it when it is switched off.</p></div>
      <AdminMsg msg={sp.msg} bad={sp.bad} />

      <section className="adm-card">
        <h2>Add an item</h2>
        <form action={createShopItem} className="adm-form" id="new-item">
          <label>Name<input type="text" name="name" required maxLength={60} /></label>
          <label>Game
            <select name="game" required defaultValue="all">
              {(Object.keys(GAMES) as GameKey[]).map((g) => <option key={g} value={g}>{GAMES[g].label}</option>)}
              <option value="all">Any game</option>
            </select>
          </label>
          <label>Price in Coins<input type="number" name="price" min={1} max={1000000} defaultValue={100} /></label>
          <label>Player level needed<input type="number" name="min_level" min={1} max={50} defaultValue={1} /></label>
          <label className="wide">Description<input type="text" name="description" required maxLength={240} /></label>
          <label>Boost (makes it a one-run boost)
            <select name="boost" defaultValue="">
              <option value="">None: a skin, sound or bonus</option>
              {boostChoices.map((b) => <option key={b.value} value={b.value.split(':')[1]}>{b.label}</option>)}
            </select>
          </label>
          <label>Category (when not a boost)
            <select name="category" defaultValue="skin"><option value="skin">Skin</option><option value="sound">Sound pack</option><option value="bonus">Bonus</option></select>
          </label>
          <label className="adm-inline"><input type="checkbox" name="consumable" /> Used up when spent</label>
          <label className="wide">Effect as JSON (when not a boost)<textarea name="effect" placeholder='{"theme": "emerald"}' /></label>
          <div className="wide"><button className="adm-btn primary" type="submit">Add item</button></div>
        </form>
        <p className="dim">A boost only works with the game it belongs to, so choose the game first. The boost must be one that game supports.</p>
      </section>

      <section className="adm-card scroll">
        <h2>Items</h2>
        <table>
          <thead><tr><th>Game</th><th>Type</th><th>Edit item</th></tr></thead>
          <tbody>{(items ?? []).map((i) => (
            <tr key={i.id}>
              <td>{gameLabel(i.game)}</td>
              <td>{(i.effect as { type?: string })?.type === 'boost' ? <span className="adm-pill amber">Boost</span> : <span className="adm-pill">{i.category}</span>}<br /><span className="dim">{i.slug}</span></td>
              <td>
                <form action={updateShopItem} className="adm-form">
                  <input type="hidden" name="id" value={i.id} />
                  <label>Name<input type="text" name="name" defaultValue={i.name} maxLength={60} required /></label>
                  <label className="wide">Description<input type="text" name="description" defaultValue={i.description} maxLength={240} required /></label>
                  <label>Price in Coins<input type="number" name="price" defaultValue={i.price_coins} min={1} /></label>
                  <label>Player level needed<input type="number" name="min_level" defaultValue={i.min_level} min={1} /></label>
                  <label className="adm-inline"><input type="checkbox" name="active" defaultChecked={i.active} /> On sale</label>
                  <div><button className="adm-btn sm" type="submit">Save</button></div>
                </form>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}
