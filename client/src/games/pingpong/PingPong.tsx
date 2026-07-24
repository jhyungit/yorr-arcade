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

/**
 * PingPong — 타이밍 스매시 탁구
 * -------------------------------------------------------------
 * 모드:
 *  - solo: 나(P1) vs 봇(P2). 봇은 "라켓 쥔 사람"이 공에 맞춰 스윙하는 모션.
 *  - duo : 로컬 2인. 화면을 위/아래로 반 나눠 각자 시점(자기 라켓이 아래쪽)으로 보여줌.
 *
 * 입력(공통): 화면 탭 / 스페이스(P1)·엔터(P2) / 휴대폰 왕복 스윙(폰 컨트롤러).
 * 정확한 타이밍(노란 링)에 치면 스매시.
 */

const WIN = 11
// 타이밍 (pos: 0=위(P2쪽), 1=아래(P1쪽))
const IDEAL1 = 0.9
const W1_LO = 0.72
const W1_HI = 1.06
const MISS1 = 1.1
const IDEAL2 = 0.1
const W2_LO = -0.06
const W2_HI = 0.28
const MISS2 = -0.1
const PERFECT_D = 0.06
const GOOD_D = 0.16
// 속도 (pos/sec)
const NORMAL_SPEED = 1.0
const SMASH_SPEED = 1.95
const WEAK_SPEED = 0.82
const BASE_MISS = 0.12
const SMASH_MISS = 0.62
const POINT_COUNTDOWN_MS = 2600 // 득점 후: 플래시 → 3·2·1 → 서브 (준비 시간)

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

  const [ui, setUi] = useState({ phase: 'ready' as Phase, s1: 0, s2: 0, mode: 'solo' as Mode })
  const [label, setLabel] = useState<{ text: string; kind: LabelKind } | null>(null)
  const [motionOn, setMotionOn] = useState(false)
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
    const ctx = canvas.getContext('2d')
    if (!ctx) return

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

    // ── 한 시점(viewer=1 아래/P1, 2 위/P2)으로 테이블+공+선수 그리기 ──
    const drawScene = (
      rx: number,
      ry: number,
      rw: number,
      rh: number,
      viewer: number,
      now: number,
    ) => {
      const topY = ry + rh * 0.1
      const botY = ry + rh * 0.95
      const halfTop = rw * 0.17
      const halfBot = rw * 0.42
      const cx = rx + rw / 2
      const P = (depth: number, xn: number) => ({
        x: cx + (xn - 0.5) * 2 * lerp(halfTop, halfBot, clamp(depth, 0, 1)),
        y: lerp(topY, botY, depth),
      })
      const b = g.ball
      // 이 시점 기준 깊이/좌우 (viewer2 는 상하·좌우 반전)
      const dv = viewer === 1 ? b.pos : 1 - b.pos
      const xv = (x: number) => (viewer === 1 ? x : 1 - x)
      const nearX = viewer === 1 ? g.p1X : g.p2X
      const farX = viewer === 1 ? g.p2X : g.p1X
      const nearColor = viewer === 1 ? '#2b8fe0' : '#e2513c'
      const farColor = viewer === 1 ? '#e2513c' : '#2b8fe0'
      const nearSwingAt = viewer === 1 ? g.p1SwingAt : g.p2SwingAt
      const farSwingAt = viewer === 1 ? g.p2SwingAt : g.p1SwingAt
      const receiving = (viewer === 1 && b.dir > 0) || (viewer === 2 && b.dir < 0)

      // 테이블
      const tl = P(0, 0)
      const tr = P(0, 1)
      const br = P(1, 1)
      const bl = P(1, 0)
      ctx.beginPath()
      ctx.moveTo(tl.x, tl.y)
      ctx.lineTo(tr.x, tr.y)
      ctx.lineTo(br.x, br.y)
      ctx.lineTo(bl.x, bl.y)
      ctx.closePath()
      const tg = ctx.createLinearGradient(0, topY, 0, botY)
      tg.addColorStop(0, '#12639e')
      tg.addColorStop(1, '#1c86cf')
      ctx.fillStyle = tg
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = 24
      ctx.shadowOffsetY = 10
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 2.5
      ctx.stroke()
      // 센터 라인 + 네트
      const c0 = P(0, 0.5)
      const c1 = P(1, 0.5)
      ctx.beginPath()
      ctx.moveTo(c0.x, c0.y)
      ctx.lineTo(c1.x, c1.y)
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      const nL = P(0.5, -0.05)
      const nR = P(0.5, 1.05)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(nL.x, nL.y)
      ctx.lineTo(nR.x, nR.y)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.fillRect(nL.x, nL.y - 9, nR.x - nL.x, 9)

      // 먼 쪽 선수 (사람 피겨) — 공이 다가오면 라켓 들고, 스윙 시각이면 휘두름
      const farAntic =
        !receiving && dv < 0.5 ? clamp(1 - dv / 0.45, 0, 1) : 0 // 공이 먼 선수에게 갈 때
      const farP = P(0.02, xv(farX))
      const farSwing = now - farSwingAt < 220 ? 1 - (now - farSwingAt) / 220 : 0
      drawPerson(ctx, farP.x, farP.y, 1, farColor, farAntic, farSwing)

      // 가까운 쪽 라켓 (크게)
      const nearP = P(0.97, xv(nearX))
      const nearSwing = now - nearSwingAt < 200 ? 1 - (now - nearSwingAt) / 200 : 0
      drawPaddle(ctx, nearP.x, nearP.y, 1.35, nearColor, nearSwing)

      // 공 + 그림자
      const bp = P(dv, xv(b.x))
      const r = lerp(6, 18, clamp(dv, 0, 1))
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath()
      ctx.ellipse(bp.x, bp.y + r * 0.9, r * 1.1, r * 0.5, 0, 0, Math.PI * 2)
      ctx.fill()
      if (b.smash) {
        ctx.fillStyle = 'rgba(255,90,60,0.22)'
        for (let t = 1; t <= 3; t++) {
          const back = dv - (viewer === 1 ? -1 : 1) * 0 // 잔상은 진행 반대
          void back
          const gp = P(clamp(dv + 0.05 * t * (b.dir > 0 ? (viewer === 1 ? -1 : 1) : viewer === 1 ? 1 : -1), 0, 1), xv(b.x))
          ctx.beginPath()
          ctx.arc(gp.x, gp.y, r * (1 - t * 0.18), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // 타이밍 링
      if (receiving && !b.hit && dv > W1_LO - 0.12) {
        const d = Math.abs(dv - IDEAL1)
        const inWin = dv >= W1_LO && dv <= W1_HI
        ctx.strokeStyle = d <= PERFECT_D ? '#ffd24a' : inWin ? '#49e08a' : 'rgba(255,255,255,0.35)'
        ctx.lineWidth = d <= PERFECT_D ? 4 : 2.5
        ctx.beginPath()
        ctx.arc(bp.x, bp.y, r + 9, 0, Math.PI * 2)
        ctx.stroke()
      }
      const ball = ctx.createRadialGradient(bp.x - r * 0.3, bp.y - r * 0.3, r * 0.2, bp.x, bp.y, r)
      ball.addColorStop(0, '#ffffff')
      ball.addColorStop(1, '#dfe6ec')
      ctx.fillStyle = ball
      ctx.beginPath()
      ctx.arc(bp.x, bp.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    const render = (now: number) => {
      const { w, h } = g
      if (w === 0 || h === 0) return
      const bg = ctx.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#0f1622')
      bg.addColorStop(1, '#0a0e16')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      let ox = 0
      let oy = 0
      if (now - g.shakeAt < 160) {
        const k = (1 - (now - g.shakeAt) / 160) * 7
        ox = (Math.random() - 0.5) * k
        oy = (Math.random() - 0.5) * k
      }
      ctx.save()
      ctx.translate(ox, oy)
      if (g.mode === 'duo') {
        // 세로 분할: 왼쪽=P1 시점, 오른쪽=P2 시점 (각자 1인칭, 상대는 사람 피겨)
        drawScene(0, 0, w / 2, h, 1, now)
        drawScene(w / 2, 0, w / 2, h, 2, now)
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(w / 2, 0)
        ctx.lineTo(w / 2, h)
        ctx.stroke()
      } else if (g.mode === 'online-guest') {
        drawScene(0, 0, w, h, 2, now) // 게스트=P2, 자기 시점(아래)
      } else {
        drawScene(0, 0, w, h, 1, now) // solo / online-host = P1 시점
      }
      ctx.restore()

      // 득점 후 3·2·1 카운트다운
      if (g.countdown > 0) {
        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,0.55)'
        ctx.shadowBlur = 24
        ctx.fillStyle = 'rgba(255,255,255,0.75)'
        ctx.font = `600 ${Math.round(h * 0.035)}px system-ui, sans-serif`
        ctx.fillText('다음 랠리 준비', w / 2, h / 2 - h * 0.11)
        ctx.fillStyle = '#ffffff'
        ctx.font = `900 ${Math.round(h * 0.18)}px system-ui, sans-serif`
        ctx.fillText(String(g.countdown), w / 2, h / 2)
        ctx.restore()
      }

      if (now - g.flashAt < 140) {
        ctx.fillStyle = `rgba(255,120,80,${0.35 * (1 - (now - g.flashAt) / 140)})`
        ctx.fillRect(0, 0, w, h)
      }
    }

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      g.w = rect.width
      g.h = rect.height
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
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
        render(now)
      } else {
        update(now, dt)
        render(now)
        if (g.mode === 'online-host' && now - g.lastBroadcast > 33) {
          g.lastBroadcast = now
          socket.emit('pp:state', serialize())
        }
      }
      syncCombo()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
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

      {/* 캔버스 스테이지 */}
      <div ref={containerRef} onPointerDown={onTap} className="relative flex-1 cursor-pointer">
        <canvas ref={canvasRef} className="block" />

        {/* 2인 세로 분할 표시 (반반인지 한눈에) */}
        {ui.mode === 'duo' && ui.phase !== 'ready' && (
          <>
            <span className="absolute top-2 left-3 label-mono text-[#2b8fe0] pointer-events-none">
              ◀ P1
            </span>
            <span className="absolute top-2 right-3 label-mono text-[#e2513c] pointer-events-none">
              P2 ▶
            </span>
          </>
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

/** 라켓 (크게). swing 0~1 이면 휘두르는 연출 */
function drawPaddle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
  swing: number,
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((-0.4 + swing * 0.9) * 0.6)
  ctx.scale(scale * (1 + swing * 0.2), scale * (1 + swing * 0.2))
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(0, 0, 20, 24, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 2.5
  ctx.stroke()
  // 손잡이
  ctx.fillStyle = '#2b2620'
  ctx.fillRect(-4, 20, 8, 16)
  ctx.restore()
}

/** 라켓 쥔 사람 (먼 쪽 상대). raise=공 다가옴 반응, swing=휘두름 */
function drawPerson(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
  raise: number,
  swing: number,
) {
  ctx.save()
  ctx.translate(x, y - 8 * scale)
  ctx.scale(scale, scale)
  // 몸통
  ctx.fillStyle = '#3a4658'
  ctx.beginPath()
  ctx.roundRect(-13, 2, 26, 30, 10)
  ctx.fill()
  // 머리
  ctx.fillStyle = '#e9c9a8'
  ctx.beginPath()
  ctx.arc(0, -8, 9, 0, Math.PI * 2)
  ctx.fill()
  // 팔 + 라켓 (준비→들기→스윙)
  const armAngle = -0.5 - raise * 0.6 - swing * 1.3
  ctx.save()
  ctx.translate(10, 6)
  ctx.rotate(armAngle)
  ctx.strokeStyle = '#e9c9a8'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(16, 0)
  ctx.stroke()
  // 라켓 헤드
  ctx.translate(20, 0)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(0, 0, 11, 13, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
  ctx.restore()
}

/** 랠리 콤보 임팩트. 콤보가 오를수록 커지고 색이 뜨거워진다(화이트→라임→골드→코랄). */
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
