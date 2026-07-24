/**
 * engine.ts — 슬래셔의 "순수 로직" (물리 · 스폰 · 충돌 · 슬라이스 · 점수)
 * -------------------------------------------------------------
 * React·캔버스에 의존하지 않는 계산만 모은다. 게임 루프(rAF)와 렌더는
 * StackSlasher.tsx 가 소유하고, 여기 함수들을 호출해 오브젝트를 굴린다.
 * (그림 없음 → 눈 없이도 테스트 가능)
 */
import {
  GRAVITY_K,
  LAUNCH_VX,
  LAUNCH_VY_MAX,
  LAUNCH_VY_MIN,
  type GameObject,
  type ObjectKind,
  type Piece,
  type Spark,
} from './types'
import { STACKS, TRAPS, BONUSES } from './stacks'

/** 화면 높이에 비례한 중력 (px/s^2) */
export const gravity = (H: number) => GRAVITY_K * H

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// ── 물리 스텝 (dt = 초) ──────────────────────────────────────
export function stepObject(o: GameObject, dt: number, g: number) {
  o.vy += g * dt
  o.x += o.vx * dt
  o.y += o.vy * dt
  o.rot += o.vrot * dt
}

export function stepPiece(p: Piece, dt: number, g: number) {
  p.vy += g * dt
  p.x += p.vx * dt
  p.y += p.vy * dt
  p.rot += p.vrot * dt
  p.life -= dt / 0.95 // ~0.95초에 걸쳐 페이드
}

export function stepSpark(s: Spark, dt: number, g: number) {
  s.vy += g * 0.5 * dt
  s.x += s.vx * dt
  s.y += s.vy * dt
  s.life -= dt / 0.5
}

/** 판정선 아래로 완전히 떨어졌으면(또는 옆으로 크게 벗어나면) 제거 대상 */
export function isGone(o: GameObject, W: number, H: number) {
  return o.y - o.r > H + 4 || o.x < -o.r * 3 || o.x > W + o.r * 3
}

// ── 스폰 ────────────────────────────────────────────────────
let nextId = 1

/** 스폰 간격(ms): 시작 여유 → 후반 조밀. 피버엔 절반. */
export function spawnInterval(elapsedMs: number, fever: boolean) {
  const t = Math.min(1, elapsedMs / 60_000)
  const base = 980 - t * 430 // 980ms → 550ms
  return (fever ? base * 0.5 : base) * rand(0.82, 1.18)
}

/** 한 번에 던질 개수 (후반·피버에 조금 더) */
export function waveSize(elapsedMs: number, fever: boolean) {
  const t = Math.min(1, elapsedMs / 60_000)
  const r = Math.random()
  if (fever) return r < 0.4 ? 2 : 3
  if (t < 0.25) return r < 0.75 ? 1 : 2
  if (t < 0.6) return r < 0.5 ? 1 : 2
  return r < 0.35 ? 1 : r < 0.85 ? 2 : 3
}

/** 오브젝트 종류 뽑기 (피버엔 함정↓ 보너스↑) */
function pickKind(fever: boolean): ObjectKind {
  const r = Math.random()
  if (fever) return r < 0.82 ? 'stack' : r < 0.9 ? 'bonus' : 'trap'
  return r < 0.76 ? 'stack' : r < 0.92 ? 'trap' : 'bonus'
}

/**
 * 오브젝트 하나 생성. 화면 아래에서 위로 포물선 발사.
 * concurrent 오브젝트가 너무 많으면(>=cap) 호출 안 하는 건 호출부 책임.
 */
export function spawnOne(W: number, H: number, fever: boolean): GameObject {
  const kind = pickKind(fever)
  let defId: string
  let goldenStackId: string | undefined
  if (kind === 'stack') defId = pick(STACKS).id
  else if (kind === 'trap') defId = pick(TRAPS).id
  else {
    defId = pick(BONUSES).id
    if (defId === 'golden') goldenStackId = pick(STACKS).id
  }

  const r = Math.max(26, Math.min(52, Math.min(W, H) * 0.075))
  const x = rand(W * 0.16, W * 0.84)
  const y = H + r
  const vy = -rand(LAUNCH_VY_MIN, LAUNCH_VY_MAX) * H
  // 화면 밖으로 새지 않게 중앙 쪽으로 살짝 밀어줌
  const toCenter = x < W / 2 ? 1 : -1
  const vx = (rand(0, LAUNCH_VX) * toCenter + rand(-0.06, 0.06)) * H
  const vrot = rand(-2.6, 2.6)
  return { id: nextId++, kind, defId, x, y, vx, vy, rot: rand(0, Math.PI * 2), vrot, r, sliced: false, goldenStackId }
}

// ── 충돌: 스와이프 선분 ↔ 오브젝트 원 ────────────────────────
/** 점 C 에서 선분 AB 까지 최단 거리 */
export function pointSegDist(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(cx - ax, cy - ay)
  let t = ((cx - ax) * dx + (cy - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(cx - (ax + t * dx), cy - (ay + t * dy))
}

/** 스와이프 선분이 오브젝트를 베었는가 */
export function segHitsObject(
  ax: number, ay: number, bx: number, by: number, o: GameObject,
): boolean {
  return pointSegDist(ax, ay, bx, by, o.x, o.y) <= o.r
}

// ── 슬라이스: 오브젝트 → 두 파편 ─────────────────────────────
/** 벤 오브젝트를 절단 방향 cutAngle(rad, 스와이프 방향) 기준 두 조각으로 */
export function sliceObject(o: GameObject, cutAngle: number, H: number): [Piece, Piece] {
  const localCut = cutAngle - o.rot
  const nAng = cutAngle + Math.PI / 2 // 절단선 수직(파편이 갈라지는 방향)
  const nx = Math.cos(nAng)
  const ny = Math.sin(nAng)
  const sep = H * 0.11 // 갈라지는 속도
  const along = H * 0.04
  const ax = Math.cos(cutAngle)
  const ay = Math.sin(cutAngle)
  const mk = (side: 1 | -1): Piece => ({
    x: o.x,
    y: o.y,
    vx: o.vx + nx * sep * side + ax * along,
    vy: o.vy + ny * sep * side + ay * along,
    rot: o.rot,
    vrot: o.vrot + side * rand(1.5, 3.5),
    r: o.r,
    kind: o.kind,
    defId: o.defId,
    goldenStackId: o.goldenStackId,
    side,
    localCutAngle: localCut,
    life: 1,
  })
  return [mk(1), mk(-1)]
}

/** 절단 스파크 파티클 생성 */
export function makeSparks(x: number, y: number, color: string, n: number, H: number): Spark[] {
  const out: Spark[] = []
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2)
    const sp = rand(0.08, 0.34) * H
    out.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 1,
      r: rand(1.5, 3.5),
      color,
    })
  }
  return out
}
