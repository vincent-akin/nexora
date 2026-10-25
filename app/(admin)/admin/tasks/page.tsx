import { createAdminClient } from '@/lib/supabase/admin';
import AdminMsg from '@/components/AdminMsg';
import { createTask, setTaskEnabled, updateTask } from '../actions';

const KIND: Record<string, string> = {
  first_run: 'First run', runs_today: 'Runs in a day', score_today: 'Score in a day', social_x: 'Tweet (manual review)',
  referrals: 'Referrals', stocks_quiz: 'Quiz', token_purchase: 'Token purchase (not available)',
};

export default async function Tasks({ searchParams }: { searchParams: Promise<{ msg?: string; bad?: string }> }) {
  const sp = await searchParams;
  const { data: tasks } = await createAdminClient()
    .from('missions').select('id,slug,title,description,kind,target,difficulty,daily,reward_xp,reward_coins,reward_points,enabled,sort_order')
    .order('sort_order').order('created_at');

  return (
    <>
      <div><h1>Tasks</h1><p className="dim">What players can earn rewards for. Changes apply to claims made from now on.</p></div>
      <AdminMsg msg={sp.msg} bad={sp.bad} />

      <section className="adm-card">
        <h2>Add a task</h2>
        <form action={createTask} className="adm-form">
          <label className="wide">Title<input type="text" name="title" required maxLength={120} placeholder="Play 3 runs today" /></label>
          <label className="wide">Description shown to players<textarea name="description" required maxLength={400} placeholder="What the player has to do." /></label>
          <label>Type
            <select name="kind" required defaultValue="runs_today">
              <option value="first_run">First run: finish one accepted run</option>
              <option value="runs_today">Runs: finish N accepted runs</option>
              <option value="score_today">Score: reach a score in one run</option>
              <option value="referrals">Referrals: refer N friends</option>
              <option value="social_x">Tweet: post and submit a link</option>
              <option value="stocks_quiz">Quiz: multiple choice question</option>
            </select>
          </label>
          <label>Target (runs, score or friends)<input type="number" name="target" min={1} max={100000} defaultValue={1} /></label>
          <label>Difficulty tier (runs and score)
            <select name="difficulty" defaultValue=""><option value="">Any</option><option value="easy">Easy levels</option><option value="normal">Normal levels</option><option value="hard">Hard levels</option></select>
          </label>
          <label className="adm-inline"><input type="checkbox" name="daily" /> Repeats every day</label>
          <label>XP reward<input type="number" name="reward_xp" min={0} max={10000} defaultValue={20} /></label>
          <label>Coins reward<input type="number" name="reward_coins" min={0} max={10000} defaultValue={20} /></label>
          <label>Airdrop Points reward<input type="number" name="reward_points" min={0} max={100} defaultValue={1} /></label>
          <details className="wide">
            <summary>Quiz details (only for the Quiz type)</summary>
            <div className="adm-form" style={{ marginTop: 10 }}>
              <label className="wide">Question<input type="text" name="question" maxLength={300} /></label>
              <label className="wide">Options, one per line<textarea name="options" placeholder={'Stock A\nStock B\nStock C'} /></label>
              <label className="wide">Correct answer (must match an option). Players never see this.<input type="text" name="answer" maxLength={80} /></label>
            </div>
          </details>
          <div className="wide"><button className="adm-btn primary" type="submit">Create task</button></div>
        </form>
      </section>

      <section className="adm-card scroll">
        <h2>All tasks</h2>
        <table>
          <thead><tr><th>Task</th><th>Type</th><th>Target</th><th>Rewards: XP, Coins, Points</th><th>Status</th><th /></tr></thead>
          <tbody>{(tasks ?? []).map((t) => {
            const locked = t.kind === 'token_purchase';
            return (
              <tr key={t.id}>
                <td><b>{t.title}</b><br /><span className="dim">{t.daily ? 'Daily' : 'One time'}{t.difficulty ? `, ${t.difficulty}` : ''}</span></td>
                <td>{KIND[t.kind] ?? t.kind}</td>
                <td colSpan={2}>
                  <form action={updateTask} className="adm-inline" style={{ flexWrap: 'wrap' }}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="number" name="target" defaultValue={t.target} min={1} aria-label="Target" style={{ width: 70 }} />
                    <input type="number" name="reward_xp" defaultValue={t.reward_xp} min={0} aria-label="XP" style={{ width: 70 }} />
                    <input type="number" name="reward_coins" defaultValue={t.reward_coins} min={0} aria-label="Coins" style={{ width: 70 }} />
                    <input type="number" name="reward_points" defaultValue={t.reward_points} min={0} aria-label="Airdrop Points" style={{ width: 60 }} />
                    <button className="adm-btn sm" type="submit">Save</button>
                  </form>
                </td>
                <td>{t.enabled ? <span className="adm-pill good">On</span> : <span className="adm-pill">Off</span>}</td>
                <td>
                  {locked ? <span className="dim">Needs verification</span> : (
                    <form action={setTaskEnabled}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="on" value={t.enabled ? '0' : '1'} />
                      <button className={`adm-btn sm${t.enabled ? ' danger' : ''}`} type="submit">{t.enabled ? 'Turn off' : 'Turn on'}</button></form>
                  )}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
    </>
  );
}
