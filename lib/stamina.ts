/**
 * Mirrors the lazy refill in start_game_run() so pages can show the current
 * stamina without writing to the database. The database is the authority.
 */
export interface StaminaRow { stamina: number; updated_at: string }
export interface StaminaRules { stamina_cap: number; stamina_refill_seconds: number }

export function currentStamina(row: StaminaRow, rules: StaminaRules, now: Date = new Date()) {
  const cap = rules.stamina_cap;
  const refill = rules.stamina_refill_seconds;
  const elapsed = Math.max(0, (now.getTime() - new Date(row.updated_at).getTime()) / 1000);
  const gained = Math.floor(elapsed / refill);
  if (row.stamina + gained >= cap) return { value: cap, secondsToNext: 0 };
  const value = row.stamina + gained;
  return { value, secondsToNext: Math.ceil(refill - (elapsed - gained * refill)) };
}
