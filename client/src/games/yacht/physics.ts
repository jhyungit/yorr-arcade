import * as THREE from 'three'

/**
 * physics.ts — 주사위가 굴러가는 규칙 (순수 계산, 화면과 무관)
 * -------------------------------------------------------------
 * Three.js 의 수학 클래스만 쓰고 렌더러/DOM 은 건드리지 않는다.
 * → 노드에서 그냥 돌려 보며 "판 밖으로 튀어나가진 않는지 / 제때 멈추는지"를
 *   확인할 수 있다. (탁구의 court.ts 와 같은 결)
 *
 * 강체는 필요한 만큼만 직접 구현했다.
 *  - 정육면체는 관성텐서가 등방(I = m·s²/6)이라 스칼라 하나로 끝난다.
 *  - 접촉은 8꼭짓점을 바닥/벽 평면과 비교해 임펄스로 푼다. 마찰까지 넣어야
 *    미끄러지지 않고 "구르는" 모양이 나온다.
 */

/* ── 보드 치수 (월드 단위) ── */
export const DIE = 0.3 // 주사위 한 변
export const H = DIE / 2
export const X_HALF = 1.3 // 펠트 가로 절반
export const Z_HALF = 1.0 // 펠트 세로 절반
export const RAIL_D = 0.44 // 앞쪽 KEEP 레일 깊이
export const PLAY_Z = Z_HALF - RAIL_D // 굴리는 영역의 앞 경계 (보이지 않는 벽이 선다)
export const WALL_H = 0.3 // 테두리 높이 (보이는 나무 테두리)
/* 판 안에 들어온 주사위를 막는 "보이지 않는 높은 벽".
   보이는 테두리는 0.3 뿐이라 그보다 높이 튀면 판 밖으로 날아가 버린다.
   착지 이후 높이를 재 보면 99% 가 0.43 아래, 최대 0.65 이다. 1.0 이면 넉넉히 막으면서
   "벽에 닿는 순간의 높이" 중앙값은 0.17 밖에 안 돼서 허공에서 튕기는 것처럼 보이지 않는다
   (테두리보다 확실히 높은 데서 벽에 닿는 경우가 전체 벽 접촉의 0.3%). */
export const WALL_H_IN = 1.0
export const RIM = 0.16 // 나무 테두리 두께
export const KEEP_Z = Z_HALF - RAIL_D / 2 // 고정된 주사위가 놓이는 줄
export const KEEP_GAP = 0.42 // 고정 슬롯 간격
export const FLAT = H * 1.45 // 눕힌 주사위의 실효 반지름 (대각선 포함)

/* ── 손맛 상수 (여기만 만지면 굴러가는 느낌이 바뀐다) ──
   이 파일은 노드에서 그냥 돌려 볼 수 있으니, 느낌을 눈대중으로 맞추지 말고 재서 맞춘다.
   500판을 돌려 본 기준값:

                     구르는시간  이동거리  반대쪽벽  초반회전  회전상한   판밖이탈
     ① 처음            1.08초     1.43     거의못감   11.3     없음(100)   있었음
     ② 너무 굴린 판     1.59초     2.63     96%       19.9     40          있었음
     ③ 지금(①②중간)    1.52초     2.58     83%       15.5     24          0%

   배운 것 세 가지:
   1) "던지자마자 멈춘다" 의 원인은 던지는 세기가 아니라 감쇠였다 (LIN/ANG_DAMP).
   2) 회전 체감은 최고 회전수가 아니라 "초반 0.6초의 평균 회전" 이 정한다.
      ①은 순간 100rad/s 까지 튀지만 감쇠가 세서 금방 죽어 오히려 느리게 느껴졌다.
      그리고 초반 구간은 대부분 상한에 붙어 있으므로 체감은 MAX_W 가 지배한다
      (ANG_DAMP 를 0.62→1.1 로 올려도 초반회전은 15.5→14.9 밖에 안 변한다).
   3) 이동 감쇠와 회전 감쇠를 따로 두면 "오래 굴러가되 팽이처럼은 안 돌게" 를 맞출 수 있다.
   판 가로가 2.6 이므로 이동거리 2.58 은 "한 번 건너가서 되튀는" 정도.
   구름비율(|w|·H/|v|) 은 0.90 으로 미끄러지지 않고 제대로 굴러간다(1 이면 무슬립). */
export const STEP = 1 / 120 // 고정 시간 간격
export const MAX_SIM = 3.2 // 아무리 늦어도 여기서 끊고 안착시킨다 (초)
const G = 18.5 // 중력 — 실제보다 낮게. 체공이 길어 굴러가는 게 눈에 읽힌다
const E_FLOOR = 0.4 // 펠트 반발 (천이라 잘 안 튄다) — 높이면 붕붕 떠서 가짜 같다
const E_WALL = 0.56 // 나무 벽 반발 — 되튀어야 판을 왕복한다
const REST_SPEED = 0.7 // 이보다 느리게 닿으면 반발 없음 (미세하게 계속 튀는 것 방지)
const MU = 0.52 // 마찰 — 높이면 미끄러지는 대신 굴러 넘어간다(모서리 텀블)
/* 감쇠는 "공기저항" 이라기보다 연출용 브레이크다. 세게 걸면 한 번 튀고 죽는다.
   이동(LIN)과 회전(ANG)을 따로 두는 게 요점: "오래 굴러가되 팽이처럼 돌지는 않게"
   하려면 이동 감쇠는 낮게 유지하고 회전 감쇠만 올려야 한다.
   회전은 1.2(너무 빨리 죽어 안 구르는 느낌) ↔ 0.22(너무 팽팽 돎) 의 가운데. */
const LIN_DAMP = 0.08
const ANG_DAMP = 0.62
const INV_I = 6 / (DIE * DIE) // 정육면체 관성 역수 (질량 1, 축 무관)
const SLEEP_V = 0.085
const SLEEP_W = 0.42 // 눈에 보이게 돌고 있는데 잠들면 "덜 굴렀다" 는 느낌이 된다
const SLEEP_HOLD = 0.16 // 이만큼 조용하면 잠든 것으로 본다
/* 회전 상한. 상한이 없으면 충돌 직후 순간적으로 95rad/s(15회전/초)까지 뛰는데,
   60fps 에서 한 프레임에 90° 넘게 돌면 눈에는 회전이 아니라 깜빡임으로 보인다.
   24 = 3.8회전/초 ≈ 한 프레임 23°. 빠르지만 어느 면이 오는지 눈으로 따라갈 수 있다. */
const MAX_W = 24

/* 바닥에 눕고 나서의 추가 감쇠 — 없으면 영원히 제자리에서 돈다.
   꼭짓점 임펄스를 순서대로 풀다 보면 (중심이 조금씩 밀리므로) 네 꼭짓점의
   회전 기여가 정확히 상쇄되지 않고, 매 스텝 조금씩 회전을 밀어 넣는다.
   그 펌핑이 일반 감쇠와 평형을 이뤄 ω≈3rad/s 로 계속 도는 한계주기가 생긴다.
   → "세 꼭짓점 이상이 바닥에 닿아 있고 거의 안 움직이면" 강하게 붙잡는다. */
const REST_CONTACTS = 3
const REST_V = 0.45 // 여기까지 느려지기 전엔 안 잡는다 (마지막 미끄러짐을 살린다)
const REST_DAMP = 0.94 // 0.86 은 0.1초만에 딱 멈춰 버렸다. 부드럽게 잦아들도록 완화
const CONTACT_EPS = 0.004 // 이만큼 바닥에 붙어 있으면 닿은 것으로 센다

/* ── 눈 배치: BoxGeometry 재질 순서(+x,-x,+y,-y,+z,-z) 와 1:1. 마주보는 합 = 7 ── */
export const FACES: { value: number; normal: THREE.Vector3 }[] = [
  { value: 1, normal: new THREE.Vector3(1, 0, 0) },
  { value: 6, normal: new THREE.Vector3(-1, 0, 0) },
  { value: 2, normal: new THREE.Vector3(0, 1, 0) },
  { value: 5, normal: new THREE.Vector3(0, -1, 0) },
  { value: 3, normal: new THREE.Vector3(0, 0, 1) },
  { value: 4, normal: new THREE.Vector3(0, 0, -1) },
]
export const UP = new THREE.Vector3(0, 1, 0)

/** 그 눈이 하늘을 보게 하는 기본 자세 (여기에 yaw 를 곱해 쓴다) */
export const QBASE: Record<number, THREE.Quaternion> = {}
for (const f of FACES) QBASE[f.value] = new THREE.Quaternion().setFromUnitVectors(f.normal, UP)

export const rand = (a: number, b: number) => a + Math.random() * (b - a)
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

/* ── 벽 안쪽을 향하는 법선 ── */
const N_LEFT = new THREE.Vector3(-1, 0, 0)
const N_RIGHT = new THREE.Vector3(1, 0, 0)
const N_BACK = new THREE.Vector3(0, 0, -1)
const N_FRONT = new THREE.Vector3(0, 0, 1)

/** 굴러다니는 주사위 한 알의 물리 상태 */
export interface Body {
  p: THREE.Vector3 // 중심
  v: THREE.Vector3
  q: THREE.Quaternion
  w: THREE.Vector3 // 각속도
  active: boolean // 지금 물리를 받는가 (고정된 주사위는 false)
  asleep: boolean
  sleepT: number
  /** 판 안으로 들어왔는가 — 들어온 뒤엔 높은 벽으로 막아 다시 못 나가게 한다.
   *  (들어오는 순간엔 오른쪽 테두리 위를 넘어야 하므로 벽이 낮아야 한다) */
  inside: boolean
}

export function makeBody(): Body {
  return {
    p: new THREE.Vector3(0, H, 0),
    v: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    w: new THREE.Vector3(),
    active: false,
    asleep: true,
    sleepT: 0,
    inside: false,
  }
}

/**
 * k 번째(총 n 개) 주사위를 판 안으로 던져 넣는다.
 * 오른쪽 테두리 너머에서 컵을 기울여 쏟는 궤적.
 *  - 깊이(z)로 흩어 놓아야 다섯 개가 줄줄이 들어오는 모양이 된다.
 *  - x 로 멀리 떼면 벽에 닿기 전에 바닥까지 떨어져 버리므로 조금만 뗀다.
 */
export function throwInto(b: Body, k: number, n: number) {
  const spread = n > 1 ? (k / (n - 1)) * 2 - 1 : 0 // -1 ~ 1
  b.p.set(X_HALF + 0.24 + k * 0.05, rand(0.56, 0.72), spread * 0.42 + rand(-0.06, 0.06))
  // 판 가로(2.6)를 한 번 건너갈 만큼은 세게, 테두리를 넘어 날아갈 만큼은 아니게.
  // 위로(+y) 주는 성분을 줄인 것도 정점을 낮추려는 것 (테두리가 0.3 뿐이다)
  b.v.set(rand(-6.2, -5.4), rand(0.1, 0.3), rand(-0.45, 0.45) - spread * 0.55)
  // 초기 회전도 ±22/±19/-30~-13 은 너무 팽팽했다 → 옛 값(±16/±14/-22~-9)과의 가운데
  b.w.set(rand(-19, 19), rand(-16, 16), rand(-26, -11))
  b.q.set(Math.random(), Math.random(), Math.random(), Math.random()).normalize()
  b.active = true
  b.asleep = false
  b.sleepT = 0
  b.inside = false // 아직 테두리 밖 — 넘어 들어오는 중
}

/* 매 스텝 재사용하는 임시값 — 서로 덮어쓰면 조용히 틀린 물리가 되므로 용도를 고정한다 */
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const vp = new THREE.Vector3() // 접촉점 속도
const vt = new THREE.Vector3() // 접선
const rxn = new THREE.Vector3() // r × n
const corr = new THREE.Vector3() // 위치 보정
const dq = new THREE.Quaternion()
const corners: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3())
const CORNER_LOCAL: THREE.Vector3[] = []
for (const sx of [-1, 1])
  for (const sy of [-1, 1])
    for (const sz of [-1, 1]) CORNER_LOCAL.push(new THREE.Vector3(sx * H, sy * H, sz * H))

/* 접촉 목록 (한 꼭짓점이 바닥과 벽에 동시에 닿을 수 있어 넉넉히) */
const MAXC = 24
const ITER = 8 // 접촉 반복 횟수
const cN: THREE.Vector3[] = Array.from({ length: MAXC }, () => new THREE.Vector3())
const cR: THREE.Vector3[] = Array.from({ length: MAXC }, () => new THREE.Vector3())
const cPen = new Float64Array(MAXC)
const cTarget = new Float64Array(MAXC) // 이 접촉이 도달해야 할 법선 속도 (반발 포함)
const cDenom = new Float64Array(MAXC)
const cAcc = new Float64Array(MAXC) // 지금까지 넣은 법선 임펄스 누적
let nc = 0

function addContact(b: Body, n: THREE.Vector3, pen: number, e: number, r: THREE.Vector3) {
  if (nc >= MAXC) return
  vp.copy(b.v).add(tmpB.crossVectors(b.w, r))
  const vn0 = vp.dot(n)
  cN[nc].copy(n)
  cR[nc].copy(r)
  cPen[nc] = pen
  // 살살 닿는 접촉까지 튕기면 영원히 미세하게 떨린다 → 임계 아래는 반발 0
  cTarget[nc] = vn0 < -REST_SPEED ? -e * vn0 : 0
  rxn.crossVectors(r, n)
  cDenom[nc] = 1 + INV_I * rxn.lengthSq()
  cAcc[nc] = 0
  nc++
  const s = clamp(-vn0 / 5, 0, 1)
  if (s > impact) impact = s
}

let impact = 0 // 이번 스텝에서 가장 센 충돌 (0~1)

/**
 * 모아 둔 접촉을 반복해서 푼다 (sequential impulses)
 * -------------------------------------------------------------
 * 한 번만 훑으면 접촉끼리 서로를 모른 채 각자 몸 전체를 멈추려 들어서,
 * 바닥에 납작 누운 주사위에 매 스텝 회전이 조금씩 주입된다. 그 잔차가
 * 감쇠와 평형을 이루면 "제자리에서 영원히 도는" 한계주기가 된다.
 * 여러 번 돌리면 모든 접촉의 법선 속도가 함께 0으로 수렴해 그 잔차가 사라진다.
 *  - 누적 임펄스를 0 아래로 못 내려가게 막아야(clamp) 접촉이 몸을 "잡아당기지" 않는다.
 *  - 마찰 한계는 그 시점까지 쌓인 법선 임펄스 기준(쿨롱 마찰).
 */
function solveContacts(b: Body) {
  if (nc === 0) return

  // 파고든 만큼 밀어내기 — 축별 최대치만 (접촉마다 더하면 튀어 오른다)
  corr.set(0, 0, 0)
  for (let k = 0; k < nc; k++) {
    const px = cN[k].x * cPen[k] * 0.92
    const py = cN[k].y * cPen[k] * 0.92
    const pz = cN[k].z * cPen[k] * 0.92
    if (Math.abs(px) > Math.abs(corr.x)) corr.x = px
    if (Math.abs(py) > Math.abs(corr.y)) corr.y = py
    if (Math.abs(pz) > Math.abs(corr.z)) corr.z = pz
  }
  b.p.add(corr)

  for (let it = 0; it < ITER; it++) {
    for (let k = 0; k < nc; k++) {
      const n = cN[k]
      const r = cR[k]

      // 법선 — 목표 속도까지 밀어 올린다
      vp.copy(b.v).add(tmpB.crossVectors(b.w, r))
      const vn = vp.dot(n)
      let j = (cTarget[k] - vn) / cDenom[k]
      const prev = cAcc[k]
      cAcc[k] = Math.max(0, prev + j)
      j = cAcc[k] - prev
      if (j !== 0) {
        b.v.addScaledVector(n, j)
        b.w.addScaledVector(rxn.crossVectors(r, n), j * INV_I)
      }

      // 마찰 — 접선 방향을 붙잡는다. 이게 있어야 미끄러지지 않고 "구른다"
      if (cAcc[k] <= 0) continue
      vp.copy(b.v).add(tmpB.crossVectors(b.w, r))
      vt.copy(vp).addScaledVector(n, -vp.dot(n))
      const vtLen = vt.length()
      if (vtLen < 1e-5) continue
      vt.multiplyScalar(1 / vtLen)
      rxn.crossVectors(r, vt)
      const jt = clamp(-vtLen / (1 + INV_I * rxn.lengthSq()), -MU * cAcc[k], MU * cAcc[k])
      b.v.addScaledVector(vt, jt)
      b.w.addScaledVector(rxn, jt * INV_I)
    }
  }
}

/**
 * 고정 간격 한 스텝. 반환값은 이번 스텝에서 가장 센 충돌 세기(0~1) — 소리에 쓴다.
 * active 인 몸만 움직인다.
 */
export function stepBodies(bodies: Body[], dt: number): number {
  impact = 0

  for (const b of bodies) {
    if (!b.active || b.asleep) continue

    b.v.y -= G * dt
    b.v.multiplyScalar(Math.max(0, 1 - LIN_DAMP * dt))
    b.w.multiplyScalar(Math.max(0, 1 - ANG_DAMP * dt))
    b.p.addScaledVector(b.v, dt)

    // 자세 적분: dq/dt = ½·ω·q
    dq.set(b.w.x * dt * 0.5, b.w.y * dt * 0.5, b.w.z * dt * 0.5, 0).multiply(b.q)
    b.q.set(b.q.x + dq.x, b.q.y + dq.y, b.q.z + dq.z, b.q.w + dq.w).normalize()

    /* 판 안에 완전히 들어왔으면 표시해 둔다 — 이 뒤로는 높은 벽이 선다.
       이게 없으면 세게 던진 주사위가 테두리(0.3)보다 높이 튀어올라 판 밖으로
       날아갔다가 다시 떨어져 들어온다. 물리적으로는 맞지만 보기에는 "맵을 뚫었다". */
    if (
      !b.inside &&
      Math.abs(b.p.x) < X_HALF - H &&
      b.p.z < PLAY_Z - H &&
      b.p.z > -Z_HALF + H
    ) {
      b.inside = true
    }
    const wallTop = b.inside ? WALL_H_IN : WALL_H

    // 꼭짓점 8개로 바닥·벽 접촉을 모아 한 번에 푼다
    for (let i = 0; i < 8; i++) corners[i].copy(CORNER_LOCAL[i]).applyQuaternion(b.q)
    let support = 0
    nc = 0
    for (let i = 0; i < 8; i++) {
      const r = corners[i] // 중심 → 꼭짓점
      const y = b.p.y + r.y
      if (y < CONTACT_EPS) support++
      if (y < 0) addContact(b, UP, -y, E_FLOOR, r)
      if (y > wallTop) continue // 벽보다 높으면 넘어 들어오는 중
      const x = b.p.x + r.x
      if (x > X_HALF) addContact(b, N_LEFT, x - X_HALF, E_WALL, r)
      else if (x < -X_HALF) addContact(b, N_RIGHT, -X_HALF - x, E_WALL, r)
      const z = b.p.z + r.z
      if (z > PLAY_Z) addContact(b, N_BACK, z - PLAY_Z, E_WALL, r)
      else if (z < -Z_HALF) addContact(b, N_FRONT, -Z_HALF - z, E_WALL, r)
    }
    solveContacts(b)

    // 다 눕고 거의 안 움직이면 강하게 붙잡는다 (제자리 회전 한계주기 차단)
    if (support >= REST_CONTACTS && b.v.lengthSq() < REST_V * REST_V) {
      b.v.multiplyScalar(REST_DAMP)
      b.w.multiplyScalar(REST_DAMP)
    }

    if (b.v.lengthSq() < SLEEP_V * SLEEP_V && b.w.lengthSq() < SLEEP_W * SLEEP_W) {
      b.sleepT += dt
      if (b.sleepT > SLEEP_HOLD) {
        b.asleep = true
        b.v.set(0, 0, 0)
        b.w.set(0, 0, 0)
      }
    } else {
      b.sleepT = 0
    }
  }

  // 주사위끼리 — 구로 근사해 밀치고 회전을 조금 나눠 준다 (딸그락거리는 맛)
  const R = H * 1.14
  for (let a = 0; a < bodies.length; a++) {
    const ba = bodies[a]
    if (!ba.active) continue
    for (let c = a + 1; c < bodies.length; c++) {
      const bb = bodies[c]
      if (!bb.active) continue
      tmpA.subVectors(bb.p, ba.p)
      const dist = tmpA.length()
      if (dist > R * 2 || dist < 1e-5) continue
      tmpA.multiplyScalar(1 / dist)
      const pen = R * 2 - dist
      ba.p.addScaledVector(tmpA, -pen * 0.5)
      bb.p.addScaledVector(tmpA, pen * 0.5)
      tmpB.subVectors(bb.v, ba.v)
      const rel = tmpB.dot(tmpA)
      if (rel < 0) {
        const j = -(1 + 0.34) * rel * 0.5
        ba.v.addScaledVector(tmpA, -j)
        bb.v.addScaledVector(tmpA, j)
        // 스치면서 서로를 돌린다 — 접선 성분(n × vrel)으로. 난수를 쓰면 안 된다:
        // roll() 이 "미리 한 번 굴려 보고 똑같이 다시 굴리는" 방식이라 결정론이 필요하다.
        rxn.crossVectors(tmpA, tmpB)
        ba.w.addScaledVector(rxn, -j * 2.2)
        bb.w.addScaledVector(rxn, j * 2.2)
        ba.asleep = bb.asleep = false
        ba.sleepT = bb.sleepT = 0
        const s = clamp(-rel / 4, 0, 1)
        if (s > impact) impact = s
      }
    }
  }

  /* 회전 상한은 맨 마지막에 한 번만. 위 주사위끼리 충돌이 회전을 더 얹기 때문에
     몸별 루프 안에서 자르면 그게 다시 넘어간다 (측정: 40 상한인데 83까지 나왔다). */
  for (const b of bodies) {
    if (!b.active || b.asleep) continue
    const wl = b.w.length()
    if (wl > MAX_W) b.w.multiplyScalar(MAX_W / wl)
  }

  return impact
}

/* ============================================================
   굴리기 한 판 — 미리 굴려 보고, 똑같이 다시 굴린다
   ------------------------------------------------------------
   나올 눈은 이미 정해져 있는데 물리는 그걸 모른다. 다 구른 뒤에 억지로
   돌려 맞추면(90°~180°) 그 스냅이 눈에 보인다. 그래서 순서를 뒤집는다.

     1) 화면에 그리지 않고 끝까지 한 번 굴려 본다 → 어떤 자세로 멈추는지 안다
     2) 그 자세에서 목표 눈이 위로 오도록 "라벨 회전" S 를 고른다
     3) 되감아서 진짜로 굴린다. 렌더링만 q·S 로 한다.

   정육면체는 S(90° 회전들)에 대해 자기 자신이라, S 를 곱해도 충돌 모양이
   똑같다 → 궤적이 조금도 달라지지 않는다. 눈만 바뀐다. 스냅 0.
   그래서 stepBodies 안에는 난수가 하나도 없어야 한다.
   ============================================================ */

/** 정육면체를 자기 자신으로 보내는 24가지 회전 */
export const SYMMETRIES: THREE.Quaternion[] = (() => {
  const out: THREE.Quaternion[] = []
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
  const qa = new THREE.Quaternion()
  const qb = new THREE.Quaternion()
  const qc = new THREE.Quaternion()
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++)
      for (let c = 0; c < 4; c++) {
        qa.setFromAxisAngle(axes[0], (a * Math.PI) / 2)
        qb.setFromAxisAngle(axes[1], (b * Math.PI) / 2)
        qc.setFromAxisAngle(axes[2], (c * Math.PI) / 2)
        const q = qa.clone().multiply(qb).multiply(qc)
        if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w) // 같은 회전의 두 표현을 하나로
        if (!out.some((o) => o.angleTo(q) < 1e-6)) out.push(q)
      }
  return out
})()

const labelTmp = new THREE.Quaternion()

/** 자세 qF 에서 value 가 위로 보이게 하는 라벨 회전 (같은 눈을 주는 4가지 중 하나) */
export function labelFor(qF: THREE.Quaternion, value: number) {
  const ok: THREE.Quaternion[] = []
  for (const s of SYMMETRIES) {
    labelTmp.multiplyQuaternions(qF, s)
    if (upFace(labelTmp) === value) ok.push(s)
  }
  if (!ok.length) return new THREE.Quaternion() // 있을 수 없지만 안전하게
  return ok[Math.floor(Math.random() * ok.length)].clone()
}

/** 이 판이 끝났는가 (미리 굴리기와 실제 굴리기가 반드시 같은 판정을 써야 한다) */
export function rollFinished(bodies: Body[], t: number) {
  return t >= MAX_SIM || bodies.every((b) => !b.active || b.asleep)
}

/** 화면 없이 끝까지 굴린다 */
export function simulate(bodies: Body[]) {
  let t = 0
  while (!rollFinished(bodies, t)) {
    stepBodies(bodies, STEP)
    t += STEP
  }
  return t
}

/** 되감기용 상태 복사 */
export function snapshot(bodies: Body[]): Body[] {
  return bodies.map((b) => ({
    p: b.p.clone(),
    v: b.v.clone(),
    q: b.q.clone(),
    w: b.w.clone(),
    active: b.active,
    asleep: b.asleep,
    sleepT: b.sleepT,
    inside: b.inside, // 빠뜨리면 되감은 뒤 벽 높이가 달라져 궤적이 어긋난다
  }))
}

export function restore(bodies: Body[], snap: Body[]) {
  bodies.forEach((b, i) => {
    b.p.copy(snap[i].p)
    b.v.copy(snap[i].v)
    b.q.copy(snap[i].q)
    b.w.copy(snap[i].w)
    b.active = snap[i].active
    b.asleep = snap[i].asleep
    b.sleepT = snap[i].sleepT
    b.inside = snap[i].inside
  })
}

/* ============================================================
   마무리 — 살짝 기울어진 것만 반듯하게
   ============================================================ */

const YAW_STEPS = 24
const yawQ = new THREE.Quaternion()
const poseQ = new THREE.Quaternion()

/** q 에서 value 를 위로 보이게 하는 가장 가까운 자세를 out 에 담고 그 각도를 돌려준다 */
export function nearestPose(q: THREE.Quaternion, value: number, out: THREE.Quaternion) {
  let best = Infinity
  for (let i = 0; i < YAW_STEPS; i++) {
    yawQ.setFromAxisAngle(UP, (i / YAW_STEPS) * Math.PI * 2)
    poseQ.multiplyQuaternions(yawQ, QBASE[value])
    const d = q.angleTo(poseQ)
    if (d < best) {
      best = d
      out.copy(poseQ)
    }
  }
  return best
}

/** 지금 하늘을 보고 있는 눈 */
export function upFace(q: THREE.Quaternion) {
  let best = -Infinity
  let value = 0
  for (const f of FACES) {
    const d = tmpA.copy(f.normal).applyQuaternion(q).y
    if (d > best) {
      best = d
      value = f.value
    }
  }
  return value
}

/** 눕힌 주사위들이 겹치지 않게 xz 를 밀고 판 안으로 넣는다 (제자리 수정) */
export function relaxSpots(spots: THREE.Vector3[]) {
  for (let iter = 0; iter < 10; iter++) {
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        const pa = spots[a]
        const pb = spots[b]
        const dx = pb.x - pa.x
        const dz = pb.z - pa.z
        const dist = Math.hypot(dx, dz)
        const min = FLAT * 2.05
        if (dist > min || dist < 1e-4) continue
        const push = (min - dist) / 2
        pa.x -= (dx / dist) * push
        pa.z -= (dz / dist) * push
        pb.x += (dx / dist) * push
        pb.z += (dz / dist) * push
      }
    }
    for (const p of spots) {
      p.x = clamp(p.x, -X_HALF + FLAT, X_HALF - FLAT)
      p.z = clamp(p.z, -Z_HALF + FLAT, PLAY_Z - FLAT)
    }
  }
}

/** 고정 슬롯의 x 좌표 (count 개 중 order 번째) */
export function slotX(order: number, count: number) {
  return (order - (count - 1) / 2) * KEEP_GAP
}
