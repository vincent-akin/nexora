/** Word list for Type Sprint. Lowercase letters only, so every character is one plain keystroke.
 *  Words are picked by length, so the ladder can lengthen them level by level (see sprintConfig). */
export const ALL_WORDS: readonly string[] = [
  // 4
  'play', 'tile', 'beat', 'card', 'coin', 'gold', 'rank', 'lane', 'note', 'tune', 'swap', 'save', 'earn', 'gain', 'fund', 'bull', 'bear', 'risk', 'safe', 'fast',
  'wave', 'echo', 'jump', 'zone', 'quiz', 'flow', 'grid', 'wins', 'bolt', 'luck', 'move', 'keys', 'dash', 'boost', 'glow',
  // 5
  'vault', 'score', 'level', 'quest', 'point', 'chart', 'trade', 'value', 'asset', 'yield', 'stock', 'price', 'trend', 'clean', 'sharp', 'quick', 'swift', 'focus',
  'smart', 'brave', 'light', 'spark', 'blaze', 'storm', 'flash', 'pulse', 'magic', 'jewel', 'zesty', 'maple', 'crown', 'pixel', 'rocky', 'vivid', 'jolly',
  // 6
  'reward', 'ledger', 'streak', 'combo', 'gaming', 'market', 'growth', 'unlock', 'fusion', 'galaxy', 'jungle', 'wizard', 'frozen', 'rocket', 'puzzle', 'quartz',
  'voltage', 'rhythm', 'melody', 'harbor', 'copper', 'silver', 'bronze', 'cipher', 'thrive', 'wonder', 'zephyr', 'kinetic',
  // 7
  'airdrop', 'balance', 'mission', 'upgrade', 'journey', 'network', 'digital', 'capital', 'finance', 'harvest', 'venture', 'monitor', 'insight', 'compete',
  'victory', 'cascade', 'horizon', 'channel', 'pattern', 'explore', 'collect', 'achieve', 'perform', 'advance', 'support', 'connect', 'protect', 'resolve',
  'deliver', 'quantum', 'jackpot', 'whisper', 'voyager', 'wizardry', 'kingdom', 'phoenix',
  // 8
  'campaign', 'progress', 'champion', 'strategy', 'referral', 'multiply', 'ecosystem', 'platform', 'momentum', 'treasure', 'velocity', 'thunder', 'keyboard',
  'standing', 'explorer', 'fortune', 'vigilant', 'skyscraper', 'quickest', 'adventure', 'backbone', 'crossbow', 'fireball', 'jukebox', 'knockout',
  // 9
  'adventure', 'confidence', 'liquidity', 'volatility', 'tournament', 'mechanism', 'knowledge', 'dynamites', 'excellent', 'invisible', 'lightning', 'mysterious',
  'obstacles', 'paradigm', 'workforce', 'quizzical', 'jeopardize', 'skyrocket', 'xylophone', 'zeppelins', 'blizzards', 'cryptic', 'diamonds', 'wavelength',
  // 10-11
  'leaderboard', 'competitive', 'performance', 'progression', 'recognition', 'integration', 'architecture', 'cryptography', 'multiplayer', 'exceptional',
  'sustainable', 'significantly', 'unstoppable', 'adventurous', 'perseverance', 'transparency', 'participation', 'verification', 'opportunity',
  'tokenization', 'distribution', 'achievement', 'optimization', 'compensation', 'collaboration', 'diversified', 'comprehensive', 'consistently',
  'breakthrough', 'determination', 'championship', 'accelerating', 'infrastructure', 'decentralized', 'extraordinary', 'accumulation',
];

/** Distinct words, lowercase, letters only. */
export const WORD_POOL: readonly string[] = [...new Set(ALL_WORDS)].filter((w) => /^[a-z]+$/.test(w));
