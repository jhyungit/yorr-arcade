import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  DIE,
  FACES,
  H,
  KEEP_GAP,
  KEEP_Z,
  PLAY_Z,
  QBASE,
  RAIL_D,
  RIM,
  STEP,
  UP,
  WALL_H,
  X_HALF,
  Z_HALF,
  FLAT,
  clamp,
  labelFor,
  makeBody,
  nearestPose,
  rand,
  relaxSpots,
  restore,
  rollFinished,
  simulate,
  slotX,
  snapshot,
  stepBodies,
  throwInto,
  upFace,
  type Body,
} from './physics'

/**
 * dice3d.ts — 요트다이스 3D 보드 (Three.js)
 * -------------------------------------------------------------
 * 굴러가는 규칙은 physics.ts 가 전부 갖고 있다. 여기는 "그걸 어떻게 보여줄까"만.
 * 게임 규칙(족보·점수)은 아예 모른다. "이 눈이 나왔다"만 받는다.
 *
 * 왜 물리 시뮬인가
 *  - 예전 CSS 큐브는 회전값을 키프레임으로 보간만 해서, 이징을 아무리 만져도
 *    "굴러간다"가 아니라 "돌다 멈춘다"로 보였다. 무게도 바운스도 부딪힘도 없으니까.
 *
 * 결과값을 어떻게 맞추나 (자세한 건 physics.ts 의 "굴리기 한 판" 주석)
 *  1. 화면에 안 그리고 끝까지 한 번 굴려 본다 → 어떤 자세로 멈추는지 미리 안다.
 *  2. 그 자세에서 목표 눈이 위로 오도록 "라벨 회전"을 정한다.
 *  3. 되감아 진짜로 굴린다. 렌더링만 body.q · label 로 한다.
 *  정육면체는 90° 회전에 대해 자기 자신이라 궤적이 조금도 안 바뀐다 → 스냅 0.
 *  → 어느 자리에 어느 눈이 놓였는지는 onSettle(shown) 으로 돌려준다.
 *
 * 외부 에셋 0: 펠트·월넛·주사위 눈은 전부 캔버스로 직접 그린다.
 */

const FLATTEN_MS = 150 // 멈춘 뒤 기운 주사위를 반듯하게 눕히는 시간
const FLATTEN_MAX = 1.0 // 이보다 많이 기울었으면 (뭔가에 기댄 것) 그냥 둔다
const KEEP_MS = 300 // 고정/해제 슬라이드

/* ── 카메라 ── */
const FOV = 38
const TILT = 0.93 // 내려다보는 각(rad) — 펠트가 넓게 보이면서 주사위 두께도 읽히는 값

/* ── 색 (다크 프리미엄: 딥그린 펠트 · 월넛 · 골드) ── */
const C_FELT = '#1d5c46'
const C_FELT_DARK = '#123b2f'
const C_GOLD = 0xd8a24a

/** 시작도 끝도 부드럽게 (안착 블렌드용) */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/* ============================================================
   절차적 텍스처 — 외부 이미지 없이 캔버스로 직접 그린다
   ============================================================ */

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const c = cv.getContext('2d')!
  draw(c)
  const t = new THREE.CanvasTexture(cv)
  t.anisotropy = 4
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 주사위 한 면: 상아빛 바탕 + 파낸 듯한 눈. 1은 붉은 에이스(클래식). */
function faceTexture(value: number) {
  const S = 256
  const PIPS: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [
      [0, 0],
      [2, 2],
    ],
    3: [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    4: [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ],
    5: [
      [0, 0],
      [2, 0],
      [1, 1],
      [0, 2],
      [2, 2],
    ],
    6: [
      [0, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [0, 2],
      [2, 2],
    ],
  }
  return canvasTex(S, S, (c) => {
    // 상아 바탕 — 좌상단이 살짝 밝다
    const bg = c.createLinearGradient(0, 0, S, S)
    bg.addColorStop(0, '#fffdf7')
    bg.addColorStop(0.55, '#f6f1e4')
    bg.addColorStop(1, '#e9e1cf')
    c.fillStyle = bg
    c.fillRect(0, 0, S, S)

    // 아주 미세한 결 (완전 균일하면 플라스틱처럼 보인다)
    c.globalAlpha = 0.05
    for (let i = 0; i < 900; i++) {
      c.fillStyle = i % 2 ? '#ffffff' : '#9a917c'
      c.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4)
    }
    c.globalAlpha = 1

    const ace = value === 1
    const r = ace ? S * 0.115 : S * 0.082
    for (const [gx, gy] of PIPS[value]) {
      const x = S * (0.265 + gx * 0.235)
      const y = S * (0.265 + gy * 0.235)
      // 파인 자국: 위는 그늘, 아래는 반사
      const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r)
      if (ace) {
        g.addColorStop(0, '#8f2018')
        g.addColorStop(0.65, '#b8352a')
        g.addColorStop(1, '#7d1a14')
      } else {
        g.addColorStop(0, '#14161a')
        g.addColorStop(0.6, '#2b2f36')
        g.addColorStop(1, '#0e1013')
      }
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.fillStyle = g
      c.fill()
      // 아래쪽 얇은 하이라이트 = 구멍의 깊이
      c.beginPath()
      c.arc(x, y + r * 0.08, r * 0.94, Math.PI * 0.15, Math.PI * 0.85)
      c.strokeStyle = 'rgba(255,255,255,0.5)'
      c.lineWidth = S * 0.008
      c.stroke()
    }
  })
}

/** 펠트: 딥그린 + 미세 보풀 + 가장자리 그늘 */
function feltTexture() {
  return canvasTex(512, 512, (c) => {
    c.fillStyle = C_FELT
    c.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 9000; i++) {
      c.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)'
      c.fillRect(Math.random() * 512, Math.random() * 512, 1.6, 1.6)
    }
    const v = c.createRadialGradient(256, 220, 60, 256, 256, 330)
    v.addColorStop(0, 'rgba(255,255,255,0.07)')
    v.addColorStop(0.6, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(0,0,0,0.5)')
    c.fillStyle = v
    c.fillRect(0, 0, 512, 512)
  })
}

/** KEEP 레일: 어두운 펠트 + 각인된 글자 + 슬롯 자국 */
function railTexture() {
  const W = 1024
  const HGT = 176
  return canvasTex(W, HGT, (c) => {
    c.fillStyle = C_FELT_DARK
    c.fillRect(0, 0, W, HGT)
    for (let i = 0; i < 4000; i++) {
      c.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)'
      c.fillRect(Math.random() * W, Math.random() * HGT, 1.6, 1.6)
    }
    // 슬롯 자국 5개 (여기 놓인다는 힌트)
    for (let i = 0; i < 5; i++) {
      const x = W / 2 + (i - 2) * W * (KEEP_GAP / (X_HALF * 2))
      c.beginPath()
      c.arc(x, HGT * 0.52, HGT * 0.3, 0, Math.PI * 2)
      c.strokeStyle = 'rgba(216,162,74,0.18)'
      c.lineWidth = 3
      c.stroke()
    }
    // 각인 라벨
    c.font = `600 ${Math.round(HGT * 0.3)}px ui-monospace, Consolas, monospace`
    c.textBaseline = 'middle'
    c.fillStyle = 'rgba(0,0,0,0.35)'
    c.fillText('K E E P', 26, HGT * 0.5 + 2)
    c.fillStyle = 'rgba(216,162,74,0.42)'
    c.fillText('K E E P', 26, HGT * 0.5)
  })
}

/** 월넛 결 */
function woodTexture() {
  return canvasTex(512, 512, (c) => {
    c.fillStyle = '#4b3524'
    c.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 46; i++) {
      const y = (i / 46) * 512 + rand(-4, 4)
      c.beginPath()
      c.moveTo(0, y)
      for (let x = 0; x <= 512; x += 32) c.lineTo(x, y + Math.sin(x * 0.02 + i) * 4)
      c.strokeStyle = i % 3 === 0 ? 'rgba(28,18,10,0.5)' : 'rgba(126,92,58,0.28)'
      c.lineWidth = i % 3 === 0 ? 2.4 : 1.2
      c.stroke()
    }
    const g = c.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, 'rgba(255,220,170,0.10)')
    g.addColorStop(1, 'rgba(0,0,0,0.22)')
    c.fillStyle = g
    c.fillRect(0, 0, 512, 512)
  })
}

/* ============================================================
   씬
   ============================================================ */

/** 화면에 보이는 주사위 한 알 = 물리 몸 + 메시 + (이동/안착) 블렌드 */
interface Die {
  mesh: THREE.Mesh
  body: Body
  /** 라벨 회전 — 물리에는 없고 그릴 때만 곱한다 (mesh.q = body.q · label).
   *  정육면체 대칭이라 궤적을 바꾸지 않으면서 "어느 눈이 위로 오는지"만 정한다. */
  label: THREE.Quaternion
  kept: boolean
  blending: boolean
  p0: THREE.Vector3
  pT: THREE.Vector3
  q0: THREE.Quaternion
  qT: THREE.Quaternion
  t: number
  dur: number
  hop: number // 이동 중 살짝 떠오르는 높이
}

export interface DiceScene {
  /** 굴린다. kept[i] 인 주사위는 그대로 두고 나머지만 던진다 */
  roll(values: number[], kept: boolean[]): void
  /** 애니메이션 없이 즉시 최종 배치 (모션 최소화 · 첫 렌더) */
  place(values: number[], kept: boolean[]): void
  /** 고정 상태 변경 → 레일로 슬라이드 / 판으로 복귀 */
  setKept(kept: boolean[]): void
  /** 화면 좌표에서 주사위 찾기. 없으면 -1 */
  pick(clientX: number, clientY: number): number
  frame(dtMs: number): void
  resize(w: number, h: number, dpr: number): void
  dispose(): void
}

export interface DiceSceneOptions {
  /** 다 멈췄다. shown[i] = i번 주사위가 실제로 보이는 눈 */
  onSettle: (shown: number[]) => void
  /** 부딪힘 (0~1 세기) — 소리/진동용 */
  onImpact: (strength: number) => void
}

export function createScene(canvas: HTMLCanvasElement, opts: DiceSceneOptions): DiceScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setClearAlpha(0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.06
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40)

  /* 정리 대상 추적 */
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const texs: THREE.Texture[] = []
  const keepG = <T extends THREE.BufferGeometry>(g: T) => (geos.push(g), g)
  const keepM = <T extends THREE.Material>(m: T) => (mats.push(m), m)
  const keepT = <T extends THREE.Texture>(t: T) => (texs.push(t), t)

  /* ── 조명: 위에서 떨어지는 따뜻한 키 + 차가운 필 + 앞쪽 금빛 ── */
  scene.add(new THREE.HemisphereLight(0xa9c6e6, 0x140f08, 0.55))
  const key = new THREE.DirectionalLight(0xfff1d8, 2.15)
  key.position.set(1.5, 3.3, 1.9)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.radius = 3
  key.shadow.bias = -0.0007
  const sc = key.shadow.camera
  sc.left = -2.2
  sc.right = 2.2
  sc.top = 2.0
  sc.bottom = -2.0
  sc.near = 0.5
  sc.far = 9
  sc.updateProjectionMatrix()
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x9dbcff, 0.4)
  fill.position.set(-2.1, 1.5, -1.7)
  scene.add(fill)
  const warm = new THREE.PointLight(0xffca7a, 0.5, 7)
  warm.position.set(0, 1.1, 1.7)
  scene.add(warm)

  /* ── 펠트 ── */
  const felt = new THREE.Mesh(
    keepG(new THREE.PlaneGeometry(X_HALF * 2, PLAY_Z + Z_HALF)),
    keepM(new THREE.MeshStandardMaterial({ map: keepT(feltTexture()), roughness: 0.97 })),
  )
  felt.rotation.x = -Math.PI / 2
  felt.position.set(0, 0, (PLAY_Z - Z_HALF) / 2)
  felt.receiveShadow = true
  scene.add(felt)

  const rail = new THREE.Mesh(
    keepG(new THREE.PlaneGeometry(X_HALF * 2, RAIL_D)),
    keepM(new THREE.MeshStandardMaterial({ map: keepT(railTexture()), roughness: 0.98 })),
  )
  rail.rotation.x = -Math.PI / 2
  rail.position.set(0, 0.001, KEEP_Z)
  rail.receiveShadow = true
  scene.add(rail)

  /* ── 나무 테두리 + 골드 인레이 ── */
  const woodMat = keepM(
    new THREE.MeshStandardMaterial({ map: keepT(woodTexture()), roughness: 0.62, metalness: 0.06 }),
  )
  const goldMat = keepM(
    new THREE.MeshStandardMaterial({ color: C_GOLD, roughness: 0.26, metalness: 0.9 }),
  )

  const outX = X_HALF + RIM
  const outZ = Z_HALF + RIM
  const bottom = new THREE.Mesh(keepG(new THREE.BoxGeometry(outX * 2, 0.07, outZ * 2)), woodMat)
  bottom.position.y = -0.035
  bottom.receiveShadow = true
  scene.add(bottom)

  const sideGeo = keepG(new THREE.BoxGeometry(RIM, WALL_H, outZ * 2))
  const endGeo = keepG(new THREE.BoxGeometry(outX * 2, WALL_H, RIM))
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(sideGeo, woodMat)
    m.position.set(sx * (X_HALF + RIM / 2), WALL_H / 2, 0)
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
  }
  for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(endGeo, woodMat)
    m.position.set(0, WALL_H / 2, sz * (Z_HALF + RIM / 2))
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
  }
  // 테두리 안쪽 위에 얇게 박힌 금선
  const inlaySide = keepG(new THREE.BoxGeometry(0.022, 0.014, outZ * 2))
  const inlayEnd = keepG(new THREE.BoxGeometry(outX * 2, 0.014, 0.022))
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(inlaySide, goldMat)
    m.position.set(sx * (X_HALF + RIM * 0.32), WALL_H + 0.005, 0)
    scene.add(m)
  }
  for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(inlayEnd, goldMat)
    m.position.set(0, WALL_H + 0.005, sz * (Z_HALF + RIM * 0.32))
    scene.add(m)
  }
  // KEEP 레일 구분선 (낮은 금색 바). 물리 벽은 이 자리에 보이지 않게 서 있다.
  const divider = new THREE.Mesh(keepG(new THREE.BoxGeometry(X_HALF * 2, 0.05, 0.045)), goldMat)
  divider.position.set(0, 0.025, PLAY_Z)
  divider.castShadow = true
  scene.add(divider)

  /* ── 주사위 5알 ── */
  const dieGeo = keepG(new RoundedBoxGeometry(DIE, DIE, DIE, 3, DIE * 0.16))
  const faceMats = FACES.map((f) =>
    keepM(
      new THREE.MeshPhysicalMaterial({
        map: keepT(faceTexture(f.value)),
        roughness: 0.36,
        metalness: 0,
        clearcoat: 0.55,
        clearcoatRoughness: 0.22,
      }),
    ),
  )

  const dice: Die[] = []
  for (let i = 0; i < 5; i++) {
    const mesh = new THREE.Mesh(dieGeo, faceMats)
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
    dice.push({
      mesh,
      body: makeBody(),
      label: new THREE.Quaternion(),
      kept: false,
      blending: false,
      p0: new THREE.Vector3(),
      pT: new THREE.Vector3(),
      q0: new THREE.Quaternion(),
      qT: new THREE.Quaternion(),
      t: 0,
      dur: 1,
      hop: 0,
    })
  }

  /* ── 진행 상태 ── */
  let phase: 'idle' | 'rolling' | 'settling' = 'idle'
  let simT = 0
  let acc = 0
  let rolling: number[] = [] // 이번에 굴린 주사위 인덱스
  let rollValues: number[] = [] // 그 주사위들이 나올 눈 (자리는 아직 미정)
  const shownValues = [1, 1, 1, 1, 1] // 지금 각 자리가 보이는 눈

  const tmpP = new THREE.Vector3()
  const tmpQ = new THREE.Quaternion()
  const bodies = dice.map((d) => d.body)

  function beginBlend(d: Die, pT: THREE.Vector3, qT: THREE.Quaternion, dur: number, hop: number) {
    d.p0.copy(d.body.p)
    d.q0.copy(d.body.q)
    d.pT.copy(pT)
    d.qT.copy(qT)
    d.t = 0
    d.dur = dur
    d.hop = hop
    d.blending = true
    d.body.active = false
  }

  /**
   * 다 굴렀다.
   * 눈은 이미 라벨 회전으로 맞춰져 있으니(roll 참고) 여기서 할 일은 마무리뿐:
   * 살짝 기운 주사위만 반듯하게 눕힌다. 많이 기울었으면 다른 주사위에 기댄
   * 것이므로 억지로 눕히지 않는다 (그게 더 자연스럽다).
   */
  function beginSettle() {
    rolling.forEach((i, k) => {
      const d = dice[i]
      tmpQ.multiplyQuaternions(d.body.q, d.label)
      let shown = upFace(tmpQ)
      // 만에 하나 미리 굴리기와 결과가 어긋났다면(부동소수점) 여기서 바로잡는다.
      // 굴러 멈춘 그 순간이라 눈에 잘 띄지 않고, 점수와 화면이 어긋나는 것보단 낫다.
      if (shown !== rollValues[k]) {
        d.label.copy(labelFor(d.body.q, rollValues[k]))
        shown = rollValues[k]
      }
      shownValues[i] = shown

      const tilt = nearestPose(d.body.q, upFace(d.body.q), tmpQ)
      if (tilt < FLATTEN_MAX) {
        // 눕히면서 판 안으로 (벽에 기대 있던 놈이 벽을 뚫지 않게)
        tmpP.set(
          clamp(d.body.p.x, -X_HALF + FLAT, X_HALF - FLAT),
          H,
          clamp(d.body.p.z, -Z_HALF + FLAT, PLAY_Z - FLAT),
        )
        beginBlend(d, tmpP, tmpQ, FLATTEN_MS, 0)
      }
    })
    phase = 'settling'
  }

  /** 판 위 빈 자리 하나 (다른 주사위와 안 겹치게) */
  function freeSpot(exclude: number, out: THREE.Vector3) {
    for (let tryIt = 0; tryIt < 40; tryIt++) {
      const x = rand(-X_HALF + FLAT, X_HALF - FLAT)
      const z = rand(-Z_HALF + FLAT, PLAY_Z - FLAT)
      let ok = true
      for (let i = 0; i < dice.length; i++) {
        if (i === exclude || dice[i].kept) continue
        if (Math.hypot(dice[i].body.p.x - x, dice[i].body.p.z - z) < FLAT * 2.05) {
          ok = false
          break
        }
      }
      if (ok) return out.set(x, H, z)
    }
    return out.set(0, H, (PLAY_Z - Z_HALF) / 2)
  }

  function layoutKept(animate: boolean) {
    const keptIdx = dice.map((d, i) => (d.kept ? i : -1)).filter((i) => i >= 0)
    keptIdx.forEach((i, order) => {
      const d = dice[i]
      tmpP.set(slotX(order, keptIdx.length), H, KEEP_Z)
      if (animate) beginBlend(d, tmpP, d.body.q, KEEP_MS, 0.13)
      else {
        d.body.p.copy(tmpP)
        d.body.active = false
        d.blending = false
      }
    })
  }

  /* ============================================================
     공개 API
     ============================================================ */

  function roll(values: number[], kept: boolean[]) {
    rolling = []
    rollValues = []
    for (let i = 0; i < dice.length; i++) {
      dice[i].kept = kept[i]
      dice[i].blending = false
      if (kept[i]) continue
      rolling.push(i)
      rollValues.push(values[i])
    }
    layoutKept(false)
    rolling.forEach((i, k) => throwInto(dice[i].body, k, rolling.length))

    // ① 화면에 그리지 않고 끝까지 한 번 굴려 본다 (5알 × 1.5초 ≈ 2~3ms)
    const snap = snapshot(bodies)
    simulate(bodies)
    // ② 그 자세에서 목표 눈이 위로 오도록 라벨을 정한다
    rolling.forEach((i, k) => dice[i].label.copy(labelFor(dice[i].body.q, rollValues[k])))
    // ③ 되감아 진짜로 굴린다. 정육면체 대칭이라 궤적은 ①과 완전히 같다 → 스냅 0
    restore(bodies, snap)

    phase = 'rolling'
    simT = 0
    acc = 0
  }

  function place(values: number[], kept: boolean[]) {
    for (let i = 0; i < dice.length; i++) {
      dice[i].kept = kept[i]
      dice[i].blending = false
      dice[i].body.active = false
      dice[i].body.v.set(0, 0, 0)
      dice[i].body.w.set(0, 0, 0)
      dice[i].body.asleep = true
      dice[i].label.identity() // 자세를 직접 정하므로 라벨은 필요 없다
      shownValues[i] = values[i]
    }
    const loose = dice.map((d, i) => (d.kept ? -1 : i)).filter((i) => i >= 0)
    const spots = loose.map((_, k) =>
      new THREE.Vector3(
        slotX(k, loose.length) + rand(-0.05, 0.05),
        H,
        (PLAY_Z - Z_HALF) / 2 + rand(-0.18, 0.18),
      ),
    )
    relaxSpots(spots)
    loose.forEach((i, k) => {
      dice[i].body.p.copy(spots[k])
      dice[i].body.q.copy(QBASE[values[i]]).premultiply(
        tmpQ.setFromAxisAngle(UP, rand(0, Math.PI * 2)),
      )
    })
    layoutKept(false)
    phase = 'idle'
    syncMeshes()
  }

  function setKept(kept: boolean[]) {
    for (let i = 0; i < dice.length; i++) {
      const was = dice[i].kept
      dice[i].kept = kept[i]
      // 고정 해제 → 판 위 빈 자리로 되돌아간다
      if (was && !kept[i]) beginBlend(dice[i], freeSpot(i, tmpP), dice[i].body.q, KEEP_MS, 0.13)
    }
    layoutKept(true)
  }

  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()

  function pick(clientX: number, clientY: number) {
    const r = canvas.getBoundingClientRect()
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(
      dice.map((d) => d.mesh),
      false,
    )
    if (!hits.length) return -1
    return dice.findIndex((d) => d.mesh === hits[0].object)
  }

  function syncMeshes() {
    for (const d of dice) {
      d.mesh.position.copy(d.body.p)
      d.mesh.quaternion.multiplyQuaternions(d.body.q, d.label)
    }
  }

  function frame(dtMs: number) {
    const dt = Math.min(dtMs, 60) / 1000
    let impact = 0

    if (phase === 'rolling') {
      acc += dt
      let guard = 0
      // 미리 굴리기(simulate)와 완전히 같은 스텝 수를 밟아야 결과가 같다.
      // → 프레임 단위가 아니라 매 스텝마다 같은 판정(rollFinished)을 쓴다.
      while (acc >= STEP && guard++ < 12 && !rollFinished(bodies, simT)) {
        acc -= STEP
        const s = stepBodies(bodies, STEP)
        simT += STEP
        if (s > impact) impact = s
      }
      if (rollFinished(bodies, simT)) beginSettle()
    }

    // 블렌드 (안착 · 고정 이동)
    let blending = false
    for (const d of dice) {
      if (!d.blending) continue
      d.t += dtMs
      const t = clamp(d.t / d.dur, 0, 1)
      const e = easeInOut(t)
      d.body.p.lerpVectors(d.p0, d.pT, e)
      d.body.p.y += Math.sin(Math.PI * t) * d.hop
      d.body.q.slerpQuaternions(d.q0, d.qT, e)
      if (t >= 1) d.blending = false
      else blending = true
    }

    if (phase === 'settling' && !blending) {
      phase = 'idle'
      opts.onSettle(shownValues.slice())
    }
    if (impact > 0.12) opts.onImpact(impact)

    syncMeshes()
    renderer.render(scene, camera)
  }

  let vw = 1
  let vh = 1

  function resize(w: number, h: number, dpr: number) {
    vw = Math.max(1, Math.round(w))
    vh = Math.max(1, Math.round(h))
    renderer.setPixelRatio(dpr)
    renderer.setSize(vw, vh, false)

    // 보드 전체가 화면에 들어오도록 카메라 거리를 잡는다 (가로/세로 중 더 필요한 쪽)
    const aspect = vw / vh
    camera.aspect = aspect
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180)
    const tanH = tanV * aspect
    const halfW = X_HALF + RIM + 0.06
    const halfD = Z_HALF + RIM + 0.06
    const dW = halfW / tanH
    const dD = (halfD * Math.sin(TILT) + WALL_H * Math.cos(TILT)) / tanV
    const dist = Math.max(dW, dD) * 1.16
    camera.position.set(0, dist * Math.sin(TILT), dist * Math.cos(TILT))
    camera.lookAt(0, 0, 0.02)
    camera.updateProjectionMatrix()
  }

  function dispose() {
    geos.forEach((g) => g.dispose())
    mats.forEach((m) => m.dispose())
    texs.forEach((t) => t.dispose())
    renderer.dispose()
  }

  place([1, 2, 3, 4, 5], [false, false, false, false, false])

  return { roll, place, setKept, pick, frame, resize, dispose }
}
