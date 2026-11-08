export const PALETTE = {
  void: '#000000',
  /** 石面基础色（灯光中段）。 */
  floorFill: '#8a6e4e',
  /** 灯光中心的石面。 */
  floorLit: '#d3ac7e',
  /** 灯光边缘的石面。 */
  floorMid: '#6b553d',
  /** 灯光照不到的石面。 */
  floorDark: '#3a2e22',
  /** 地块侧壁：上缘受光、下缘沉入黑暗。 */
  cliffTop: '#8a6a49',
  cliffBottom: '#150f0b',
  /** 外缘暗角。 */
  edgeShade: 'rgba(0, 0, 0, 0.5)',
  /** 只探听到的通路：压暗但仍看得出是块地。 */
  heardFill: '#241c14',
  /** 墙：本体是暗色木石，靠近提灯时才被照亮。 */
  wallLine: '#7a5a3a',
  wallLit: '#f2dcaa',
  wallGlow: 'rgba(255, 214, 150, 0.5)',
  heardStroke: '#4d6f88',
  playerFill: '#f7ecc6',
  playerRing: '#000000',
  exitMark: '#e0b53c',
  glyphQuiet: '#9dc3dd',
  glyphNoisy: '#e0a35c',
  /** 未探明奇遇房门的冷光：迷雾里唯一自发光的几何。 */
  encounterGlow: '#7fc8e8',
  highlight: '#7fd6a3',
  highlightDot: '#e6fff2',
  monster: '#7a6480',
  monsterAlert: '#d9973f',
  monsterChase: '#d25f45',
  intentMove: '#e0b53c',
  intentAttack: '#e88a6c',
  intentSearch: '#9dc3dd',
  intentFrozen: '#9fd8de',
  /** 命中闪光的圆环。 */
  hitRing: '#ffd9a0',
  /** 命中瞬间盖在目标身上的白光。 */
  hitFlash: '#fff3d6',
  /** 血条底槽与填充。 */
  hpBarTrack: 'rgba(0, 0, 0, 0.55)',
  hpBarFill: '#c05a4a',
  /** 远程攻击的弹道。 */
  streak: '#ffe6b0',
  damageNumber: '#ff9273',
  blockNumber: '#9dc3dd',
  healNumber: '#8fdfae',
  buffNumber: '#e0b53c',
} as const;
