import * as THREE from 'three'
import {
  BALL_R,
  FAR_Z,
  IDEAL1,
  IDEAL2,
  NEAR_Z,
  NET_H,
  NET_OVERHANG,
  PERFECT_D,
  TABLE_H,
  TABLE_LEN,
  TABLE_THICK,
  TABLE_W,
  W1_HI,
  W1_LO,
  ballY,
  flightProgress,
  posToZ,
  viewerDepth,
  xToWorld,
} from './court'

/**
 * scene3d.ts — 탁구 3D 무대 (Three.js)
 * -------------------------------------------------------------
 * 게임 규칙은 하나도 모른다. 매 프레임 "지금 공/라켓이 어디 있나"만 받아
 * 3D 로 그린다. 덕분에 기존 게임 로직·온라인 프로토콜을 건드리지 않는다.
 *
 * 설계 메모
 *  - 외부 에셋 0: 테이블 라인·네트 그물·그림자는 전부 캔버스로 그려 텍스처로 쓴다.
 *  - 그림자는 셰도우맵 대신 "가짜 그림자"(그라디언트 판)를 쓴다.
 *    공 그림자는 3D 탁구에서 깊이를 읽는 유일한 단서라, 물리적 정확함보다
 *    항상 또렷하게 보이는 게 중요하다. 셰도우맵의 얼룩·바이어스 문제도 없다.
 *  - 2인 대결은 "월드를 뒤집는" 게 아니라 반대편에 카메라를 하나 더 둔다.
 *    테이블이 대칭이라 카메라만 바꾸면 각자의 1인칭이 된다.
 */

/* ── 연출 튜닝 값 (여기만 만지면 됨) ──
   카메라가 낮으면 라켓이 "테이블에 누운 것"처럼 보이고 먼 코트가 안 보인다.
   중계 카메라처럼 살짝 높이 올려 내려다보는 각(약 17°)이 가장 잘 읽힌다. */
const FOV = 46
const CAM_HEIGHT = TABLE_H + 1.04 // 눈높이
const CAM_BACK = 1.72 // 자기 코트 끝에서 뒤로 물러난 거리
const LOOK_HEIGHT = TABLE_H - 0.02
const LOOK_AHEAD = -0.3 // 시선이 향하는 z (자기 코트 기준 네트 너머)
const PADDLE_Y = TABLE_H + 0.15 // 라켓을 쥔 높이
const SHAKE_AMP = 0.05 // 스매시 화면 흔들림 (m)
const TRAIL = 5 // 스매시 잔상 개수

type Viewer = 1 | 2

/** 프레임마다 렌더러에 넘기는 게임 상태 (렌더러는 이것만 안다) */
export interface FrameState {
  /** 좌우 분할로 두 시점을 함께 그릴지 */
  split: boolean
  /** 단일 화면일 때 누구 시점인지 */
  viewer: Viewer
  playing: boolean
  ballPos: number
  ballDir: 1 | -1
  ballX: number
  ballSmash: boolean
  ballHit: boolean
  p1X: number
  p2X: number
  /** 0=평소, 1=방금 휘둘렀음 */
  p1Swing: number
  p2Swing: number
  /** 0=평온, 1=최대 흔들림 */
  shake: number
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** 빠르게 시작해 부드럽게 멈추는 감쇠 */
const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

/* ============================================================
   절차적 텍스처 — 외부 이미지 없이 캔버스로 직접 그린다
   ============================================================ */

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
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

/** 테이블 상판: 청색 + 흰 테두리 + 센터라인 (세로가 테이블 길이) */
function tableTopTexture() {
  const W = 560
  const H = Math.round(W * (TABLE_LEN / TABLE_W))
  return canvasTex(W, H, (c) => {
    const g = c.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#1262a0')
    g.addColorStop(0.5, '#1a7cc4')
    g.addColorStop(1, '#1262a0')
    c.fillStyle = g
    c.fillRect(0, 0, W, H)
    // 결(브러시) 느낌의 아주 미세한 세로 줄
    c.globalAlpha = 0.05
    c.fillStyle = '#ffffff'
    for (let x = 0; x < W; x += 7) c.fillRect(x, 0, 1, H)
    c.globalAlpha = 1
    // 흰 테두리
    const line = Math.max(3, Math.round(W * 0.016))
    c.strokeStyle = '#f4f8fb'
    c.lineWidth = line
    c.strokeRect(line / 2, line / 2, W - line, H - line)
    // 센터라인 (복식용) — 얇게
    c.fillStyle = 'rgba(244,248,251,0.9)'
    c.fillRect(W / 2 - line * 0.22, 0, line * 0.44, H)
    // 네트 자리 그림자 살짝
    c.fillStyle = 'rgba(0,0,0,0.16)'
    c.fillRect(0, H / 2 - 3, W, 6)
  })
}

/** 네트 그물: 투명 배경 + 흰 격자 + 위쪽 흰 테이프 */
function netTexture() {
  return canvasTex(512, 96, (c) => {
    c.clearRect(0, 0, 512, 96)
    c.strokeStyle = 'rgba(240,246,255,0.62)'
    c.lineWidth = 1.4
    for (let x = 0; x <= 512; x += 9) {
      c.beginPath()
      c.moveTo(x, 14)
      c.lineTo(x, 96)
      c.stroke()
    }
    for (let y = 14; y <= 96; y += 9) {
      c.beginPath()
      c.moveTo(0, y)
      c.lineTo(512, y)
      c.stroke()
    }
    // 상단 테이프 (불투명 흰 띠)
    c.fillStyle = '#f2f6fb'
    c.fillRect(0, 0, 512, 13)
  })
}

/** 가짜 그림자용 방사형 그라디언트 */
function blobTexture() {
  return canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(0,0,0,0.85)')
    g.addColorStop(0.45, 'rgba(0,0,0,0.42)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 128, 128)
  })
}

/** 뒷벽: 위로 갈수록 어두워지는 체육관 벽 (허공처럼 비어 보이지 않게) */
function wallTexture() {
  return canvasTex(64, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, '#05080e')
    g.addColorStop(0.55, '#0b131f')
    g.addColorStop(0.86, '#16243a')
    g.addColorStop(1, '#1d2f49')
    c.fillStyle = g
    c.fillRect(0, 0, 64, 256)
    // 바닥과 벽이 만나는 선 (걸레받이)
    c.fillStyle = 'rgba(120,160,210,0.16)'
    c.fillRect(0, 248, 64, 3)
  })
}

/** 바닥: 어두운 체육관 + 중앙 스포트라이트 */
function floorTexture() {
  return canvasTex(512, 512, (c) => {
    c.fillStyle = '#0a0f18'
    c.fillRect(0, 0, 512, 512)
    const g = c.createRadialGradient(256, 256, 20, 256, 256, 250)
    g.addColorStop(0, 'rgba(90,130,180,0.30)')
    g.addColorStop(0.55, 'rgba(50,80,120,0.12)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 512, 512)
    // 바닥 널 (은은한 격자)
    c.strokeStyle = 'rgba(255,255,255,0.035)'
    c.lineWidth = 1
    for (let i = 0; i <= 512; i += 32) {
      c.beginPath()
      c.moveTo(i, 0)
      c.lineTo(i, 512)
      c.stroke()
      c.beginPath()
      c.moveTo(0, i)
      c.lineTo(512, i)
      c.stroke()
    }
  })
}

/* ============================================================
   라켓 (블레이드 + 손잡이 + 팔) · 사람 피겨
   ============================================================ */

interface Paddle {
  group: THREE.Group
  /** 팔 — 먼 쪽 시점에서만 보여준다 (가까이선 너무 커서 테이블에 누운 것처럼 보임) */
  arm: THREE.Mesh
  /** 네트를 향하는 방향: P1 = -1(-z 로 친다) · P2 = +1 */
  facing: -1 | 1
  baseZ: number
}

function makePaddle(color: number, facing: -1 | 1, baseZ: number, mats: MatBag): Paddle {
  const group = new THREE.Group()

  // 블레이드 — 얇은 원판. 기본 원기둥은 y축이라 X로 90° 눕혀 네트를 마주보게.
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.077, 0.009, 28), mats.rubber(color))
  blade.rotation.x = Math.PI / 2
  group.add(blade)

  // 테두리(스펀지 옆면)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.077, 0.006, 8, 28), mats.wood)
  group.add(rim)

  // 손잡이 — 블레이드 아래로
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.019), mats.wood)
  handle.position.set(0, -0.12, 0)
  group.add(handle)

  // 팔 — 손잡이에서 "플레이어 쪽(네트 반대)"으로 뻗어 몸과 이어 보이게 한다.
  //  네트 쪽으로 뻗으면 테이블 판을 뚫으므로 방향은 facing 으로 뒤집는다.
  //  가까운 쪽 시점에서는 카메라와 너무 가까워 화면을 덮으므로 prepare() 에서 숨긴다.
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.28, 4, 10), mats.skin)
  arm.position.set(0.02, -0.04, facing * -0.17)
  arm.rotation.x = facing * -1.45
  group.add(arm)

  group.position.set(0, PADDLE_Y, baseZ)
  return { group, arm, facing, baseZ }
}

/** 라켓 자세: 좌우 추적 + 스윙(휘두른 뒤 따라나가며 준비자세로 복귀) */
function poseP(p: Paddle, xNorm: number, swing: number) {
  const g = p.group
  const f = p.facing
  // swing: 1=방금 침 → 0=평소.  t: 0=타구 순간 → 1=follow-through 끝
  const t = easeOut(1 - clamp(swing, 0, 1))
  const READY = 0.38 // 준비자세 (몸쪽으로 살짝 열어둠)
  const THRU = -0.55 // 휘둘러 지나간 각
  g.position.x = xToWorld(xNorm)
  // 스윙 중엔 네트 쪽으로 살짝 밀고 나간다 (0 → 최대 → 0)
  g.position.z = p.baseZ + f * -0.13 * Math.sin(Math.PI * t) * (swing > 0 ? 1 : 0)
  g.position.y = PADDLE_Y + 0.03 * Math.sin(Math.PI * t) * (swing > 0 ? 1 : 0)
  g.rotation.y = f * lerp(THRU, READY, t)
  g.rotation.z = f * lerp(-0.5, -0.15, t)
}

function makePlayer(color: number, z: number, facing: -1 | 1, mats: MatBag): THREE.Group {
  const g = new THREE.Group()
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.44, 4, 14), mats.shirt(color))
  torso.position.y = 1.14
  g.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 14), mats.skin)
  head.position.y = 1.56
  g.add(head)
  // 다리 두 짝
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.5, 4, 10), mats.pants)
    leg.position.set(s * 0.1, 0.56, 0)
    g.add(leg)
  }
  // 라켓 안 든 팔 (균형용)
  const freeArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 4, 10), mats.skin)
  freeArm.position.set(-0.23, 1.08, 0.04)
  freeArm.rotation.z = 0.16
  g.add(freeArm)
  g.position.set(0, 0, z)
  // 상대를 바라보게
  g.rotation.y = facing < 0 ? Math.PI : 0
  return g
}

/* ============================================================
   재질 묶음 — dispose 를 위해 만든 것을 모두 기억해 둔다
   ============================================================ */
interface MatBag {
  rubber(color: number): THREE.Material
  shirt(color: number): THREE.Material
  wood: THREE.Material
  skin: THREE.Material
  pants: THREE.Material
}

export interface PingPongScene {
  update(s: FrameState): void
  render(s: FrameState): void
  resize(w: number, h: number, dpr: number): void
  dispose(): void
}

export function createScene(canvas: HTMLCanvasElement): PingPongScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setClearColor(0x070b12, 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x070b12, 0.085)

  /* 정리 대상 추적 */
  const geos: THREE.BufferGeometry[] = []
  const matsList: THREE.Material[] = []
  const texs: THREE.Texture[] = []
  const keepG = <T extends THREE.BufferGeometry>(g: T) => (geos.push(g), g)
  const keepM = <T extends THREE.Material>(m: T) => (matsList.push(m), m)
  const keepT = <T extends THREE.Texture>(t: T) => (texs.push(t), t)

  const texTable = keepT(tableTopTexture())
  const texNet = keepT(netTexture())
  const texBlob = keepT(blobTexture())
  const texFloor = keepT(floorTexture())
  texFloor.wrapS = texFloor.wrapT = THREE.RepeatWrapping
  texFloor.repeat.set(3, 3)

  const mats: MatBag = {
    rubber: (color) => keepM(new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02 })),
    shirt: (color) => keepM(new THREE.MeshStandardMaterial({ color, roughness: 0.72 })),
    wood: keepM(new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.68 })),
    skin: keepM(new THREE.MeshStandardMaterial({ color: 0xe8b795, roughness: 0.68 })),
    pants: keepM(new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: 0.8 })),
  }

  /* ── 조명 ── */
  scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x0d141f, 0.62))
  const key = new THREE.DirectionalLight(0xffffff, 1.85)
  key.position.set(1.1, 3.4, 1.5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6ea8ff, 0.42)
  rim.position.set(-1.6, 1.4, -2.4)
  scene.add(rim)

  /* ── 바닥 ── */
  const floor = new THREE.Mesh(
    keepG(new THREE.PlaneGeometry(26, 26)),
    keepM(new THREE.MeshStandardMaterial({ map: texFloor, roughness: 0.94 })),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  /* ── 뒷벽 (양 끝) — 두 카메라가 서로 반대를 보므로 양쪽에 하나씩 ── */
  const texWall = keepT(wallTexture())
  const wallGeo = keepG(new THREE.PlaneGeometry(18, 7))
  const wallMat = keepM(new THREE.MeshBasicMaterial({ map: texWall, fog: true }))
  for (const sz of [-1, 1] as const) {
    const wall = new THREE.Mesh(wallGeo, wallMat)
    wall.position.set(0, 3.5, sz * 7)
    if (sz > 0) wall.rotation.y = Math.PI // 안쪽을 보게
    scene.add(wall)
  }

  /* ── 테이블 ── */
  const topSide = keepM(new THREE.MeshStandardMaterial({ color: 0x0d3f66, roughness: 0.6 }))
  const topFace = keepM(new THREE.MeshStandardMaterial({ map: texTable, roughness: 0.34, metalness: 0.04 }))
  // BoxGeometry 재질 순서: +x, -x, +y, -y, +z, -z → 위(+y)만 라인 텍스처
  const tableTop = new THREE.Mesh(keepG(new THREE.BoxGeometry(TABLE_W, TABLE_THICK, TABLE_LEN)), [
    topSide,
    topSide,
    topFace,
    topSide,
    topSide,
    topSide,
  ])
  tableTop.position.y = TABLE_H - TABLE_THICK / 2
  scene.add(tableTop)

  // 다리 + 가로대
  const legMat = keepM(new THREE.MeshStandardMaterial({ color: 0x161c27, roughness: 0.7, metalness: 0.25 }))
  const legGeo = keepG(new THREE.BoxGeometry(0.06, TABLE_H - TABLE_THICK, 0.06))
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(sx * (TABLE_W / 2 - 0.13), (TABLE_H - TABLE_THICK) / 2, sz * (TABLE_LEN / 2 - 0.2))
      scene.add(leg)
    }
  const beamGeo = keepG(new THREE.BoxGeometry(TABLE_W - 0.3, 0.04, 0.04))
  for (const sz of [-1, 1]) {
    const beam = new THREE.Mesh(beamGeo, legMat)
    beam.position.set(0, 0.36, sz * (TABLE_LEN / 2 - 0.2))
    scene.add(beam)
  }

  /* ── 네트 ── */
  const netW = TABLE_W + NET_OVERHANG * 2
  const net = new THREE.Mesh(
    keepG(new THREE.PlaneGeometry(netW, NET_H)),
    keepM(
      new THREE.MeshBasicMaterial({
        map: texNet,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  )
  net.position.set(0, TABLE_H + NET_H / 2, 0)
  scene.add(net)
  const postGeo = keepG(new THREE.CylinderGeometry(0.012, 0.012, NET_H + 0.03, 10))
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, legMat)
    post.position.set(sx * netW / 2, TABLE_H + (NET_H + 0.03) / 2, 0)
    scene.add(post)
  }

  /* ── 선수 · 라켓 ── */
  const P1_COLOR = 0x2b8fe0 // 가까운쪽(P1) 파랑 — 기존 2D 색 유지
  const P2_COLOR = 0xe2513c // 먼쪽(P2) 빨강
  const p1Paddle = makePaddle(P1_COLOR, -1, posToZ(IDEAL1), mats)
  const p2Paddle = makePaddle(P2_COLOR, 1, posToZ(IDEAL2), mats)
  scene.add(p1Paddle.group, p2Paddle.group)
  const p1Body = makePlayer(P1_COLOR, NEAR_Z + 0.62, -1, mats)
  const p2Body = makePlayer(P2_COLOR, FAR_Z - 0.62, 1, mats)
  scene.add(p1Body, p2Body)

  /* ── 가짜 그림자 (바닥/테이블에 눕힌 그라디언트 판) ── */
  const blobGeo = keepG(new THREE.PlaneGeometry(1, 1))
  const mkBlob = (opacity: number) => {
    const m = new THREE.Mesh(
      blobGeo,
      keepM(
        new THREE.MeshBasicMaterial({
          map: texBlob,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      ),
    )
    m.rotation.x = -Math.PI / 2
    scene.add(m)
    return m
  }
  const ballShadow = mkBlob(0.85)
  const p1Shadow = mkBlob(0.5)
  const p2Shadow = mkBlob(0.5)
  p1Shadow.scale.set(0.9, 0.9, 1)
  p1Shadow.position.set(0, 0.004, NEAR_Z + 0.62)
  p2Shadow.scale.set(0.9, 0.9, 1)
  p2Shadow.position.set(0, 0.004, FAR_Z - 0.62)

  /* ── 공 + 스매시 잔상 ── */
  const ballGeo = keepG(new THREE.SphereGeometry(BALL_R, 22, 16))
  const ball = new THREE.Mesh(
    ballGeo,
    keepM(new THREE.MeshStandardMaterial({ color: 0xfdfdf6, roughness: 0.42, emissive: 0x2a2a22 })),
  )
  scene.add(ball)
  const trail: THREE.Mesh[] = []
  for (let i = 0; i < TRAIL; i++) {
    const m = new THREE.Mesh(
      ballGeo,
      keepM(
        new THREE.MeshBasicMaterial({
          color: 0xff8a5c,
          transparent: true,
          opacity: 0.3 * (1 - i / TRAIL),
          depthWrite: false,
        }),
      ),
    )
    m.visible = false
    m.scale.setScalar(1 - i * 0.13)
    scene.add(m)
    trail.push(m)
  }
  const history: THREE.Vector3[] = Array.from({ length: TRAIL }, () => new THREE.Vector3())

  /* ── 타이밍 링 (공을 감싸는 고리, 카메라를 향해 세운다) ── */
  const ringMat = keepM(
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  )
  const ring = new THREE.Mesh(keepG(new THREE.RingGeometry(BALL_R * 1.9, BALL_R * 2.5, 32)), ringMat)
  ring.visible = false
  scene.add(ring)

  /* ── 카메라 (양 끝에 하나씩) ── */
  const mkCam = (viewer: Viewer) => {
    const c = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60)
    const sign = viewer === 1 ? 1 : -1
    c.position.set(0, CAM_HEIGHT, sign * (TABLE_LEN / 2 + CAM_BACK))
    c.lookAt(0, LOOK_HEIGHT, sign * LOOK_AHEAD)
    return c
  }
  const cams: Record<Viewer, THREE.PerspectiveCamera> = { 1: mkCam(1), 2: mkCam(2) }
  const camHome: Record<Viewer, THREE.Vector3> = {
    1: cams[1].position.clone(),
    2: cams[2].position.clone(),
  }

  let vw = 1
  let vh = 1

  /* ============================================================
     프레임 갱신
     ============================================================ */
  function update(s: FrameState) {
    const prog = flightProgress(s.ballPos, s.ballDir)
    const bx = xToWorld(s.ballX)
    const bz = posToZ(s.ballPos)
    const by = ballY(prog, s.ballSmash)
    ball.position.set(bx, by, bz)
    // 굴러가는 느낌 (진행 방향으로 회전)
    ball.rotation.x += s.ballDir * 0.42
    ball.rotation.y += 0.12

    // 공 그림자 — 테이블 위면 상판에, 코트를 벗어나면 바닥에 떨어진다.
    const overTable = Math.abs(bz) <= TABLE_LEN / 2 && Math.abs(bx) <= TABLE_W / 2
    const groundY = overTable ? TABLE_H + 0.003 : 0.006
    const height = Math.max(0, by - groundY)
    ballShadow.position.set(bx, groundY, bz)
    // 높이 오를수록 크고 옅게 → 공중에 떠 있음이 읽힌다
    const spread = 0.13 + height * 0.42
    ballShadow.scale.set(spread, spread, 1)
    const sm = ballShadow.material as THREE.MeshBasicMaterial
    sm.opacity = clamp(0.9 - height * 0.75, 0.14, 0.9)

    // 라켓
    poseP(p1Paddle, s.p1X, s.p1Swing)
    poseP(p2Paddle, s.p2X, s.p2Swing)

    // 선수 몸통도 공을 좌우로 따라간다 (살짝만)
    p1Body.position.x = xToWorld(lerp(0.5, s.p1X, 0.55))
    p2Body.position.x = xToWorld(lerp(0.5, s.p2X, 0.55))
    p1Shadow.position.x = p1Body.position.x
    p2Shadow.position.x = p2Body.position.x

    // 스매시 잔상
    for (let i = history.length - 1; i > 0; i--) history[i].copy(history[i - 1])
    history[0].set(bx, by, bz)
    const showTrail = s.ballSmash && s.playing
    for (let i = 0; i < trail.length; i++) {
      trail[i].visible = showTrail
      if (showTrail) trail[i].position.copy(history[i])
    }

    // 화면 흔들림 — 카메라를 살짝 튕긴다
    for (const v of [1, 2] as Viewer[]) {
      const home = camHome[v]
      if (s.shake > 0) {
        cams[v].position.set(
          home.x + (Math.random() - 0.5) * SHAKE_AMP * s.shake,
          home.y + (Math.random() - 0.5) * SHAKE_AMP * s.shake,
          home.z,
        )
      } else if (!cams[v].position.equals(home)) {
        cams[v].position.copy(home)
      }
    }
  }

  /**
   * 이 시점에서만 달라지는 것들을 세팅.
   *  - 내 몸은 숨긴다 (카메라가 어깨 뒤라 몸통이 화면을 가림 → 라켓/팔만 보이게)
   *  - 타이밍 링은 "지금 받는 사람" 화면에만 띄운다
   */
  function prepare(viewer: Viewer, s: FrameState) {
    p1Body.visible = viewer !== 1
    p2Body.visible = viewer !== 2
    p1Shadow.visible = viewer !== 1
    p2Shadow.visible = viewer !== 2
    // 내 팔은 숨긴다 — 카메라 바로 앞이라 화면을 덮어버린다 (원본 2D 도 라켓만 그렸다)
    p1Paddle.arm.visible = viewer !== 1
    p2Paddle.arm.visible = viewer !== 2

    const dv = viewerDepth(s.ballPos, viewer)
    const incoming = viewer === 1 ? s.ballDir > 0 : s.ballDir < 0
    const show = s.playing && incoming && !s.ballHit && dv > W1_LO - 0.14
    ring.visible = show
    if (show) {
      const d = Math.abs(dv - IDEAL1)
      const inWin = dv >= W1_LO && dv <= W1_HI
      ringMat.color.setHex(d <= PERFECT_D ? 0xffd24a : inWin ? 0x49e08a : 0xdfe6ec)
      ringMat.opacity = d <= PERFECT_D ? 1 : inWin ? 0.9 : 0.42
      ring.position.copy(ball.position)
      ring.quaternion.copy(cams[viewer].quaternion) // 카메라를 정면으로 바라보게
      const grow = d <= PERFECT_D ? 1.35 : 1
      ring.scale.setScalar(grow)
    }
  }

  function render(s: FrameState) {
    if (s.split) {
      // 좌우 분할 — 기존 2D 와 같은 배치 (왼쪽 = P1 시점, 오른쪽 = P2 시점)
      const halfW = Math.floor(vw / 2)
      renderer.setScissorTest(true)
      const passes: Array<[Viewer, number, number]> = [
        [1, 0, halfW],
        [2, halfW, vw - halfW],
      ]
      for (const [viewer, x, w] of passes) {
        const cam = cams[viewer]
        cam.aspect = w / vh
        cam.updateProjectionMatrix()
        renderer.setViewport(x, 0, w, vh)
        renderer.setScissor(x, 0, w, vh)
        prepare(viewer, s)
        renderer.render(scene, cam)
      }
      renderer.setScissorTest(false)
    } else {
      const cam = cams[s.viewer]
      cam.aspect = vw / vh
      cam.updateProjectionMatrix()
      renderer.setViewport(0, 0, vw, vh)
      prepare(s.viewer, s)
      renderer.render(scene, cam)
    }
  }

  function resize(w: number, h: number, dpr: number) {
    vw = Math.max(1, Math.round(w))
    vh = Math.max(1, Math.round(h))
    renderer.setPixelRatio(dpr)
    renderer.setSize(vw, vh, false)
  }

  function dispose() {
    geos.forEach((g) => g.dispose())
    matsList.forEach((m) => m.dispose())
    texs.forEach((t) => t.dispose())
    renderer.dispose()
  }

  return { update, render, resize, dispose }
}
