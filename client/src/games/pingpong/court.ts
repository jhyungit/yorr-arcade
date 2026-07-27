/**
 * court.ts — 탁구 코트 규격 · 좌표 변환 · 공의 비행 궤적 (순수 로직)
 * -------------------------------------------------------------
 * 3D 렌더러(scene3d)와 게임 로직(PingPong)이 같은 숫자를 보게 하려고
 * 여기 한 곳에 모았다. Three.js 를 import 하지 않으므로 테스트가 쉽다.
 *
 * ── 좌표계 ──
 *  x: 좌우      (-TABLE_W/2 … +TABLE_W/2)
 *  y: 위        (바닥 0, 테이블 면 TABLE_H)
 *  z: 테이블 길이 (먼쪽 P2 = -LEN/2  …  가까운쪽 P1 = +LEN/2, 네트 = 0)
 *
 * 게임 로직은 깊이를 `pos` (0 = P2 끝, 1 = P1 끝) 하나로 다룬다.
 * 이 값은 라켓 위치까지 나가려고 0~1 을 살짝 넘기므로(-0.1 … 1.1)
 * posToZ 는 선형 확장으로 그대로 매핑한다.
 */

/* ── 실제 탁구 규격 (ITTF, 단위 m) ── */
export const TABLE_LEN = 2.74
export const TABLE_W = 1.525
export const TABLE_H = 0.76
export const TABLE_THICK = 0.05
export const NET_H = 0.1525
/** 네트는 양옆으로 15.25cm 씩 튀어나온다 */
export const NET_OVERHANG = 0.1525
export const BALL_R = 0.02

export const FAR_Z = -TABLE_LEN / 2
export const NEAR_Z = TABLE_LEN / 2

/* ── 게임 규칙 상수 (깊이 pos 기준) ──
   0 = P2(먼쪽) 끝 · 1 = P1(가까운쪽) 끝.
   P2 쪽 창은 P1 창을 1에서 뒤집은 값이라, 뷰어 기준 깊이(dv)를 쓰면
   양쪽 모두 아래 P1 상수 하나로 판정할 수 있다. */
export const WIN_SCORE = 11
export const IDEAL1 = 0.9
export const W1_LO = 0.72
export const W1_HI = 1.06
export const MISS1 = 1.1
export const IDEAL2 = 1 - IDEAL1
export const W2_LO = 1 - W1_HI
export const W2_HI = 1 - W1_LO
export const MISS2 = 1 - MISS1
export const PERFECT_D = 0.06
export const GOOD_D = 0.16

/* ── 속도 (pos/sec) ── */
export const NORMAL_SPEED = 1.0
export const SMASH_SPEED = 1.95
export const WEAK_SPEED = 0.82

/** 깊이 pos → 월드 z */
export function posToZ(pos: number): number {
  return FAR_Z + (NEAR_Z - FAR_Z) * pos
}

/** 좌우 0~1 → 월드 x */
export function xToWorld(x: number): number {
  return (x - 0.5) * TABLE_W
}

/* ============================================================
   공의 비행 궤적
   ------------------------------------------------------------
   실제 탁구처럼 "네트를 넘어 받는 쪽 코트에 한 번 튀고" 상대 라켓에 닿는다.
   높이는 이번 타구의 진행도(prog 0…1) 만의 함수라서, 온라인 게스트도
   pos 만 받아 같은 궤적을 그대로 재현한다(별도 동기화 필드 불필요).

   구간 A: 타구 → 테이블 바운스   (2차 함수)
   구간 B: 바운스 → 상대 라켓     (2차 베지에)

   ★ 네트를 지나는 지점은 항상 prog = 0.5 다.
     prog 는 dir>0 이면 pos, dir<0 이면 1-pos 이고 네트는 pos=0.5 이므로
     어느 방향이든 절반에서 네트를 넘는다. 그래서 "네트 통과 높이"를
     파라미터로 직접 잡는다 — 이렇게 안 하면 공이 네트를 뚫고 지나간다.
   ============================================================ */

/** 네트를 지나는 진행도 (위 주석 참고) */
export const NET_CROSS_PROG = 0.5

/** 타구 순간 공 높이 (테이블 면 기준). 직전 타구의 도착 높이와 비슷해야 튀지 않는다. */
const LAUNCH = 0.12
/** 상대 라켓에 닿는 높이 */
const ARRIVE = 0.13

export interface Flight {
  /** 진행도 몇에서 테이블에 튀는가 — 반드시 0.5 보다 커야 한다(받는 쪽 코트) */
  bounceAt: number
  /** 네트를 지날 때의 높이 (테이블 면 기준). NET_H 보다 커야 한다. */
  netClear: number
  /** 구간 B 베지에 제어점 (튄 뒤 솟는 높이) */
  reboundCtrl: number
}

/** 보통 타구: 네트를 약 10cm 여유로 넘는 드라이브 */
const NORMAL_FLIGHT: Flight = { bounceAt: 0.7, netClear: 0.25, reboundCtrl: 0.2 }
/** 스매시: 네트를 겨우 스치듯 넘고 더 일찍·강하게 튄다 */
const SMASH_FLIGHT: Flight = { bounceAt: 0.62, netClear: 0.175, reboundCtrl: 0.13 }

export function flightOf(smash: boolean): Flight {
  return smash ? SMASH_FLIGHT : NORMAL_FLIGHT
}

/**
 * 구간 A 의 2차 계수. 세 조건으로 유일하게 결정된다.
 *   h(0) = LAUNCH · h(0.5) = netClear · h(bounceAt) = 0
 */
function arcA(f: Flight): { a: number; b: number } {
  const B = f.bounceAt
  const d = f.netClear - LAUNCH
  const b = (-LAUNCH - 4 * B * B * d) / (B - 2 * B * B)
  const a = 4 * d - 2 * b
  return { a, b }
}
const A_NORMAL = arcA(NORMAL_FLIGHT)
const A_SMASH = arcA(SMASH_FLIGHT)

/**
 * 테이블 면 기준 공 높이(m). prog = 이번 타구의 진행도 (0 = 방금 침, 1 = 상대 도달)
 * 구간 A 는 위로 볼록한 포물선이라 [0, bounceAt] 에서 항상 0 이상 → 테이블을 뚫지 않는다.
 */
export function ballLift(prog: number, smash: boolean): number {
  const f = flightOf(smash)
  const p = prog < 0 ? 0 : prog > 1 ? 1 : prog
  if (p <= f.bounceAt) {
    const { a, b } = smash ? A_SMASH : A_NORMAL
    const h = a * p * p + b * p + LAUNCH
    return h < 0 ? 0 : h
  }
  // 구간 B: (0,0) → 제어점 reboundCtrl → (1, ARRIVE)
  const span = 1 - f.bounceAt
  const t = span <= 0 ? 1 : (p - f.bounceAt) / span
  const u = 1 - t
  return 2 * t * u * f.reboundCtrl + t * t * ARRIVE
}

/** 공의 월드 높이(y) = 테이블 면 + 궤적 높이 */
export function ballY(prog: number, smash: boolean): number {
  return TABLE_H + ballLift(prog, smash)
}

/**
 * 이번 타구의 진행도. 게임 로직의 x 보간과 같은 식이라 좌우/높이가 항상 맞물린다.
 *  dir > 0 (P1 쪽으로 감) → pos 그대로 · dir < 0 → 뒤집어서
 */
export function flightProgress(pos: number, dir: number): number {
  const v = dir > 0 ? pos : 1 - pos
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 뷰어(1=가까운쪽 P1 시점, 2=먼쪽 P2 시점) 기준 깊이 — 타이밍 링 판정용 */
export function viewerDepth(pos: number, viewer: 1 | 2): number {
  return viewer === 1 ? pos : 1 - pos
}
