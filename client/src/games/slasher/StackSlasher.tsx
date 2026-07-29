import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  FEVER_MS,
  FEVER_MULT,
  GAME_MS,
  GOLDEN_MULT,
  LEAD_IN_MS,
  RUSH_MS,
  STACK_SCORE,
  TRAP_PENALTY,
  swipeMultiplier,
  type GameObject,
  type Phase,
  type Piece,
  type Popup,
  type RunResult,
  type Spark,
} from './types'
import {
  gravity,
  isGone,
  makeSparks,
  pointSegDist,
  segHitsObject,
  sliceObject,
  spawnInterval,
  spawnOne,
  stepObject,
  stepPiece,
  stepSpark,
  waveSize,
} from './engine'
import { drawGlyph, objectColor } from './logos'
import { STACKS_BY_CATEGORY, CATEGORIES } from './stacks'
import { categoryCounts, decideVerdict } from './verdict'
import { canVibrate } from '../../lib/feedback'
import { socket } from '../../net/socket'

/**
 * StackSlasher — 기술스택 슬래셔 (Fruit-Ninja 감성, 완전 클라이언트)
 * -------------------------------------------------------------
 * 아래에서 날아오르는 기술 로고를 스와이프(광선검)로 벤다. 60초 타임어택.
 *  - 스택 = +점수 & 컬렉션 수집 / 함정 = 감점·콤보 리셋 / 보너스 = 황금(×3)·커피(피버).
 *  - 한 스와이프에 여러 개 = 콤보 배수. 마지막에 "터득한 스택"으로 개발자 유형 판정.
 * 게임 루프·오브젝트는 gameRef(ref)에 두고, UI 노출값만 React state 로 반영.
 * 디자인 정체성: 딥 네이비 + 시안→마젠타 네온 블레이드 (다른 게임들과 구분되는 톤).
 */

const MAX_OBJECTS = 11 // 동시 오브젝트 상한
const TRAIL_MS = 150 // 블레이드 잔상 유지 시간
const BEST_KEY = 'slasher.best'

const BLADE_A = '#22d3ee' // 시안
const BLADE_B = '#e935c1' // 마젠타

interface TrailPoint {
  x: number
  y: number
  t: number
}

interface Runtime {
  w: number
  h: number
  phase: Phase
  playStartAt: number // 카운트인 끝 = 곡 0ms. songTime = now - playStartAt
  nextSpawnAt: number
  lastFrame: number
  lastCommit: number
  objects: GameObject[]
  pieces: Piece[]
  sparks: Spark[]
  popups: Popup[]
  score: number
  combo: number // 진행 콤보(스택 연속), 함정에 리셋
  maxCombo: number
  feverUntil: number
  collected: Record<string, number>
  trapsSliced: number
  // 스와이프(포인터 down~up) 단위 누적 — 배수 계산용
  down: boolean
  lastX: number
  lastY: number
  trail: TrailPoint[]
  swipeSlices: number
  swipeBase: number
  swipeAwarded: number
  // 연출
  shake: number
  flash: number
}

function makeRuntime(): Runtime {
  return {
    w: 0,
    h: 0,
    phase: 'ready',
    playStartAt: 0,
    nextSpawnAt: 0,
    lastFrame: 0,
    lastCommit: 0,
    objects: [],
    pieces: [],
    sparks: [],
    popups: [],
    score: 0,
    combo: 0,
    maxCombo: 0,
    feverUntil: 0,
    collected: {},
    trapsSliced: 0,
    down: false,
    lastX: 0,
    lastY: 0,
    trail: [],
    swipeSlices: 0,
    swipeBase: 0,
    swipeAwarded: 0,
    shake: 0,
    flash: 0,
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const comboColor = (n: number) => (n >= 4 ? '#ec4899' : n >= 3 ? '#a855f7' : '#22d3ee')

// 시작 화면의 'START' 슬래시 타깃 (상단 중앙). 폰 모션 블레이드로 이걸 베면 시작.
const startTarget = (w: number, h: number) => ({
  x: w / 2,
  y: h * 0.26,
  r: Math.max(52, Math.min(w, h) * 0.15),
})

export default function StackSlasher({ onExit }: { onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Runtime>(makeRuntime())
  const audioRef = useRef<Fx | null>(null)
  const startRef = useRef<() => void>(() => {})
  const vibeRef = useRef(true)
  // 포인터 핸들러 브리지 (JSX → effect 내부 함수)
  const downRef = useRef<(x: number, y: number) => void>(() => {})
  const moveRef = useRef<(x: number, y: number) => void>(() => {})
  const upRef = useRef<() => void>(() => {})
  // 폰 모션 조준(ctrl:aim) 상태: 최신/직전 위치 + 스트로크 진행 여부
  const aimRef = useRef({ x: 0, y: 0, px: 0, py: 0, t: 0, moving: false, has: false })
  // 폰 모션 컨트롤러가 조준 중인가 (렌더 루프용 ref + 오버레이 전환용 state)
  const motionRef = useRef(false)
  const [motionMode, setMotionMode] = useState(false)

  const [ui, setUi] = useState({
    phase: 'ready' as Phase,
    score: 0,
    combo: 0,
    timeLeftMs: GAME_MS,
    fever: false,
  })
  const [result, setResult] = useState<RunResult | null>(null)
  const [best, setBest] = useState(() => {
    const v = Number(localStorage.getItem(BEST_KEY) || 0)
    return Number.isFinite(v) ? v : 0
  })
  const [vibeOn, setVibeOn] = useState(true)
  useEffect(() => {
    vibeRef.current = vibeOn
  }, [vibeOn])

  // ── 게임 루프 & 로직 (마운트 시 1회 구성) ──
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const g = gameRef.current

    const vibe = (p: number | number[]) => {
      if (vibeRef.current && canVibrate()) navigator.vibrate(p)
    }

    const commit = () => {
      const now = performance.now()
      g.lastCommit = now
      const left = g.phase === 'playing' ? clamp(GAME_MS - (now - g.playStartAt), 0, GAME_MS) : GAME_MS
      setUi({ phase: g.phase, score: g.score, combo: g.combo, timeLeftMs: left, fever: now < g.feverUntil })
    }

    const popup = (x: number, y: number, text: string, color: string, sub?: string) => {
      g.popups.push({ x, y: y - 6, vy: -g.h * 0.05, life: 1, text, sub, color })
    }

    // 한 오브젝트를 벰 → 파편·스파크·점수 처리
    const sliceHit = (o: GameObject, angle: number) => {
      o.sliced = true
      const [p1, p2] = sliceObject(o, angle, g.h)
      g.pieces.push(p1, p2)
      const col = objectColor(o.kind, o.defId, o.goldenStackId)
      const now = performance.now()

      if (o.kind === 'trap') {
        g.score = Math.max(0, g.score - TRAP_PENALTY)
        g.combo = 0
        g.trapsSliced++
        g.shake = Math.max(g.shake, 18)
        g.flash = 0.6
        g.sparks.push(...makeSparks(o.x, o.y, '#ef4444', 16, g.h))
        audioRef.current?.trap()
        vibe([0, 50, 30, 80])
        popup(o.x, o.y, `-${TRAP_PENALTY}`, '#f87171', '함정!')
        commit()
        return
      }

      if (o.kind === 'bonus' && o.defId === 'coffee') {
        g.feverUntil = now + FEVER_MS
        g.sparks.push(...makeSparks(o.x, o.y, '#fbbf24', 20, g.h))
        audioRef.current?.fever()
        vibe(35)
        popup(o.x, o.y, 'FEVER!', '#fbbf24', '점수 ×2')
        commit()
        return
      }

      // 스택 또는 황금 스택
      const golden = o.kind === 'bonus' && o.defId === 'golden'
      const stackId = golden ? o.goldenStackId ?? o.defId : o.defId
      const base = STACK_SCORE * (golden ? GOLDEN_MULT : 1)
      g.swipeSlices++
      g.swipeBase += base
      g.combo++
      g.maxCombo = Math.max(g.maxCombo, g.combo)
      g.collected[stackId] = (g.collected[stackId] || 0) + 1
      const fever = now < g.feverUntil ? FEVER_MULT : 1
      const total = Math.round(g.swipeBase * swipeMultiplier(g.swipeSlices) * fever)
      const delta = total - g.swipeAwarded
      g.score += delta
      g.swipeAwarded = total
      g.sparks.push(...makeSparks(o.x, o.y, golden ? '#FFCB3D' : col, golden ? 18 : 10, g.h))
      audioRef.current?.slice(g.swipeSlices, golden)
      vibe(golden ? 26 : 12)
      if (g.swipeSlices >= 2) popup(o.x, o.y, `${g.swipeSlices} COMBO!`, comboColor(g.swipeSlices), `+${delta}`)
      else popup(o.x, o.y, `+${delta}`, golden ? '#FFCB3D' : col)
      commit()
    }

    // ── 입력 (Pointer Events: 터치/마우스 통합) ──
    const down = (x: number, y: number) => {
      g.down = true
      g.swipeSlices = 0
      g.swipeBase = 0
      g.swipeAwarded = 0
      g.lastX = x
      g.lastY = y
      g.trail.push({ x, y, t: performance.now() })
    }
    const move = (x: number, y: number) => {
      const now = performance.now()
      g.trail.push({ x, y, t: now })
      if (!g.down) {
        g.lastX = x
        g.lastY = y
        return
      }
      const ax = g.lastX
      const ay = g.lastY
      if (g.phase === 'playing' && now - g.playStartAt >= 0) {
        const angle = Math.atan2(y - ay, x - ax)
        for (const o of g.objects) {
          if (o.sliced) continue
          if (segHitsObject(ax, ay, x, y, o)) sliceHit(o, angle)
        }
      }
      g.lastX = x
      g.lastY = y
    }
    const up = () => {
      g.down = false
    }
    downRef.current = down
    moveRef.current = move
    upRef.current = up

    // ── 시작 ──
    const start = () => {
      audioRef.current?.unlock()
      const now = performance.now()
      g.phase = 'playing'
      g.playStartAt = now + LEAD_IN_MS
      g.nextSpawnAt = g.playStartAt
      g.objects = []
      g.pieces = []
      g.sparks = []
      g.popups = []
      g.score = 0
      g.combo = 0
      g.maxCombo = 0
      g.feverUntil = 0
      g.collected = {}
      g.trapsSliced = 0
      g.down = false
      g.trail = []
      g.shake = 0
      g.flash = 0
      // 모션 조준 상태 초기화 (직전 위치 스테일로 첫 스트로크가 튀지 않게)
      aimRef.current.has = false
      aimRef.current.moving = false
      setResult(null)
      commit()
    }
    startRef.current = start

    const endGame = () => {
      g.phase = 'result'
      const bestPrev = Number(localStorage.getItem(BEST_KEY) || 0)
      const newBest = Math.max(bestPrev, g.score)
      if (newBest !== bestPrev) localStorage.setItem(BEST_KEY, String(newBest))
      setBest(newBest)
      setResult({
        score: g.score,
        best: newBest,
        collected: { ...g.collected },
        trapsSliced: g.trapsSliced,
        maxCombo: g.maxCombo,
      })
      audioRef.current?.end()
      commit()
    }

    // ── 업데이트 ──
    const update = (now: number) => {
      const dt = clamp((now - g.lastFrame) / 1000, 0, 1 / 30)
      g.lastFrame = now
      const grav = gravity(g.h)

      // 잔상 오래된 점 정리
      while (g.trail.length && now - g.trail[0].t > TRAIL_MS) g.trail.shift()

      if (g.phase === 'playing') {
        const songTime = now - g.playStartAt
        // 스폰
        if (songTime >= 0 && songTime < GAME_MS && now >= g.nextSpawnAt && g.objects.length < MAX_OBJECTS) {
          const fever = now < g.feverUntil
          const n = Math.min(waveSize(songTime, fever), MAX_OBJECTS - g.objects.length)
          for (let i = 0; i < n; i++) g.objects.push(spawnOne(g.w, g.h, fever))
          g.nextSpawnAt = now + spawnInterval(songTime, fever)
        }
        // 종료
        if (songTime >= GAME_MS) endGame()
      }

      // 오브젝트 물리 + 정리 (놓친 건 페널티 없음)
      for (const o of g.objects) stepObject(o, dt, grav)
      if (g.objects.length) g.objects = g.objects.filter((o) => !o.sliced && !isGone(o, g.w, g.h))

      // 파편/스파크/팝업
      for (const p of g.pieces) stepPiece(p, dt, grav)
      if (g.pieces.length) g.pieces = g.pieces.filter((p) => p.life > 0 && p.y - p.r < g.h + 40)
      for (const s of g.sparks) stepSpark(s, dt, grav)
      if (g.sparks.length) g.sparks = g.sparks.filter((s) => s.life > 0)
      for (const p of g.popups) {
        p.y += p.vy * dt
        p.vy *= 0.94
        p.life -= dt / 0.9
      }
      if (g.popups.length) g.popups = g.popups.filter((p) => p.life > 0)

      // 연출 감쇠
      g.shake *= Math.pow(0.001, dt) // 빠르게 진정
      if (g.shake < 0.3) g.shake = 0
      g.flash = Math.max(0, g.flash - dt / 0.4)

      // UI 타이머 갱신(약 10Hz)
      if (now - g.lastCommit > 100) commit()
    }

    // ── 렌더 ──
    const render = (now: number) => {
      const { w, h } = g
      if (w === 0 || h === 0) return
      const songTime = g.phase === 'playing' ? now - g.playStartAt : -1
      const rush = g.phase === 'playing' && songTime > 0 && GAME_MS - songTime <= RUSH_MS
      const fever = now < g.feverUntil

      ctx.save()
      // 화면 흔들림
      if (g.shake > 0) {
        ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake)
      }

      // 배경: 딥 네이비 그라디언트
      const bg = ctx.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#0a1024')
      bg.addColorStop(0.55, '#0b1530')
      bg.addColorStop(1, '#070a18')
      ctx.fillStyle = bg
      ctx.fillRect(-40, -40, w + 80, h + 80)

      // 미세 그리드
      ctx.strokeStyle = 'rgba(120,160,255,0.05)'
      ctx.lineWidth = 1
      ctx.beginPath()
      const gap = 46
      for (let x = 0; x <= w; x += gap) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
      }
      for (let y = 0; y <= h; y += gap) {
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
      }
      ctx.stroke()

      // 피버/러시 배경 오버레이
      if (fever) {
        ctx.fillStyle = 'rgba(251,191,36,0.06)'
        ctx.fillRect(-40, -40, w + 80, h + 80)
      }

      // 오브젝트 (글로우 halo + 회전 글리프)
      for (const o of g.objects) {
        const col = objectColor(o.kind, o.defId, o.goldenStackId)
        const special = o.kind === 'bonus'
        ctx.save()
        ctx.globalAlpha = special ? 0.4 : 0.28
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.arc(o.x, o.y, o.r * (special ? 1.6 : 1.35), 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        ctx.save()
        ctx.translate(o.x, o.y)
        ctx.rotate(o.rot)
        drawGlyph(ctx, o.kind, o.defId, o.r, o.goldenStackId)
        ctx.restore()
      }

      // 파편 (절단선 기준 반쪽 클립)
      for (const p of g.pieces) {
        ctx.save()
        ctx.globalAlpha = clamp(p.life, 0, 1)
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.rotate(p.localCutAngle)
        ctx.beginPath()
        ctx.rect(-p.r * 2, p.side > 0 ? 0 : -p.r * 2, p.r * 4, p.r * 2)
        ctx.clip()
        ctx.rotate(-p.localCutAngle)
        drawGlyph(ctx, p.kind, p.defId, p.r, p.goldenStackId)
        ctx.restore()
      }

      // 스파크
      for (const s of g.sparks) {
        ctx.globalAlpha = clamp(s.life, 0, 1)
        ctx.fillStyle = s.color
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // 시작 화면(폰 모션 모드): 상단 START 타깃 — 블레이드로 베면 시작
      if (g.phase === 'ready' && motionRef.current) {
        const t = startTarget(w, h)
        const pulse = 0.5 + 0.5 * Math.sin(now / 300)
        ctx.save()
        ctx.translate(t.x, t.y)
        // 글로우 링
        ctx.globalAlpha = 0.5 + pulse * 0.4
        ctx.strokeStyle = BLADE_A
        ctx.lineWidth = 4
        ctx.shadowColor = BLADE_A
        ctx.shadowBlur = 22
        ctx.beginPath()
        ctx.arc(0, 0, t.r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `900 ${Math.round(t.r * 0.5)}px system-ui, sans-serif`
        ctx.fillText('START', 0, 0)
        ctx.font = `700 ${Math.round(t.r * 0.2)}px system-ui, sans-serif`
        ctx.fillStyle = 'rgba(180,210,255,0.8)'
        ctx.fillText('← 베면 시작', 0, t.r * 0.62)
        ctx.restore()
      }

      // 블레이드 잔상
      drawTrail(ctx, g.trail)

      // 폰 모션 조준 리티클 (최근 조준값이 있으면 = 모션 입력 중이면 블레이드 끝 위치 표시)
      if (now - aimRef.current.t < 500) {
        const a = aimRef.current
        ctx.save()
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = BLADE_A
        ctx.lineWidth = 2
        ctx.shadowColor = BLADE_A
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(a.x, a.y, 13, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(a.x, a.y, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // 카운트인 3·2·1
      if (g.phase === 'playing' && songTime < 0) {
        const n = clamp(Math.ceil(-songTime / (LEAD_IN_MS / 3)), 1, 3)
        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.font = `900 ${Math.round(h * 0.18)}px system-ui, sans-serif`
        ctx.fillText(String(n), w / 2, h * 0.44)
        ctx.font = `700 ${Math.round(h * 0.032)}px system-ui, sans-serif`
        ctx.fillStyle = 'rgba(180,210,255,0.7)'
        ctx.fillText('베어라!', w / 2, h * 0.44 + h * 0.11)
        ctx.restore()
      }

      // 팝업 텍스트
      for (const p of g.popups) {
        ctx.save()
        ctx.globalAlpha = clamp(p.life * 1.4, 0, 1)
        ctx.textAlign = 'center'
        ctx.fillStyle = p.color
        ctx.font = `900 ${Math.round(clamp(h * 0.05, 20, 34))}px system-ui, sans-serif`
        ctx.fillText(p.text, p.x, p.y)
        if (p.sub) {
          ctx.font = `800 ${Math.round(clamp(h * 0.032, 14, 22))}px system-ui, sans-serif`
          ctx.fillText(p.sub, p.x, p.y + h * 0.04)
        }
        ctx.restore()
      }
      ctx.globalAlpha = 1
      ctx.restore()

      // 러시(마지막 10초) 붉은 테두리 펄스
      if (rush) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 130)
        ctx.save()
        ctx.strokeStyle = `rgba(239,68,68,${0.25 + pulse * 0.4})`
        ctx.lineWidth = 8
        ctx.strokeRect(4, 4, w - 8, h - 8)
        ctx.restore()
      }
      // 함정 붉은 플래시
      if (g.flash > 0) {
        ctx.fillStyle = `rgba(239,68,68,${g.flash * 0.5})`
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

    let raf = 0
    g.lastFrame = performance.now()
    const frame = () => {
      const now = performance.now()
      update(now)
      render(now)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    const engine = new Fx()
    audioRef.current = engine
    return () => engine.dispose()
  }, [])

  // 폰 컨트롤러(터치패드) 연동: 폰에서 그은 좌표(정규화 0~1)로 노트북 블레이드를 구동.
  //  준비/결과 화면에선 첫 터치가 게임 시작/재시작 버튼 역할을 한다.
  useEffect(() => {
    const onSlash = (d?: { x?: number; y?: number; t?: 'down' | 'move' | 'up' }) => {
      if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') return
      const g = gameRef.current
      if (d.t === 'down' && g.phase !== 'playing') {
        startRef.current()
        return
      }
      if (g.phase !== 'playing') return
      const x = d.x * g.w
      const y = d.y * g.h
      if (d.t === 'down') downRef.current(x, y)
      else if (d.t === 'move') moveRef.current(x, y)
      else upRef.current()
    }
    socket.on('ctrl:slash', onSlash)
    return () => {
      socket.off('ctrl:slash', onSlash)
    }
  }, [])

  // 폰 모션 조준: 기울기 좌표(0~1)를 블레이드 위치로. 충분히 빠르게 움직이면 그 구간을 벤다.
  //  (가만히 두면 자르지 않음 → "폰을 휘둘러야 베인다". 스트로크가 끊기면 새 콤보로 시작)
  useEffect(() => {
    const onAim = (d?: { x?: number; y?: number }) => {
      if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') return
      const g = gameRef.current
      // 폰 모션 컨트롤러 감지 → 시작 화면을 "START 베기" 모드로 전환 (최초 1회만 state 갱신)
      if (!motionRef.current) {
        motionRef.current = true
        setMotionMode(true)
      }
      const x = d.x * g.w
      const y = d.y * g.h
      const a = aimRef.current
      a.x = x
      a.y = y
      a.t = performance.now()
      if (!a.has) {
        a.has = true
        a.px = x
        a.py = y
        return
      }
      const dist = Math.hypot(x - a.px, y - a.py)
      const MIN = g.w * 0.01 // 이보다 느리면(정지/미세) 자르지 않음
      const MAXJUMP = g.w * 0.7 // 재정렬 등으로 튀는 큰 점프는 무시
      const moving = dist >= MIN && dist <= MAXJUMP
      if (moving) {
        if (!a.moving) {
          downRef.current(a.px, a.py) // 블레이드 스트로크 시작(트레일 생성)
          a.moving = true
        }
        moveRef.current(x, y) // 플레이 중이면 절단, 아니면 트레일만
      } else if (dist < MIN && a.moving) {
        upRef.current()
        a.moving = false
      }
      // 시작 화면: 블레이드로 상단 START 타깃을 베면 게임 시작
      if (g.phase === 'ready' && moving) {
        const t = startTarget(g.w, g.h)
        if (pointSegDist(a.px, a.py, x, y, t.x, t.y) <= t.r) {
          a.moving = false
          startRef.current()
        }
      }
      a.px = x
      a.py = y
    }
    socket.on('ctrl:aim', onAim)
    return () => {
      socket.off('ctrl:aim', onAim)
    }
  }, [])

  const rel = (e: ReactPointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const startGame = useCallback(() => startRef.current(), [])

  const timeLeftSec = Math.ceil(ui.timeLeftMs / 1000)
  const rush = ui.phase === 'playing' && ui.timeLeftMs <= RUSH_MS

  return (
    <div className="fixed inset-0 flex flex-col bg-[#070a18] text-white select-none overflow-hidden">
      <StyleFx />
      {/* 상단 바 */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 py-2.5 pointer-events-none">
        <button
          onClick={onExit}
          className="pointer-events-auto text-sm text-white/60 hover:text-white"
          style={{ opacity: ui.phase === 'playing' ? 0.4 : 1 }}
        >
          ‹ 게임 선택
        </button>
        {ui.phase !== 'playing' && canVibrate() && (
          <button
            onClick={() => setVibeOn((v) => !v)}
            className={`pointer-events-auto text-xs rounded-full px-3 py-1 border ${
              vibeOn ? 'border-[#22d3ee]/60 text-[#22d3ee]' : 'border-white/20 text-white/50'
            }`}
          >
            📳 진동 {vibeOn ? 'ON' : 'OFF'}
          </button>
        )}
      </div>

      {/* 캔버스 + 입력 영역 */}
      <div
        ref={containerRef}
        className="relative flex-1 touch-none"
        onPointerDown={(e) => {
          // 플레이 중에만 입력을 가로챈다. (ready/result 오버레이의 버튼 탭이
          //  컨테이너로 버블링돼 preventDefault 로 막히면 폰에서 '시작'이 안 눌림)
          if (ui.phase !== 'playing') return
          e.preventDefault()
          e.currentTarget.setPointerCapture?.(e.pointerId)
          const { x, y } = rel(e)
          downRef.current(x, y)
        }}
        onPointerMove={(e) => {
          if (ui.phase !== 'playing') return
          const { x, y } = rel(e)
          moveRef.current(x, y)
        }}
        onPointerUp={(e) => {
          if (ui.phase !== 'playing') return
          e.currentTarget.releasePointerCapture?.(e.pointerId)
          upRef.current()
        }}
        onPointerCancel={() => upRef.current()}
      >
        <canvas ref={canvasRef} className="block" />

        {/* HUD (플레이 중) */}
        {ui.phase === 'playing' && (
          <Hud score={ui.score} combo={ui.combo} timeSec={timeLeftSec} rush={rush} fever={ui.fever} />
        )}

        {/* 시작 화면 — 폰 모션 모드면 하단 안내만(위 START 타깃은 캔버스), 아니면 일반 버튼 */}
        {ui.phase === 'ready' &&
          (motionMode ? (
            <MotionReady best={best} />
          ) : (
            <StartScreen best={best} onStart={startGame} />
          ))}

        {/* 결과 화면 */}
        {ui.phase === 'result' && result && (
          <ResultScreen result={result} onRetry={startGame} onExit={onExit} />
        )}
      </div>
    </div>
  )
}

/** 블레이드 잔상: 시안→마젠타 그라디언트 + 글로우 + 흰 코어 */
function drawTrail(ctx: CanvasRenderingContext2D, trail: TrailPoint[]) {
  if (trail.length < 2) return
  const first = trail[0]
  const last = trail[trail.length - 1]
  const grad = ctx.createLinearGradient(first.x, first.y, last.x, last.y)
  grad.addColorStop(0, BLADE_A)
  grad.addColorStop(1, BLADE_B)
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const path = new Path2D()
  path.moveTo(trail[0].x, trail[0].y)
  for (let i = 1; i < trail.length; i++) path.lineTo(trail[i].x, trail[i].y)
  // 글로우
  ctx.globalAlpha = 0.35
  ctx.strokeStyle = grad
  ctx.lineWidth = 18
  ctx.shadowColor = BLADE_A
  ctx.shadowBlur = 16
  ctx.stroke(path)
  // 본체
  ctx.globalAlpha = 0.9
  ctx.shadowBlur = 0
  ctx.lineWidth = 7
  ctx.stroke(path)
  // 흰 코어
  ctx.globalAlpha = 0.95
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 2.5
  ctx.stroke(path)
  ctx.restore()
}

// ── HUD ──────────────────────────────────────────────────────
function Hud({
  score,
  combo,
  timeSec,
  rush,
  fever,
}: {
  score: number
  combo: number
  timeSec: number
  rush: boolean
  fever: boolean
}) {
  const frac = clamp(timeSec / (GAME_MS / 1000), 0, 1)
  const R = 22
  const C = 2 * Math.PI * R
  const ringColor = rush ? '#ef4444' : '#22d3ee'
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* SCORE — 상단 중앙, 점수 오를 때마다 팝(스케일)+네온 글로우로 상승감 강조 */}
      <div className="absolute top-1.5 left-1/2 -translate-x-1/2 flex flex-col items-center">
        <div className="label-mono text-white/45 tracking-widest">SCORE</div>
        <div
          key={score}
          className="text-4xl font-black tabular-nums leading-none text-white"
          style={{
            animation: 'slasher-score 0.28s ease-out',
            textShadow: '0 0 20px rgba(34,211,238,0.65), 0 0 6px rgba(233,53,193,0.5)',
          }}
        >
          {score.toLocaleString()}
        </div>
      </div>

      {/* 콤보 — 점수 바로 아래 중앙 */}
      {combo >= 2 && (
        <div
          key={combo}
          className="absolute top-[4.3rem] left-1/2 -translate-x-1/2 text-center animate-combo-hit"
        >
          <div
            className="text-2xl font-black tabular-nums"
            style={{ color: comboColor(combo), textShadow: `0 0 16px ${comboColor(combo)}aa` }}
          >
            × {combo} <span className="text-sm">COMBO</span>
          </div>
        </div>
      )}

      {/* 피버 배지 — 콤보 아래 */}
      {fever && (
        <div className="absolute top-[6.6rem] left-1/2 -translate-x-1/2 text-xs font-black text-[#fbbf24] animate-pulse-slow">
          ☕ FEVER ×{FEVER_MULT}
        </div>
      )}

      {/* 타이머 링 우상단 */}
      <div className="absolute top-2.5 right-3">
        <svg width={58} height={58} className={rush ? 'animate-pulse-slow' : ''}>
          <circle cx={29} cy={29} r={R} fill="rgba(255,255,255,0.06)" />
          <circle
            cx={29}
            cy={29}
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={5}
          />
          <circle
            cx={29}
            cy={29}
            r={R}
            fill="none"
            stroke={ringColor}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            transform="rotate(-90 29 29)"
            style={{ transition: 'stroke-dashoffset 0.2s linear, stroke 0.3s' }}
          />
          <text
            x={29}
            y={29}
            textAnchor="middle"
            dominantBaseline="central"
            className="tabular-nums"
            fontSize={20}
            fontWeight={900}
            fill="#fff"
          >
            {timeSec}
          </text>
        </svg>
      </div>
    </div>
  )
}

// ── 시작 화면 (폰 모션 컨트롤러) — 위 START 는 캔버스, 여기선 하단 안내만 ──
function MotionReady({ best }: { best: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-6 pb-10">
      <div className="w-full max-w-sm rounded-2xl bg-black/65 border border-white/10 backdrop-blur-sm px-5 py-4 text-center">
        <div className="text-lg font-black text-white">🗡️ 폰을 검처럼 들고!</div>
        <p className="text-sm text-white/75 mt-2 leading-relaxed">
          ① 편한 자세에서 폰의 <b className="text-white">🎯 가운데 세팅</b>
          <br />② 위쪽 <b className="text-[#22d3ee]">START</b> 를 <b className="text-white">베면 시작!</b>{' '}
          (3·2·1)
        </p>
        {best > 0 && (
          <div className="text-xs text-white/45 mt-2">🏆 BEST {best.toLocaleString()}</div>
        )}
      </div>
    </div>
  )
}

// ── 시작 화면 ────────────────────────────────────────────────
function StartScreen({ best, onStart }: { best: number; onStart: () => void }) {
  return (
    <Overlay>
      <div className="text-5xl mb-2">🗡️</div>
      <h1
        className="text-3xl font-black tracking-tight mb-1"
        style={{ textShadow: '0 0 22px rgba(34,211,238,0.6)' }}
      >
        기술스택 슬래셔
      </h1>
      <p className="text-white/55 text-sm mb-5 text-center leading-relaxed">
        아래에서 날아오는 <b className="text-[#22d3ee]">기술 로고</b>를 스와이프로 베어라!
        <br />
        60초 안에 최대한 많이 — 마지막에 <b className="text-[#e935c1]">개발자 유형</b>을 판정한다.
      </p>
      <div className="flex flex-col gap-2 w-full max-w-xs mb-6 text-sm">
        <Rule emoji="✅" title="기술 스택" desc="+점수 · 컬렉션 수집" color="#4ade80" />
        <Rule emoji="💣" title="함정 (버그·폭탄·야근)" desc="감점 · 콤보 리셋" color="#f87171" />
        <Rule emoji="⭐" title="보너스 (황금·커피)" desc="×3 점수 · 피버 타임" color="#fbbf24" />
        <Rule emoji="⚡" title="콤보" desc="한 번에 여러 개 베면 점수 배수↑" color="#a855f7" />
      </div>
      <button
        onClick={onStart}
        className="px-10 py-3.5 rounded-2xl font-black text-lg tracking-wide active:brightness-110 transition"
        style={{
          background: 'linear-gradient(120deg,#0891b2,#22d3ee 55%,#e935c1)',
          boxShadow: '0 10px 30px rgba(34,211,238,0.35)',
        }}
      >
        게임 시작 ▶
      </button>
      <p className="text-white/40 text-xs mt-5">
        📱 손가락으로 스와이프 · 🖱️ 마우스 드래그 {best > 0 && `· 🏆 BEST ${best.toLocaleString()}`}
      </p>
    </Overlay>
  )
}

function Rule({ emoji, title, desc, color }: { emoji: string; title: string; desc: string; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
      <span className="text-xl w-7 text-center">{emoji}</span>
      <span className="font-bold" style={{ color }}>
        {title}
      </span>
      <span className="text-white/45 text-xs ml-auto">{desc}</span>
    </div>
  )
}

// ── 결과 화면 ────────────────────────────────────────────────
function ResultScreen({
  result,
  onRetry,
  onExit,
}: {
  result: RunResult
  onRetry: () => void
  onExit: () => void
}) {
  const verdict = decideVerdict({
    collected: result.collected,
    score: result.score,
    trapsSliced: result.trapsSliced,
  })
  const counts = categoryCounts(result.collected)
  const isNewBest = result.score >= result.best && result.score > 0

  // 컬렉션 순차 등장을 위한 인덱스 부여
  let idx = 0

  return (
    <Overlay>
      <div className="w-full max-w-md flex flex-col items-center overflow-y-auto py-6">
        <div className="label-mono text-white/50">TIME'S UP!</div>
        <h2 className="text-xl font-black mb-2">결과</h2>
        <div className="text-5xl font-black tabular-nums" style={{ color: verdict.color }}>
          {result.score.toLocaleString()}
        </div>
        <div className="text-xs text-white/50 mb-4 mt-0.5">
          {isNewBest ? (
            <span className="text-[#fbbf24] font-bold">🎉 최고 기록 갱신!</span>
          ) : (
            <>BEST {result.best.toLocaleString()}</>
          )}
        </div>

        {/* 판정 배너 */}
        <div
          className="w-full rounded-2xl px-5 py-3 text-center mb-1 animate-combo-pop"
          style={{
            background: `linear-gradient(120deg, ${verdict.color}22, ${verdict.color}11)`,
            border: `1.5px solid ${verdict.color}66`,
            boxShadow: `0 0 24px ${verdict.color}33`,
          }}
        >
          <div className="text-lg font-black" style={{ color: verdict.color }}>
            {verdict.emoji} {verdict.title}
          </div>
          <div className="text-xs text-white/60 mt-0.5">{verdict.desc}</div>
        </div>

        {/* 통계 */}
        <div className="flex gap-5 text-xs text-white/60 my-3">
          <span>MAX COMBO <b className="text-white tabular-nums">{result.maxCombo}</b></span>
          <span>함정 <b className="text-[#f87171] tabular-nums">{result.trapsSliced}</b></span>
        </div>

        {/* 터득한 기술 스택 — 4열 카테고리 */}
        <div className="label-mono text-white/45 self-start mb-2">터득한 기술 스택</div>
        <div className="grid grid-cols-4 gap-2 w-full">
          {CATEGORIES.map((cat) => (
            <div key={cat} className="flex flex-col items-center gap-2">
              <div className="text-xs font-black text-white/70">{cat}</div>
              <div className="text-[10px] text-white/35 -mt-1 tabular-nums">{counts[cat]}개</div>
              {STACKS_BY_CATEGORY[cat].map((s) => {
                const n = result.collected[s.id] || 0
                const order = idx++
                return (
                  <div
                    key={s.id}
                    className="flex flex-col items-center"
                    style={{
                      opacity: n > 0 ? 1 : 0.22,
                      animation: n > 0 ? 'slasher-pop 0.35s both' : undefined,
                      animationDelay: n > 0 ? `${order * 45}ms` : undefined,
                    }}
                  >
                    <div
                      className="relative flex h-11 w-11 items-center justify-center rounded-full font-black text-sm"
                      style={{
                        background: n > 0 ? s.color : 'rgba(255,255,255,0.06)',
                        color: n > 0 ? pickTextColor(s.color) : 'rgba(255,255,255,0.4)',
                        boxShadow: n > 0 ? `0 0 12px ${s.color}66` : undefined,
                      }}
                    >
                      {s.mono}
                      {n > 1 && (
                        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-black text-[#0a1024]">
                          {n}
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] text-white/50 mt-1 text-center leading-tight">
                      {s.name}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <button
          onClick={onRetry}
          className="mt-6 px-10 py-3 rounded-2xl font-black active:brightness-110 w-full max-w-xs"
          style={{ background: 'linear-gradient(120deg,#0891b2,#22d3ee 55%,#e935c1)' }}
        >
          다시 하기 ▶
        </button>
        <button onClick={onExit} className="mt-3 text-sm text-white/50 underline">
          다른 게임 고르기
        </button>
      </div>
    </Overlay>
  )
}

/** 배경색 위 글자를 흰/검 중 대비 좋은 쪽으로 */
function pickTextColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const gg = (n >> 8) & 255
  const b = n & 255
  const lum = (0.299 * r + 0.587 * gg + 0.114 * b) / 255
  return lum > 0.62 ? '#0a1024' : '#ffffff'
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#070a18]/90 backdrop-blur-sm px-6">
      {children}
    </div>
  )
}

/** 결과 컬렉션 등장 애니메이션 keyframes (자체 포함) */
function StyleFx() {
  return (
    <style>{`
      @keyframes slasher-pop {
        0% { opacity: 0; transform: translateY(8px) scale(0.7); }
        60% { transform: translateY(0) scale(1.08); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes slasher-score {
        0% { transform: scale(1); }
        35% { transform: scale(1.32); }
        100% { transform: scale(1); }
      }
    `}</style>
  )
}

/**
 * Fx — 아주 작은 WebAudio 효과음 (슬라이스/함정/피버).
 * 외부 오디오 파일 없이 오실레이터로 즉석 합성. iOS 는 시작 버튼(제스처)에서 unlock.
 */
class Fx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null

  unlock() {
    try {
      if (!this.ctx) {
        const C =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new C()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.32
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      /* 오디오 불가 환경이면 무시 */
    }
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  slice(combo: number, golden: boolean) {
    const base = 480 + Math.min(combo, 7) * 80
    this.blip(base, 0.08, 'triangle', 0.22, base * 1.6)
    if (golden) this.blip(1200, 0.14, 'sine', 0.2, 1700)
  }
  trap() {
    this.blip(120, 0.24, 'sawtooth', 0.3, 46)
  }
  fever() {
    this.blip(320, 0.28, 'square', 0.22, 880)
  }
  end() {
    this.blip(300, 0.5, 'sine', 0.25, 160)
  }

  dispose() {
    try {
      void this.ctx?.close()
    } catch {
      /* 무시 */
    }
    this.ctx = null
  }
}
