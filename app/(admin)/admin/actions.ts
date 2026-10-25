'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit, requireAdmin } from '@/lib/admin';
import { GAME_BOOSTS, type BoostKind } from '@/lib/boosts';

/**
 * Every action re-checks the admin gate on the server (the page being hidden is not enough), validates
 * its input, and writes an audit record. Results come back as a message on the redirect.
 */
function done(path: string, msg: string, bad = false, q = ''): never {
  revalidatePath(path);
  redirect(`${path}?${q ? `q=${encodeURIComponent(q)}&` : ''}msg=${encodeURIComponent(msg)}${bad ? '&bad=1' : ''}`);
}

const str = (f: FormData, k: string, max = 400) => String(f.get(k) ?? '').trim().slice(0, max);
const int = (f: FormData, k: string, lo: number, hi: number, dflt = 0) => {
  const n = Math.floor(Number(f.get(k)));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** Marks a risk flag as reviewed. */
export async function markReviewed(formData: FormData) {
  const actor = await requireAdmin();
  const id = str(formData, 'id');
  if (!id) return;
  await createAdminClient().from('risk_flags').update({ reviewed: true }).eq('id', id);
  await audit(actor.id, 'risk_flag_reviewed', id);
  done('/admin/reviews', 'Flag marked as reviewed.');
}

/** Rejects a pending referral so it can never be approved. */
export async function rejectReferral(formData: FormData) {
  const actor = await requireAdmin();
  const id = str(formData, 'id');
  if (!id) return;
  await createAdminClient().from('referrals').update({ status: 'rejected' }).eq('id', id).eq('status', 'pending');
  await audit(actor.id, 'referral_rejected', id);
  done('/admin/reviews', 'Referral rejected.');
}

/** Approves or rejects a tweet submission. Approval pays the reward once. */
export async function reviewSocial(formData: FormData) {
  const actor = await requireAdmin();
  const id = str(formData, 'id');
  const approve = formData.get('decision') === 'approve';
  if (!id) return;
  await createAdminClient().rpc('review_social_submission', { p_id: id, p_approve: approve, p_actor: actor.id, p_note: str(formData, 'note', 200) || null });
  done('/admin/reviews', approve ? 'Tweet approved and reward paid.' : 'Tweet rejected.');
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const TASK_KINDS = ['first_run', 'runs_today', 'score_today', 'social_x', 'referrals', 'stocks_quiz'] as const;

/** Creates a task. The quiz answer is stored where players can never read it. */
export async function createTask(formData: FormData) {
  const actor = await requireAdmin();
  const title = str(formData, 'title', 120);
  const description = str(formData, 'description', 400);
  const kind = str(formData, 'kind');
  if (!title || !description) done('/admin/tasks', 'A task needs a title and a description.', true);
  if (!(TASK_KINDS as readonly string[]).includes(kind)) done('/admin/tasks', 'Pick a task type.', true);

  const difficulty = str(formData, 'difficulty');
  const row: Record<string, unknown> = {
    slug: `${slugify(title)}-${randomUUID().slice(0, 6)}`,
    title, description, kind,
    target: int(formData, 'target', 1, 100000, 1),
    difficulty: ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : null,
    daily: formData.get('daily') === 'on',
    reward_xp: int(formData, 'reward_xp', 0, 10000),
    reward_coins: int(formData, 'reward_coins', 0, 10000),
    reward_points: int(formData, 'reward_points', 0, 100),
    requires_review: kind === 'social_x',
    enabled: true, active: true, sort_order: 100,
    params: {}, secret_answer: null,
  };

  if (kind === 'stocks_quiz') {
    const question = str(formData, 'question', 300);
    const options = String(formData.get('options') ?? '').split('\n').map((o) => o.trim().slice(0, 80)).filter(Boolean);
    const answer = str(formData, 'answer', 80).toLowerCase();
    const match = options.find((o) => o.toLowerCase() === answer);
    if (!question || options.length < 2 || options.length > 6) done('/admin/tasks', 'A quiz needs a question and two to six options, one per line.', true);
    if (!match) done('/admin/tasks', 'The correct answer must match one of the options exactly.', true);
    row.params = { question, options };
    row.secret_answer = match;
    row.target = 1;
  }
  if (kind === 'social_x') row.target = 1;

  const { error } = await createAdminClient().from('missions').insert(row);
  if (error) done('/admin/tasks', `Could not create the task: ${error.message}`, true);
  await audit(actor.id, 'task_created', String(row.slug), { kind, title });
  done('/admin/tasks', `Task "${title}" created.`);
}

/** Turns a task on or off. A task that is off is hidden from claims and tweet submissions. */
export async function setTaskEnabled(formData: FormData) {
  const actor = await requireAdmin();
  const id = str(formData, 'id');
  const on = formData.get('on') === '1';
  if (!id) return;
  await createAdminClient().from('missions').update({ enabled: on, active: on }).eq('id', id);
  await audit(actor.id, on ? 'task_enabled' : 'task_disabled', id);
  done('/admin/tasks', on ? 'Task turned on.' : 'Task turned off.');
}

/** Changes a task's rewards and target. Takes effect for claims made from now on. */
export async function updateTask(formData: FormData) {
  const actor = await requireAdmin();
  const id = str(formData, 'id');
  if (!id) return;
  const patch = {
    target: int(formData, 'target', 1, 100000, 1),
    reward_xp: int(formData, 'reward_xp', 0, 10000),
    reward_coins: int(formData, 'reward_coins', 0, 10000),
    reward_points: int(formData, 'reward_points', 0, 100),
  };
  await createAdminClient().from('missions').update(patch).eq('id', id);
  await audit(actor.id, 'task_updated', id, patch);
  done('/admin/tasks', 'Task updated.');
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** Suspends or reactivates a player. A suspended player cannot start runs and is off the leaderboard. */
export async function setPlayerStatus(formData: FormData) {
  const actor = await requireAdmin();
  const id = str(formData, 'id');
  const status = str(formData, 'status');
  const q = str(formData, 'q');
  if (!id || !['active', 'suspended'].includes(status)) return;
  if (id === actor.id) done('/admin/players', 'You cannot suspend your own account.', true);
  await createAdminClient().from('profiles').update({ account_status: status }).eq('id', id);
  await audit(actor.id, status === 'suspended' ? 'player_suspended' : 'player_reactivated', id, { reason: str(formData, 'reason', 200) });
  done('/admin/players', status === 'suspended' ? 'Player suspended.' : 'Player reactivated.', false, q);
}

/**
 * Gives a player XP or Coins through the same ledger as every other reward, so it is idempotent and
 * visible in their history. Airdrop Points cannot be granted here on purpose: they are earned in play.
 */
export async function grantPlayer(formData: FormData) {
  const actor = await requireAdmin();
  const id = str(formData, 'id');
  const xp = int(formData, 'xp', 0, 100000);
  const coins = int(formData, 'coins', 0, 100000);
  const reason = str(formData, 'reason', 120);
  if (!id) return;
  if (!xp && !coins) done('/admin/players', 'Enter an amount of XP or Coins.', true);
  if (!reason) done('/admin/players', 'Give a reason. It goes in the audit log.', true);
  const { error } = await createAdminClient().rpc('grant_reward', {
    p_user: id, p_xp: xp, p_coins: coins, p_points: 0, p_reason: 'admin_grant', p_source_type: 'admin', p_source_id: null, p_idempotency_key: `admin:${randomUUID()}`,
  });
  if (error) done('/admin/players', `Could not grant: ${error.message}`, true);
  await audit(actor.id, 'player_grant', id, { xp, coins, reason });
  done('/admin/players', `Granted ${xp} XP and ${coins} Coins.`, false, str(formData, 'q'));
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Publishes a new version of the economy rules and makes it active at once. The database checks the
 * limits (for example a session must outlast the longest run) and refuses anything unsafe.
 */
export async function publishRules(formData: FormData) {
  const actor = await requireAdmin();
  const db = createAdminClient();
  const { data: current } = await db.from('rules_versions').select('config').eq('active', true).single();
  const config = {
    ...((current?.config as Record<string, unknown>) ?? {}),
    stamina_cap: int(formData, 'stamina_cap', 0, 1_000_000),
    stamina_refill_seconds: int(formData, 'stamina_refill_seconds', 0, 10_000_000),
    run_stamina_cost: int(formData, 'run_stamina_cost', 0, 1000),
    session_ttl_seconds: int(formData, 'session_ttl_seconds', 0, 10_000_000),
    daily_caps: { xp: int(formData, 'cap_xp', 0, 100_000_000), coins: int(formData, 'cap_coins', 0, 100_000_000), airdrop_points: int(formData, 'cap_points', 0, 1_000_000) },
  };
  const note = str(formData, 'note', 200);
  if (!note) done('/admin/rules', 'Say why you are changing the rules. It is kept with the version.', true);
  const { data, error } = await db.rpc('publish_rules', { p_config: config, p_actor: actor.id, p_note: note });
  if (error) done('/admin/rules', error.message.replace(/^.*bad_rules: ?/, 'Not published: '), true);
  await audit(actor.id, 'rules_published', String(data), { config, note });
  done('/admin/rules', `Rules ${data} are now live.`);
}

/** Switches back to an earlier version of the rules. */
export async function activateRules(formData: FormData) {
  const actor = await requireAdmin();
  const version = str(formData, 'version', 60);
  if (!version) return;
  const { error } = await createAdminClient().rpc('activate_rules', { p_version: version });
  if (error) done('/admin/rules', error.message.replace(/^.*bad_rules: ?/, 'Not switched: '), true);
  await audit(actor.id, 'rules_activated', version);
  done('/admin/rules', `Switched back to ${version}.`);
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

/** Changes an item's name, description, price, level lock or availability. Owners keep what they bought. */
export async function updateShopItem(formData: FormData) {
  const actor = await requireAdmin();
  const id = str(formData, 'id');
  if (!id) return;
  const name = str(formData, 'name', 60), description = str(formData, 'description', 240);
  if (!name || !description) done('/admin/shop', 'An item needs a name and a description.', true);
  const patch = { name, description, price_coins: int(formData, 'price', 1, 1_000_000, 100), min_level: int(formData, 'min_level', 1, 50, 1), active: formData.get('active') === 'on' };
  await createAdminClient().from('shop_items').update(patch).eq('id', id);
  await audit(actor.id, 'shop_item_updated', id, patch);
  done('/admin/shop', 'Item updated.');
}

/** Adds an item. Boosts are built from a kind, so the effect can only be one the games understand. */
export async function createShopItem(formData: FormData) {
  const actor = await requireAdmin();
  const name = str(formData, 'name', 60);
  const description = str(formData, 'description', 240);
  const game = str(formData, 'game');
  const boost = str(formData, 'boost');
  let category = str(formData, 'category');
  let consumable = formData.get('consumable') === 'on';
  let effect: Record<string, unknown> = {};

  if (!name || !description) done('/admin/shop', 'An item needs a name and a description.', true);
  if (!['beat_lanes', 'block_drop', 'type_sprint', 'market_detective', 'all'].includes(game)) done('/admin/shop', 'Pick a game.', true);

  if (boost) {
    const allowed = game !== 'all' ? (GAME_BOOSTS[game as keyof typeof GAME_BOOSTS] as BoostKind[]) : [];
    if (!allowed.includes(boost as BoostKind)) done('/admin/shop', 'That boost does not exist for that game.', true);
    category = 'bonus'; consumable = true; effect = { type: 'boost', kind: boost };
  } else {
    if (!['skin', 'sound', 'bonus'].includes(category)) done('/admin/shop', 'Pick a category, or choose a boost.', true);
    try {
      const parsed = JSON.parse(str(formData, 'effect', 1000) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      effect = parsed;
    } catch { done('/admin/shop', 'The effect must be a JSON object, for example {"theme": "emerald"}.', true); }
  }

  const { error } = await createAdminClient().from('shop_items').insert({
    slug: `${slugify(name)}-${randomUUID().slice(0, 5)}`, name, description, category, game,
    price_coins: int(formData, 'price', 1, 1_000_000, 100), effect, consumable, min_level: int(formData, 'min_level', 1, 50, 1), active: true, sort_order: 200,
  });
  if (error) done('/admin/shop', `Could not add the item: ${error.message}`, true);
  await audit(actor.id, 'shop_item_created', name, { game, category, boost: boost || null });
  done('/admin/shop', `"${name}" added to the shop.`);
}
