/**
 * duel.ts — 황야의 퀵드로우 규칙 (순수 로직, 렌더와 무관)
 * -------------------------------------------------------------
 * 결투 한 판 =
 *   신호판이 빨강 → (랜덤 대기) → 초록
 *   → 더 빨리 뽑은 쪽이 쏜다 → 상대 HP -1
 *   → HP 0 이 되면 사망(패배)
 *
 * 반응은 ms 정수로 비교한다. 1ms 까지 같으면 Tie (HP 변화 없이 다음 라운드).
 *
 * 부정출발(신호 전에 뽑기) 패널티 — "경고 누적":
 *   1회차: 라운드 무효. 상대는 무피해. 총알은 발밑 땅에 박힌다. 경고 1개 적립.
 *   2회차: 경고가 차서 자기 발을 쏜다 → 본인 HP -1, 경고 리셋.
 *  이렇게 두 단계로 나눈 이유: 폰 흔들기 입력은 손떨림/부딪힘으로 오작동하기 쉬운데,
 *  한 번의 오작동이 곧바로 체력 1/3(=3발 중 1발)을 날리면 억울하다.
 *  반대로 완전 무료면 긴장이 사라지므로, 경고는 매치 내내 누적된다.
 *  (신호 전에는 아무 정보도 없으므로 "불리한 라운드를 파울로 회피"하는 악용은 불가능)
 */

/** 결투에서 버틸 수 있는 총알 수 (3발 맞으면 사망) */
export const MAX_HP = 3
/** 이 횟수째 부정출발에서 경고가 차서 자기 발을 쏜다 */
export const MAX_FOULS = 2
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

/* ============================================================
   라운드 판정 — 순수 함수 (렌더/네트워크와 무관, 테스트 가능)
   ============================================================ */

/** 판정에 들어가는 입력 */
export interface RoundInput {
  ms1: Ms
  ms2: Ms
  /** 신호 전에 뽑은 쪽 (0 = 없음) */
  foul: 0 | 1 | 2
  hp1: number
  hp2: number
  /** 지금까지 쌓인 경고 */
  fouls1: number
  fouls2: number
}

/**
 * 라운드 성격
 *  - shot      : 정상 승부 — 더 빠른 쪽이 상대를 쐈다
 *  - tie       : 1ms 까지 동일 (또는 둘 다 실패) — 아무 변화 없음
 *  - warning   : 부정출발 1회차 — 라운드 무효 + 경고 적립
 *  - self-shot : 부정출발로 경고가 차서 자기 발을 쐈다 — 본인 HP -1
 */
export type RoundKind = 'shot' | 'tie' | 'warning' | 'self-shot'

/** 판정 결과 */
export interface RoundOutcome {
  kind: RoundKind
  winner: 0 | 1 | 2 // 상대를 쏜 쪽 (파울 라운드에서는 0 — 상대는 총을 뽑지도 않았다)
  tie: boolean
  hitSide: 0 | 1 | 2 // HP 를 잃는 쪽 (self-shot 이면 파울한 본인)
  koSide: 0 | 1 | 2 // 쓰러지는 쪽
  over: boolean
  hp1: number // 판정 후 HP
  hp2: number
  fouls1: number // 판정 후 경고 (한도에 닿아 소진되면 0)
  fouls2: number
  foulSide: 0 | 1 | 2 // 부정출발한 쪽
}

/**
 * 결투 한 라운드 판정.
 *  - 부정출발: 상대는 무피해. 경고를 쌓고 MAX_FOULS 째에 자기 발을 쏜다.
 *  - 정상: 더 빠른 쪽이 상대를 쏜다. 1ms 까지 같으면 Tie (HP 변화 없음).
 */
export function resolveRound(input: RoundInput): RoundOutcome {
  const { ms1, ms2, foul } = input
  let { hp1, hp2, fouls1, fouls2 } = input

  // ── 부정출발 ──────────────────────────────────────────────
  if (foul !== 0) {
    const count = (foul === 1 ? fouls1 : fouls2) + 1
    const cashed = count >= MAX_FOULS // 경고가 찼다 → 자기 발
    const left = cashed ? 0 : count
    if (foul === 1) fouls1 = left
    else fouls2 = left

    let hitSide: 0 | 1 | 2 = 0
    let koSide: 0 | 1 | 2 = 0
    let over = false
    if (cashed) {
      hitSide = foul
      if (foul === 1) hp1 = Math.max(0, hp1 - 1)
      else hp2 = Math.max(0, hp2 - 1)
      if ((foul === 1 ? hp1 : hp2) <= 0) {
        koSide = foul
        over = true
      }
    }
    return {
      kind: cashed ? 'self-shot' : 'warning',
      winner: 0,
      tie: false,
      hitSide,
      koSide,
      over,
      hp1,
      hp2,
      fouls1,
      fouls2,
      foulSide: foul,
    }
  }

  // ── 정상 승부 ─────────────────────────────────────────────
  const winner = compareDraw(ms1, ms2)
  const tie = winner === 0
  let hitSide: 0 | 1 | 2 = 0
  let koSide: 0 | 1 | 2 = 0
  let over = false

  if (!tie) {
    hitSide = winner === 1 ? 2 : 1
    if (hitSide === 1) hp1 = Math.max(0, hp1 - 1)
    else hp2 = Math.max(0, hp2 - 1)
    if ((hitSide === 1 ? hp1 : hp2) <= 0) {
      koSide = hitSide
      over = true
    }
  }

  return {
    kind: tie ? 'tie' : 'shot',
    winner,
    tie,
    hitSide,
    koSide,
    over,
    hp1,
    hp2,
    fouls1,
    fouls2,
    foulSide: 0,
  }
}
