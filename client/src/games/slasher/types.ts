/**
 * types.ts — 기술스택 슬래셔의 공통 타입 & 튜닝 상수
 * -------------------------------------------------------------
 * "무엇이 날아오고(오브젝트), 어떻게 점수가 되고, 60초 안에 무슨 일이 벌어지나"를
 * 한 곳에 모아 둔다. 물리·충돌·스폰 로직은 engine.ts, 그림은 logos.ts,
 * 데이터(스택 목록)는 stacks.ts, 최종 판정은 verdict.ts.
 */

/** 기술 스택 4대 분야 (결과 판정에 쓰인다) */
export type Category = 'FE' | 'BE' | 'Infra' | 'AI'

/** 날아오는 오브젝트의 큰 갈래 */
export type ObjectKind = 'stack' | 'trap' | 'bonus'

/** 함정 3종 / 보너스 2종 식별자 */
export type TrapId = 'bug' | 'bomb' | 'burnout'
export type BonusId = 'golden' | 'coffee'

/**
 * 화면을 날아다니는 오브젝트 하나.
 *  - 좌표/속도는 px, px/s. 회전은 rad, rad/s.
 *  - defId 는 kind 에 따라 stack id / TrapId / BonusId 중 하나.
 */
export interface GameObject {
  id: number // 인스턴스 고유 id
  kind: ObjectKind
  defId: string // 스택 id · 함정 id · 보너스 id
  x: number
  y: number
  vx: number
  vy: number // 위로 발사 → 음수에서 시작해 중력으로 증가
  rot: number
  vrot: number
  r: number // 히트박스 반경 = 그리기 반경
  sliced: boolean // 이미 베였는가(중복 판정 방지)
  /** 보너스 golden 일 때 "어느 스택의 금색 버전"인지 */
  goldenStackId?: string
}

/** 베인 오브젝트가 두 조각으로 갈라진 파편 (각자 물리로 낙하) */
export interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  r: number
  kind: ObjectKind
  defId: string
  goldenStackId?: string
  side: 1 | -1 // 절단선 기준 어느 쪽 반쪽인가
  localCutAngle: number // 오브젝트 로컬 좌표에서의 절단선 각도(rad)
  life: number // 1→0 페이드
}

/** 절단 스파크 파티클 */
export interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number // 1→0
  r: number
  color: string
}

/** 점수/콤보 팝업 텍스트 */
export interface Popup {
  x: number
  y: number
  vy: number
  life: number // 1→0
  text: string
  sub?: string
  color: string
}

export type Phase = 'ready' | 'playing' | 'result'

/** UI(React) 로 노출하는 값만 모아둔 스냅샷 (게임 루프 내부값과 분리) */
export interface HudSnapshot {
  phase: Phase
  score: number
  combo: number
  timeLeftMs: number
  fever: boolean
}

/** 한 판 결과 (결과 화면 · 판정 입력) */
export interface RunResult {
  score: number
  best: number
  /** 벤 스택 카운트 (id → 개수). 컬렉션·판정에 사용 */
  collected: Record<string, number>
  trapsSliced: number
  maxCombo: number
}

// ── 튜닝 상수 ────────────────────────────────────────────────
export const GAME_MS = 60_000 // 60초 타임어택
export const LEAD_IN_MS = 1500 // 시작 버튼 → 첫 스폰까지 (3·2·1)
export const FEVER_MS = 3800 // 커피 피버 지속
export const RUSH_MS = 10_000 // 마지막 10초 긴박 연출 구간

// 점수
export const STACK_SCORE = 10 // 스택 기본 점수
export const TRAP_PENALTY = 20 // 함정 감점(양수로 두고 빼서 씀)
export const GOLDEN_MULT = 3 // 황금 스택 ×3
export const FEVER_MULT = 2 // 피버 중 전 점수 ×2

/** 한 스와이프에 동시에 벤 스택 수 → 점수 배수 (2개 ×1.5 / 3개 ×2 / 4개+ ×3) */
export function swipeMultiplier(n: number): number {
  if (n >= 4) return 3
  if (n === 3) return 2
  if (n === 2) return 1.5
  return 1
}

/** 물리: 중력·발사속도는 화면 높이 H 에 비례시켜 어느 해상도서든 비슷한 궤적 */
export const GRAVITY_K = 0.72 // g = GRAVITY_K * H  (px/s^2) → 체공 ~2.7s
export const LAUNCH_VY_MIN = 0.92 // 발사 상향속도 = k * H (px/s), 범위
export const LAUNCH_VY_MAX = 1.06
export const LAUNCH_VX = 0.22 // 좌우 드리프트 최대 = k * H
