/**
 * duel.ts — 황야의 퀵드로우 규칙 (순수 로직, 렌더와 무관)
 * -------------------------------------------------------------
 * 결투 한 판 =
 *   신호판이 빨강 → (랜덤 대기) → 초록
 *   → 더 빨리 뽑은 쪽이 쏜다 → 상대 HP -1
 *   → HP 0 이 되면 사망(패배)
 *
 * 반응은 ms 정수로 비교한다. 1ms 까지 같으면 Tie (HP 변화 없이 다음 라운드).
 */

/** 결투에서 버틸 수 있는 총알 수 (3발 맞으면 사망) */
export const MAX_HP = 3
/** 혼자(기록 도전) 라운드 수 */
export const SOLO_ROUNDS = 5

/** 신호(초록)까지의 랜덤 대기 — 예측 못 하게 넉넉한 폭 */
export const MIN_WAIT = 1400
export const MAX_WAIT = 4600

/**
 * 반응 시간 센티넬 — 실제 ms 는 0 이상.
 *  FOUL: 신호 전에 뽑음(부정출발) · MISS: 신호 후에도 못 뽑음(얼어붙음)
 *  null: 아직 결과가 안 들어옴
 */
export const FOUL = -1
export const MISS = -2
export type Ms = number | null

/** 한쪽이 먼저 뽑은 뒤, 상대가 뽑을 수 있는 마지막 유예 시간 */
export const GRACE_MS = 700
/** 신호 후 아무도 안 뽑으면 라운드 무효(둘 다 얼어붙음) */
export const FREEZE_MS = 2600

/** ── 연출 타이밍 (Arena 의 CSS 애니메이션과 맞춰야 함) ── */
export const BULLET_MS = 340 // 총알이 상대에게 닿는 시간
export const RESULT_MS = 2150 // 일반 라운드 결과를 보여주는 총 시간
export const TIE_MS = 1650 // Tie 는 조금 짧게
export const KO_MS = 2900 // 사망(KO) 연출은 길게 보여준다

/** 다음 신호까지 기다릴 시간 */
export function randomWait(): number {
  return MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT)
}

/** 정상적으로 뽑았는가 (부정출발·미반응이 아닌 실제 기록) */
export function isClean(v: Ms): v is number {
  return typeof v === 'number' && v >= 0
}

/**
 * 두 반응을 비교 → 0=Tie · 1=왼쪽 승 · 2=오른쪽 승
 *  - 둘 다 정상: 더 빠른 쪽 승, 1ms 까지 같으면 Tie
 *  - 한쪽만 정상: 정상인 쪽 승 (상대는 부정출발이거나 못 뽑음)
 *  - 둘 다 실패: Tie (둘 다 성급했거나 둘 다 얼어붙음)
 */
export function compareDraw(a: Ms, b: Ms): 0 | 1 | 2 {
  const ca = isClean(a)
  const cb = isClean(b)
  if (ca && cb) return a === b ? 0 : a < b ? 1 : 2
  if (ca) return 1
  if (cb) return 2
  return 0
}

/** 반응 시간 표시 문구 */
export function msLabel(v: Ms): string {
  if (v === FOUL) return '성급했다'
  if (v === MISS || v == null) return '얼어붙음'
  return `${v}ms`
}

/** 총잡이 등급 — 서부 분위기의 칭호 */
export interface Rank {
  title: string
  sub: string
  color: string
}

export function rankOf(ms: number): Rank {
  if (ms < 170) return { title: '유령의 손', sub: '아무도 뽑는 걸 못 봤다', color: '#22d3ee' }
  if (ms < 210) return { title: '번개 리볼버', sub: '전설이 될 손목', color: '#a3e635' }
  if (ms < 260) return { title: '노련한 총잡이', sub: '술집에서 자리 양보받는 실력', color: '#fbbf24' }
  if (ms < 330) return { title: '견습 보안관', sub: '조금 더 연습하면 된다', color: '#fb923c' }
  return { title: '느린 손', sub: '먼저 사과하는 게 낫겠다', color: '#f87171' }
}

/** 라운드 결과 한 줄 헤드라인 (승자 관점) */
export function headline(tie: boolean, foul: boolean, ko: boolean): string {
  if (tie) return 'TIE'
  if (ko) return 'K.O.'
  if (foul) return '성급했다!'
  return 'HIT!'
}
