import { createAdminClient } from '@/lib/supabase/admin';
import AdminMsg from '@/components/AdminMsg';
import { activateRules, publishRules } from '../actions';

interface Rules { stamina_cap: number; stamina_refill_seconds: number; run_stamina_cost: number; session_ttl_seconds: number; daily_caps: { xp: number; coins: number; airdrop_points: number } }

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ msg?: string; bad?: string }> }) {
  const sp = await searchParams;
  const { data: versions } = await createAdminClient().from('rules_versions').select('version,config,active,note,created_at').order('created_at', { ascending: false }).limit(15);
  const live = (versions ?? []).find((v) => v.active);
  const c = (live?.config ?? {}) as Rules;

  return (
    <>
      <div><h1>Rules</h1><p className="dim">The economy of the game: stamina, run length, and how much a player can earn in a day. A change goes live for everyone at once.</p></div>
      <AdminMsg msg={sp.msg} bad={sp.bad} />

      <section className="adm-card">
        <h2>Live rules {live ? <span className="adm-pill good">{live.version}</span> : null}</h2>
        <form action={publishRules} className="adm-form">
          <label>Stamina cap<input type="number" name="stamina_cap" defaultValue={c.stamina_cap} min={1} max={100} required /></label>
          <label>Seconds to earn 1 stamina<input type="number" name="stamina_refill_seconds" defaultValue={c.stamina_refill_seconds} min={60} max={86400} required /></label>
          <label>Stamina a run costs<input type="number" name="run_stamina_cost" defaultValue={c.run_stamina_cost} min={1} max={10} required /></label>
          <label>Seconds a run may stay open<input type="number" name="session_ttl_seconds" defaultValue={c.session_ttl_seconds} min={240} max={900} required /></label>
          <label>Daily cap: XP<input type="number" name="cap_xp" defaultValue={c.daily_caps?.xp} min={1} required /></label>
          <label>Daily cap: Coins<input type="number" name="cap_coins" defaultValue={c.daily_caps?.coins} min={1} required /></label>
          <label>Daily cap: Airdrop Points<input type="number" name="cap_points" defaultValue={c.daily_caps?.airdrop_points} min={1} required /></label>
          <label className="wide">Why are you changing the rules? (kept with the version)<input type="text" name="note" maxLength={200} required /></label>
          <div className="wide"><button className="adm-btn primary" type="submit">Publish new rules</button></div>
        </form>
        <p className="adm-note">
          The daily caps limit what one player can earn from game runs in a day, so <b>raising the Airdrop Points cap changes the airdrop economy</b> for every player. A run stays open at least 240 seconds because the longest run is 150 seconds. Level ladders, game speeds and word lengths are part of each game and change in the code, not here.
        </p>
      </section>

      <section className="adm-card scroll">
        <h2>History</h2>
        <table>
          <thead><tr><th>Version</th><th>Published</th><th>Stamina</th><th>Daily caps (XP, Coins, Points)</th><th>Note</th><th /></tr></thead>
          <tbody>{(versions ?? []).map((v) => {
            const r = v.config as Rules;
            return (
              <tr key={v.version}>
                <td>{v.version} {v.active ? <span className="adm-pill good">Live</span> : null}</td>
                <td>{new Date(v.created_at).toLocaleString()}</td>
                <td>{r.stamina_cap} max, 1 per {Math.round(r.stamina_refill_seconds / 60)} min</td>
                <td>{r.daily_caps?.xp}, {r.daily_caps?.coins}, {r.daily_caps?.airdrop_points}</td>
                <td>{v.note ?? ''}</td>
                <td>{v.active ? null : <form action={activateRules}><input type="hidden" name="version" value={v.version} /><button className="adm-btn sm" type="submit">Switch back</button></form>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
    </>
  );
}
