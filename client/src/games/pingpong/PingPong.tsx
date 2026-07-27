import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useSwing } from './useSwing'
import OnlineLobby from './OnlineLobby'
import { socket } from '../../net/socket'
import { feedbackShake, feedbackThrow, unlockAudio } from '../../lib/feedback'
import { createScene, type FrameState, type PingPongScene } from './scene3d'
import {
  GOOD_D,
  IDEAL1,
  IDEAL2,
  MISS1,
  MISS2,
  NORMAL_SPEED,
  PERFECT_D,
  SMASH_SPEED,
  W1_HI,
  W1_LO,
  W2_HI,
  W2_LO,
  WEAK_SPEED,
  WIN_SCORE as WIN,
} from './court'

/**
 * PingPong — 타이밍 스매시 탁구 (3D)
 * -------------------------------------------------------------
 * 모드:
 *  - solo: 나(P1) vs 봇(P2). 봇은 공에 맞춰 스윙한다.
 *  - duo : 로컬 2인. 화면을 좌우로 반 나눠 각자 1인칭 시점으로 보여줌.
 *  - online-host / online-guest: 호스트가 시뮬을 돌리고 상태를 중계.
 *
 * 입력(공통): 화면 탭 / 스페이스(P1)·P(P2) / 휴대폰 왕복 스윙(폰 컨트롤러).
 * 정확한 타이밍(노란 링)에 치면 스매시.
 *
 * ── 구조 ──
 *  이 파일 = 규칙·입력·네트워크·UI.   court.ts = 코트 규격·공 궤적(순수).
 *  scene3d.ts = Three.js 무대(규칙을 모름).
 *  깊이는 여전히 pos(0=P2끝 … 1=P1끝) 하나로 다루고, 3D 좌표와 공의 높이는
 *  court.ts 가 pos 에서 계산한다 → 온라인 프로토콜을 그대로 유지할 수 있다.
 */

const BASE_MISS = 0.12
const SMASH_MISS = 0.62
const POINT_COUNTDOWN_MS = 2600 // 득점 후: 플래시 → 3·2·1 → 서브 (준비 시간)
const SWING_MS = 260 // 라켓 스윙 연출 길이
const SHAKE_MS = 190 // 스매시 화면 흔들림 길이

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const rand = (a: number, b: number) => a + Math.random() * (b - a)

type Mode = 'solo' | 'duo' | 'online-host' | 'online-guest'
type Phase = 'ready' | 'playing' | 'point' | 'over'
type LabelKind = 'smash' | 'nice' | 'ok' | 'miss' | 'good' | 'bad'

interface Ball {
  pos: number
  dir: 1 | -1
  speed: number
  smash: boolean
  hit: boolean
  x: number
  x0: number
  x1: number
}
interface GameState {
  w: number
  h: number
  mode: Mode
  phase: Phase
  s1: number
  s2: number
  rally: number
  ball: Ball
  nextServeAt: number
  serveReceiver: number
  p1X: number
  p2X: number
  p1SwingAt: number
  p2SwingAt: number
  flashAt: number
  shakeAt: number
  // 온라인용
  lastBroadcast: number
  fx: { text: string; kind: LabelKind; id: number } | null
  fxId: number
  prevDir: number
  lastFxId: number
  // 콤보(랠리) 표시용
  comboShown: number
  comboId: number
  // 득점 후 카운트다운 (3/2/1, 0이면 표시 안 함)
  countdown: number
}

// 온라인 브로드캐스트 상태 (host → guest)
interface NetState {
  pos: number
  dir: 1 | -1
  speed: number
  smash: boolean
  x0: number
  x1: number
  s1: number
  s2: number
  phase: Phase
  p1X: number
  p2X: number
  rally: number
  countdown: number
  fx: { text: string; kind: LabelKind; id: number } | null
}

function newBall(): Ball {
  return { pos: 0.02, dir: 1, speed: NORMAL_SPEED, smash: false, hit: false, x: 0.5, x0: 0.5, x1: 0.5 }
}

interface PingPongProps {
  onExit: () => void
  phoneConnected?: boolean // 허브에서 연결된 폰 컨트롤러 (있으면 스윙 입력 사용)
}

export default function PingPong({ onExit, phoneConnected = false }: PingPongProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameState>({
    w: 0,
    h: 0,
    mode: 'solo',
    phase: 'ready',
    s1: 0,
    s2: 0,
    rally: 0,
    ball: newBall(),
    nextServeAt: 0,
    serveReceiver: 1,
    p1X: 0.5,
    p2X: 0.5,
    p1SwingAt: -1e9,
    p2SwingAt: -1e9,
    flashAt: -1e9,
    shakeAt: -1e9,
    lastBroadcast: 0,
    fx: null,
    fxId: 0,
    prevDir: 1,
    lastFxId: 0,
    comboShown: 0,
    comboId: 0,
    countdown: 0,
  })
  const swingRef = useRef<(player: number) => void>(() => {})
  const startRef = useRef<(mode: Mode) => void>(() => {})
  const startOnlineRef = useRef<(role: 'host' | 'guest') => void>(() => {})
  const labelTimer = useRef<number | null>(null)

  const sceneRef = useRef<PingPongScene | null>(null)
  const [ui, setUi] = useState({ phase: 'ready' as Phase, s1: 0, s2: 0, mode: 'solo' as Mode })
  const [label, setLabel] = useState<{ text: string; kind: LabelKind } | null>(null)
  const [motionOn, setMotionOn] = useState(false)
  // 득점 후 3·2·1 (3D 캔버스 위에 DOM 으로 얹는다 — 텍스트가 훨씬 선명하다)
  const [countdown, setCountdown] = useState(0)
  // 스매시 순간 화면 전체 섬광 (id 가 바뀌면 CSS 애니메이션 재생)
  const [flashId, setFlashId] = useState(0)
  const [glFailed, setGlFailed] = useState(false)
  const [lobbyOpen, setLobbyOpen] = useState(false)
  const [online, setOnline] = useState<{ role: 'host' | 'guest' } | null>(null)
  const [oppLeft, setOppLeft] = useState(false)
  const [combo, setCombo] = useState<{ count: number; id: number } | null>(null)

  // 모든 입력의 단일 진입점.
  // - online-guest: 로컬 시뮬 대신 서버로 스윙 전송
  // - online-host : 내(호스트=P1) 스윙만. 어떤 키를 눌러도 P1 (상대 라켓 조종 방지)
  // - solo/duo    : player 인자대로 (스페이스=P1, P=P2, 탭은 좌우/전체)
  const input = useCallback((player: number) => {
    const mode = gameRef.current.mode
    if (mode === 'online-guest') {
      socket.emit('pp:swing')
      return
    }
    if (mode === 'online-host') {
      swingRef.current(1)
      return
    }
    swingRef.current(player)
  }, [])

  const { permission, requestPermission } = useSwing({
    onSwing: () => input(1),
    enabled: motionOn,
  })

  // ── 메인 루프 & 로직 ──
  useEffect(() => {
    const g = gameRef.current
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    let scene: PingPongScene
    try {
      scene = createScene(canvas)
    } catch (err) {
      // WebGL 을 못 쓰는 환경 — 게임을 죽이지 말고 안내만 띄운다
      console.error('[pingpong] WebGL 초기화 실패', err)
      setGlFailed(true)
      return
    }
    sceneRef.current = scene

    const commit = () => setUi({ phase: g.phase, s1: g.s1, s2: g.s2, mode: g.mode })
    const showLabel = (text: string, kind: LabelKind) => {
      setLabel({ text, kind })
      g.fx = { text, kind, id: ++g.fxId } // 온라인: 상대 화면에도 같은 팝업 표시용
      if (labelTimer.current) window.clearTimeout(labelTimer.current)
      labelTimer.current = window.setTimeout(() => setLabel(null), 850)
    }
    const baseSpeed = () => NORMAL_SPEED + Math.min(0.35, (g.s1 + g.s2) * 0.02)

    // receiver: 1 → 아래(P1)로 서브, 2 → 위(P2)로 서브
    const serveTo = (receiver: number) => {
      const b = newBall()
      b.speed = baseSpeed()
      if (receiver === 1) {
        b.pos = 0.02
        b.dir = 1
      } else {
        b.pos = 0.98
        b.dir = -1
      }
      b.x = 0.5
      b.x0 = 0.5
      b.x1 = rand(0.3, 0.7)
      g.ball = b
      g.rally = 0
      g.countdown = 0
      g.phase = 'playing'
      commit()
    }

    const start = (mode: Mode) => {
      g.mode = mode
      g.s1 = 0
      g.s2 = 0
      serveTo(1)
    }
    startRef.current = start

    // 온라인 시작: host 는 시뮬 시작(서브), guest 는 상태 수신 대기
    const startOnline = (role: 'host' | 'guest') => {
      g.s1 = 0
      g.s2 = 0
      g.fx = null
      g.fxId = 0
      g.lastFxId = 0
      if (role === 'host') {
        g.mode = 'online-host'
        serveTo(1)
      } else {
        g.mode = 'online-guest'
        g.phase = 'playing'
        commit()
      }
    }
    startOnlineRef.current = startOnline

    // host → guest 로 보낼 권위 상태 직렬화
    const serialize = (): NetState => ({
      pos: g.ball.pos,
      dir: g.ball.dir,
      speed: g.ball.speed,
      smash: g.ball.smash,
      x0: g.ball.x0,
      x1: g.ball.x1,
      s1: g.s1,
      s2: g.s2,
      phase: g.phase,
      p1X: g.p1X,
      p2X: g.p2X,
      rally: g.rally,
      countdown: g.countdown,
      fx: g.fx,
    })

    // who: 1 → P1 득점, 2 → P2 득점. 진 쪽이 다음 서브를 받는다.
    const scorePoint = (who: number) => {
      if (who === 1) g.s1++
      else g.s2++
      if (g.s1 >= WIN || g.s2 >= WIN) {
        g.phase = 'over'
        commit()
        return
      }
      g.phase = 'point'
      g.nextServeAt = performance.now() + POINT_COUNTDOWN_MS
      // 다음 서브 받을 사람 = 진 사람(득점자 반대)
      g.serveReceiver = g.mode === 'solo' ? 1 : who === 1 ? 2 : 1
      commit()
      if (g.mode === 'solo') showLabel(who === 1 ? '득점!' : '실점', who === 1 ? 'good' : 'bad')
      else showLabel(`P${who} 득점!`, 'good')
    }

    // 봇(solo, P2) 자동 리턴/미스
    const botTurn = (now: number) => {
      const b = g.ball
      g.p2SwingAt = now
      const missChance = b.smash ? SMASH_MISS : BASE_MISS + Math.min(0.16, g.rally * 0.012)
      if (Math.random() < missChance) {
        scorePoint(1)
        return
      }
      b.dir = 1
      b.pos = 0
      b.smash = false
      b.hit = false
      b.speed = baseSpeed() * rand(0.95, 1.12)
      b.x0 = b.x
      b.x1 = rand(0.15, 0.85)
      g.rally++
    }

    const returnBall = (player: number, d: number, now: number) => {
      const b = g.ball
      let kind: LabelKind
      if (d <= PERFECT_D) {
        kind = 'smash'
        b.speed = SMASH_SPEED
        b.smash = true
        g.flashAt = now
        g.shakeAt = now
        feedbackThrow()
      } else if (d <= GOOD_D) {
        kind = 'nice'
        b.speed = NORMAL_SPEED
        b.smash = false
        feedbackShake()
      } else {
        kind = 'ok'
        b.speed = WEAK_SPEED
        b.smash = false
        feedbackShake()
      }
      // 방향을 상대 쪽으로 튕기고, "이 구간은 아직 안 침"으로 리셋 → 상대가 받아칠 수 있음.
      // (되받아치기 방지는 dir 가드가 담당: 친 사람은 dir 가 자기 반대라 막힘)
      b.dir = player === 1 ? -1 : 1
      b.hit = false
      b.x0 = b.x
      b.x1 = rand(0.15, 0.85)
      g.rally++
      showLabel(kind === 'smash' ? '스매시! 💥' : kind === 'nice' ? '퍼펙트!' : '굿', kind)
      // 폰 컨트롤러로 "쳤다!" 신호 → 그 폰이 진동/소리
      socket.emit('game:hit', { player, kind })
    }

    const swing = (player: number) => {
      const now = performance.now()
      unlockAudio()
      if (g.phase === 'ready') return // 시작은 오버레이 버튼으로 모드 선택
      if (g.phase === 'over') {
        if (player === 1) start(g.mode) // 로컬/호스트 본인만 재시작 (online-host 도 start 로 재서브)
        return
      }
      if (g.phase !== 'playing') return
      const b = g.ball
      if (player === 1) {
        if (b.dir < 0 || b.hit) return
        g.p1X = b.x
        g.p1SwingAt = now
        if (b.pos < W1_LO) return showLabel('너무 빨라요', 'miss')
        if (b.pos > W1_HI) return showLabel('너무 늦었어요', 'miss')
        returnBall(1, Math.abs(b.pos - IDEAL1), now)
      } else {
        if (g.mode !== 'duo' && g.mode !== 'online-host') return // solo 는 봇
        if (b.dir > 0 || b.hit) return
        g.p2X = b.x
        g.p2SwingAt = now
        if (b.pos > W2_HI) return showLabel('너무 빨라요', 'miss')
        if (b.pos < W2_LO) return showLabel('너무 늦었어요', 'miss')
        returnBall(2, Math.abs(b.pos - IDEAL2), now)
      }
    }
    swingRef.current = swing

    const update = (now: number, dt: number) => {
      if (g.phase === 'point') {
        // 득점 플래시(약 0.8초) 후 3·2·1 카운트다운, 0 되면 서브
        const rem = g.nextServeAt - now
        g.countdown = rem <= 1800 ? Math.max(0, Math.min(3, Math.ceil(rem / 600))) : 0
        if (now >= g.nextServeAt) serveTo(g.serveReceiver ?? 1)
        return
      }
      if (g.phase !== 'playing') return
      const b = g.ball
      b.pos += b.speed * dt * b.dir
      const prog = b.dir > 0 ? clamp(b.pos, 0, 1) : clamp(1 - b.pos, 0, 1)
      b.x = lerp(b.x0, b.x1, prog)
      if (b.dir > 0) g.p1X = lerp(g.p1X, b.x, 0.12)
      else g.p2X = lerp(g.p2X, b.x, 0.12)

      if (b.dir > 0 && b.pos >= MISS1) return scorePoint(2) // P1 놓침 → P2 득점
      if (g.mode === 'solo') {
        if (b.dir < 0 && b.pos <= 0) botTurn(now)
      } else {
        if (b.dir < 0 && b.pos <= MISS2) scorePoint(1) // P2 놓침 → P1 득점
      }
    }

    /** 게임 상태 → 렌더러가 이해하는 프레임 (렌더러는 규칙을 모른다) */
    const frameState = (now: number): FrameState => {
      const b = g.ball
      const sw = (at: number) => (now - at < SWING_MS ? 1 - (now - at) / SWING_MS : 0)
      return {
        split: g.mode === 'duo',
        viewer: g.mode === 'online-guest' ? 2 : 1,
        playing: g.phase === 'playing',
        ballPos: b.pos,
        ballDir: b.dir,
        ballX: b.x,
        ballSmash: b.smash,
        ballHit: b.hit,
        p1X: g.p1X,
        p2X: g.p2X,
        p1Swing: sw(g.p1SwingAt),
        p2Swing: sw(g.p2SwingAt),
        shake: now - g.shakeAt < SHAKE_MS ? 1 - (now - g.shakeAt) / SHAKE_MS : 0,
      }
    }

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      g.w = rect.width
      g.h = rect.height
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      scene.resize(rect.width, rect.height, dpr)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()

    // 콤보(랠리) 표시: 2인(로컬/온라인)에서만. rally 가 오를 때마다 팝, 라운드 리셋 시 사라짐.
    const syncCombo = () => {
      const twoPlayer =
        g.mode === 'duo' || g.mode === 'online-host' || g.mode === 'online-guest'
      if (!twoPlayer) {
        g.comboShown = g.rally
        return
      }
      if (g.rally > g.comboShown) {
        g.comboShown = g.rally
        setCombo({ count: g.rally, id: ++g.comboId })
      } else if (g.rally < g.comboShown) {
        g.comboShown = g.rally
        setCombo(null)
      }
    }

    // 캔버스 밖(DOM)으로 내보내는 값들 — 바뀔 때만 setState 해서 리렌더를 아낀다
    let shownCountdown = -1
    let shownFlashAt = -1
    const syncOverlays = () => {
      if (g.countdown !== shownCountdown) {
        shownCountdown = g.countdown
        setCountdown(g.countdown)
      }
      if (g.flashAt !== shownFlashAt) {
        shownFlashAt = g.flashAt
        setFlashId((n) => n + 1)
      }
    }

    let raf = 0
    let last = performance.now()
    const frame = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (g.mode === 'online-guest') {
        // 게스트: 시뮬 안 함. 상태 수신 사이엔 공만 진행(추측항법)해 부드럽게, 수신 시 스냅
        if (g.phase === 'playing') {
          const b = g.ball
          b.pos += b.speed * dt * b.dir
          const prog = b.dir > 0 ? clamp(b.pos, 0, 1) : clamp(1 - b.pos, 0, 1)
          b.x = lerp(b.x0, b.x1, prog)
        }
      } else {
        update(now, dt)
        if (g.mode === 'online-host' && now - g.lastBroadcast > 33) {
          g.lastBroadcast = now
          socket.emit('pp:state', serialize())
        }
      }
      const fs = frameState(now)
      scene.update(fs)
      scene.render(fs)
      syncCombo()
      syncOverlays()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      sceneRef.current = null
      scene.dispose()
    }
  }, [])

  // 키보드: 스페이스=P1, P=P2 (꾹 누름 연타 방지)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Space') {
        e.preventDefault()
        input(1)
      } else if (e.code === 'KeyP') {
        e.preventDefault()
        input(2)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 폰 컨트롤러: 페어링·게임알림(disp:game)은 App 이 담당 → 여기선 스윙 입력만 받는다.
  useEffect(() => {
    const onSwing = (p?: { player?: number }) => {
      if (gameRef.current.mode.startsWith('online')) return // 온라인 땐 폰컨트롤러 무시
      swingRef.current(p?.player ?? 1)
    }
    socket.on('ctrl:swing', onSwing)
    return () => {
      socket.off('ctrl:swing', onSwing)
    }
  }, [])

  // 온라인 매치: 상태 수신(게스트) / 스윙 수신(호스트) / 상대 이탈
  useEffect(() => {
    const onState = (s: NetState) => {
      const g = gameRef.current
      if (g.mode !== 'online-guest') return
      const b = g.ball
      if (g.prevDir > 0 && s.dir < 0) g.p1SwingAt = performance.now() // 상대(호스트) 타격 모션
      if (g.prevDir < 0 && s.dir > 0) g.p2SwingAt = performance.now() // 내 타격 반영
      g.prevDir = s.dir
      b.pos = s.pos
      b.dir = s.dir
      b.speed = s.speed
      b.smash = s.smash
      b.x0 = s.x0
      b.x1 = s.x1
      const changed = g.s1 !== s.s1 || g.s2 !== s.s2 || g.phase !== s.phase
      g.s1 = s.s1
      g.s2 = s.s2
      g.phase = s.phase
      g.p1X = s.p1X
      g.p2X = s.p2X
      g.rally = s.rally ?? 0
      g.countdown = s.countdown ?? 0
      if (s.fx && s.fx.id !== g.lastFxId) {
        g.lastFxId = s.fx.id
        setLabel({ text: s.fx.text, kind: s.fx.kind })
        if (labelTimer.current) window.clearTimeout(labelTimer.current)
        labelTimer.current = window.setTimeout(() => setLabel(null), 850)
        if (s.fx.kind === 'smash') {
          g.flashAt = performance.now()
          g.shakeAt = performance.now()
        }
      }
      if (changed) setUi({ phase: s.phase, s1: s.s1, s2: s.s2, mode: 'online-guest' })
    }
    const onSwing = () => {
      if (gameRef.current.mode === 'online-host') swingRef.current(2)
    }
    const onLeft = () => setOppLeft(true)
    socket.on('pp:state', onState)
    socket.on('pp:swing', onSwing)
    socket.on('pp:left', onLeft)
    return () => {
      socket.off('pp:state', onState)
      socket.off('pp:swing', onSwing)
      socket.off('pp:left', onLeft)
    }
  }, [])

  const enableMotion = useCallback(async () => {
    unlockAudio()
    await requestPermission()
    setMotionOn(true)
  }, [requestPermission])

  // 탭 위치로 P1/P2 구분 (duo). solo 는 항상 P1.
  const onTap = (e: ReactPointerEvent) => {
    if (ui.mode === 'duo') {
      const rect = e.currentTarget.getBoundingClientRect()
      const left = e.clientX - rect.left < rect.width / 2
      input(left ? 1 : 2) // 왼쪽=P1, 오른쪽=P2
    } else {
      input(1)
    }
  }

  const labelColor: Record<LabelKind, string> = {
    smash: '#ff7a4d',
    nice: '#ffd24a',
    ok: '#49e08a',
    miss: '#9aa4b0',
    good: '#49e08a',
    bad: '#ff6b6b',
  }
  const l1 =
    ui.mode === 'solo' ? 'YOU' : ui.mode === 'duo' ? 'P1' : ui.mode === 'online-host' ? '나' : '상대'
  const l2 =
    ui.mode === 'solo' ? 'CPU' : ui.mode === 'duo' ? 'P2' : ui.mode === 'online-host' ? '상대' : '나'

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0a0e16] text-white select-none">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-4 py-2.5 z-10">
        <button onClick={onExit} className="text-sm text-white/70 hover:text-white">
          ‹ 게임 선택
        </button>
        <div className="text-center">
          {online ? (
            <span className="text-xs text-white/60">
              온라인 · {online.role === 'host' ? '내가 방장' : '참가'}
            </span>
          ) : phoneConnected ? (
            <span className="text-xs text-[#49e08a]">📱 폰 연결됨 🟢</span>
          ) : (
            <span className="label-mono text-white/40">PING · PONG</span>
          )}
        </div>
        <button
          onClick={enableMotion}
          className={`text-xs rounded-full px-3 py-1 border ${
            permission === 'granted' ? 'border-[#49e08a]/50 text-[#49e08a]' : 'border-white/20 text-white/70'
          }`}
        >
          {permission === 'granted' ? '📳 스윙 ON' : '📳 폰 스윙'}
        </button>
      </div>

      {/* 점수 */}
      <div className="flex items-center justify-center gap-6 pb-1 z-10">
        <Score label={l1} value={ui.s1} color="#2b8fe0" />
        <span className="text-white/30 text-xl font-black">:</span>
        <Score label={l2} value={ui.s2} color="#e2513c" />
      </div>

      {/* 3D 스테이지 */}
      <div ref={containerRef} onPointerDown={onTap} className="relative flex-1 cursor-pointer overflow-hidden">
        <canvas ref={canvasRef} className="block" />

        {/* 2인 좌우 분할 — 가운데 경계선 + 각자 라벨 */}
        {ui.mode === 'duo' && ui.phase !== 'ready' && (
          <>
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/20 pointer-events-none" />
            <span className="absolute top-2 left-3 label-mono text-[#2b8fe0] pointer-events-none">
              ◀ P1
            </span>
            <span className="absolute top-2 right-3 label-mono text-[#e2513c] pointer-events-none">
              P2 ▶
            </span>
          </>
        )}

        {/* 스매시 섬광 (id 가 바뀔 때마다 다시 재생) */}
        {flashId > 0 && (
          <div
            key={flashId}
            className="pointer-events-none absolute inset-0 animate-pp-flash"
            style={{ background: 'radial-gradient(circle at 50% 55%, rgba(255,150,110,0.5), rgba(255,90,60,0) 70%)' }}
          />
        )}

        {/* 득점 후 3·2·1 */}
        {countdown > 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-semibold text-white/70 mb-1">다음 랠리 준비</span>
            <span
              key={countdown}
              className="text-[14vh] leading-none font-black animate-combo-hit"
              style={{ color: 'rgba(255,255,255,0.82)', textShadow: '0 6px 30px rgba(0,0,0,0.75)' }}
            >
              {countdown}
            </span>
          </div>
        )}

        {/* WebGL 을 못 쓰는 기기 안내 */}
        {glFailed && (
          <Overlay>
            <div className="text-5xl mb-2">🧩</div>
            <h2 className="text-xl font-black mb-1">3D를 띄울 수 없어요</h2>
            <p className="text-white/60 mb-6 text-sm text-center leading-relaxed">
              이 브라우저에서 WebGL 이 꺼져 있거나 지원되지 않습니다.
              <br />
              다른 브라우저(크롬/사파리 최신)로 열어보세요.
            </p>
            <PrimaryButton onClick={onExit}>게임 선택으로</PrimaryButton>
          </Overlay>
        )}

        {label && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              className="text-4xl sm:text-5xl font-black animate-combo-pop"
              style={{ color: labelColor[label.kind], textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}
            >
              {label.text}
            </span>
          </div>
        )}

        {combo && combo.count >= 1 && <ComboBadge key={combo.id} count={combo.count} />}

        {ui.phase === 'ready' && !lobbyOpen && !online && (
          <Overlay>
            <div className="text-5xl mb-2">🏓</div>
            <h1 className="text-2xl font-black mb-1">핑퐁 스매시</h1>
            <p className="text-white/60 text-sm mb-6 text-center leading-relaxed">
              날아오는 공을 타이밍 맞춰 받아치기.
              <br />
              정확한 순간 = <b className="text-[#ff7a4d]">스매시!</b>
            </p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <PrimaryButton onClick={() => startRef.current('solo')}>1인 · 봇과 대결</PrimaryButton>
              <button
                onClick={() => startRef.current('duo')}
                className="px-6 py-3 rounded-2xl bg-white/10 active:bg-white/20 text-white font-bold"
              >
                2인 · 로컬 대전 (화면 반반)
              </button>
              <button
                onClick={() => setLobbyOpen(true)}
                className="px-6 py-3 rounded-2xl bg-[#49e08a]/20 border border-[#49e08a]/40 active:bg-[#49e08a]/30 text-[#49e08a] font-bold"
              >
                🌐 온라인 대전 (방 코드)
              </button>
            </div>
          </Overlay>
        )}

        {lobbyOpen && (
          <OnlineLobby
            onMatched={(role) => {
              setLobbyOpen(false)
              setOnline({ role })
              startOnlineRef.current(role)
            }}
            onCancel={() => setLobbyOpen(false)}
          />
        )}

        {oppLeft && (
          <Overlay>
            <div className="text-5xl mb-2">🔌</div>
            <h2 className="text-xl font-black mb-1">상대가 나갔어요</h2>
            <p className="text-white/60 mb-6 text-sm">연결이 끊어졌습니다.</p>
            <PrimaryButton onClick={onExit}>게임 선택으로</PrimaryButton>
          </Overlay>
        )}

        {ui.phase === 'over' && !oppLeft && (
          <Overlay>
            {(() => {
              const myWin =
                ui.mode === 'online-guest' ? ui.s2 > ui.s1 : ui.s1 > ui.s2
              const title =
                ui.mode === 'solo' || ui.mode.startsWith('online')
                  ? myWin
                    ? '승리!'
                    : '패배'
                  : `P${ui.s1 > ui.s2 ? 1 : 2} 승리!`
              return (
                <>
                  <div className="text-5xl mb-2">{myWin ? '🏆' : '😢'}</div>
                  <h2 className="text-2xl font-black mb-1">{title}</h2>
                  <p className="text-white/70 mb-6">
                    {ui.s1} : {ui.s2}
                  </p>
                  {ui.mode === 'online-guest' ? (
                    <p className="text-white/50 text-sm">상대(방장)가 다시 시작하길 기다리는 중…</p>
                  ) : (
                    <PrimaryButton onClick={() => startRef.current(ui.mode)}>다시 하기</PrimaryButton>
                  )}
                  <button onClick={onExit} className="mt-3 text-sm text-white/50 underline">
                    다른 게임 고르기
                  </button>
                </>
              )
            })()}
          </Overlay>
        )}
      </div>

      {/* 하단 힌트 */}
      <div className="text-center text-[11px] text-white/40 py-2 z-10">
        {ui.mode === 'duo'
          ? '⌨️ P1 = 스페이스 · P2 = P  (또는 폰 2대로 각자 스윙)'
          : '화면 탭 / 스페이스 / 폰 스윙 · 초록 링=성공, 노란 링=스매시'}
      </div>
    </div>
  )
}

function ComboBadge({ count }: { count: number }) {
  const tier =
    count >= 8
      ? { color: '#ff7a4d', size: 'text-7xl', glow: '0 0 24px rgba(255,122,77,0.6)' }
      : count >= 5
        ? { color: '#ffd24a', size: 'text-6xl', glow: '0 0 20px rgba(255,210,74,0.55)' }
        : count >= 3
          ? { color: '#49e08a', size: 'text-5xl', glow: '0 0 16px rgba(73,224,138,0.5)' }
          : { color: '#ffffff', size: 'text-5xl', glow: '0 2px 10px rgba(0,0,0,0.5)' }
  return (
    <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 text-center">
      <div className="animate-combo-hit leading-none" style={{ color: tier.color, textShadow: tier.glow }}>
        <span className={`${tier.size} font-black tabular-nums`}>{count}</span>
        <span className="text-lg font-black ml-1 tracking-widest align-super">COMBO</span>
      </div>
    </div>
  )
}

function Score({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className="label-mono text-white/50">{label}</div>
      <div className="text-4xl font-black tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  )
}
function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0e16]/85 backdrop-blur-sm px-6">
      {children}
    </div>
  )
}
function PrimaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-6 py-3 rounded-2xl bg-[#2b8fe0] active:brightness-95 text-white font-bold shadow-lg"
    >
      {children}
    </button>
  )
}
