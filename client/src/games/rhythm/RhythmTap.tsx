import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  LANES,
  LANE_COLORS,
  LANE_KEYS,
  PERFECT_MS,
  GOOD_MS,
  MISS_MS,
  LEAD_MS,
  generateBeatmap,
  grade,
  type Beatmap,
  type MapOptions,
  type Note,
} from './beatmap'
import { onFeedbackChange, soundEnabled, vibrate } from '../../lib/feedback'
import { likelyKeyboard } from '../../lib/device'
import { socket } from '../../net/socket'
import MatchLobby from '../../net/MatchLobby'
import SettingsGear from '../../components/FeedbackSettings'

// 레인별 키보드 표시용 라벨 (LANE_KEYS 의 'KeyD' → 'D')
const LANE_KEY_LABELS = LANE_KEYS.map((k) => k.replace('Key', ''))

/**
 * RhythmTap — 리듬 탭 (신스웨이브 네온)
 * -------------------------------------------------------------
 * 네온 레인 4줄로 노트가 내려온다. 노트가 판정선에 닿는 순간 그 레인을 탭!
 *  - PERFECT / GOOD / MISS 판정 + 콤보 + 점수 + 정확도.
 *  - 음원 파일 없이 WebAudio 로 킥/하이햇/멜로디를 실시간 합성해 "곡"을 만든다.
 *  - 안드로이드는 매 박마다 폰이 살짝 진동 → 눈 안 봐도 리듬이 손에 느껴진다.
 *
 * 입력: 화면 레인 탭(멀티터치 O) / 키보드 D·F·J·K.
 * 디자인 정체성: 핑퐁(밝은 3D 탁구)과 완전히 다른 어두운 네온 클럽 톤.
 */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

type Phase = 'ready' | 'playing' | 'result'
type JudgeKind = 'perfect' | 'good' | 'miss'

interface Difficulty {
  key: string
  label: string
  opts: MapOptions
}
// 난이도: BPM 과 노트 밀도(density)만 바꿔 세 종류
const DIFFICULTIES: Difficulty[] = [
  { key: 'easy', label: 'EASY', opts: { bpm: 104, beats: 64, density: 0.35 } },
  { key: 'normal', label: 'NORMAL', opts: { bpm: 124, beats: 80, density: 0.7 } },
  { key: 'hard', label: 'HARD', opts: { bpm: 150, beats: 96, density: 1.0 } },
]

const LEAD_IN_MS = 2000 // 시작 버튼 → 첫 노트까지 준비 시간(3·2·1 카운트)
const JUDGE_SCORE: Record<JudgeKind, number> = { perfect: 300, good: 100, miss: 0 }
const JUDGE_ACC: Record<JudgeKind, number> = { perfect: 1, good: 0.5, miss: 0 }

// 히트 순간 튀는 파티클
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number // 0~1 (1→0)
  color: string
  r: number
}

// 화면 좌표 계산에 쓰는 레이아웃 (매 프레임 갱신)
interface Layout {
  pfX: number // 플레이필드 왼쪽
  pfW: number // 플레이필드 너비
  laneW: number
  topY: number
  hitY: number
}

interface RhythmState {
  w: number
  h: number
  phase: Phase
  beatmap: Beatmap
  songStart: number // performance.now() 기준 곡 시작(=첫 노트 0ms 시점). 이전엔 카운트인.
  score: number
  combo: number
  maxCombo: number
  counts: { perfect: number; good: number; miss: number }
  accSum: number // 정확도 합(판정된 노트 수로 나눔)
  judged: number
  firstActive: number // 아직 판정 안 된 첫 노트 인덱스(놓침 스캔 최적화)
  laneFlash: number[] // 레인별 마지막 탭 시각(연출)
  particles: Particle[]
  lastBeat: number // 진동/펄스용 마지막으로 지나간 박 번호
  layout: Layout
  online: 'host' | 'guest' | null // 온라인 대전 역할(없으면 솔로)
  lastProgress: number // 온라인: 마지막으로 진행상황 보낸 시각
  finishedSent: boolean // 온라인: 종료 보고 완료 여부
  swing: boolean // 폰=컨트롤러 "리듬 스윙" 모드(단일 레인, 폰 휘두르기로 입력)
}

function makeState(): RhythmState {
  return {
    w: 0,
    h: 0,
    phase: 'ready',
    beatmap: generateBeatmap(1, DIFFICULTIES[1].opts),
    songStart: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, good: 0, miss: 0 },
    accSum: 0,
    judged: 0,
    firstActive: 0,
    laneFlash: [-1e9, -1e9, -1e9, -1e9],
    particles: [],
    lastBeat: -1,
    layout: { pfX: 0, pfW: 0, laneW: 0, topY: 0, hitY: 0 },
    online: null,
    lastProgress: 0,
    finishedSent: false,
    swing: false,
  }
}

interface RhythmTapProps {
  onExit: () => void
  phoneConnected?: boolean // 허브에서 연결된 폰 컨트롤러 (있으면 스윙 입력 사용)
}

export default function RhythmTap({ onExit, phoneConnected = false }: RhythmTapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<RhythmState>(makeState())
  const audioRef = useRef<AudioEngine | null>(null)
  const startRef = useRef<(d: Difficulty) => void>(() => {})
  const startOnlineRef = useRef<(role: 'host' | 'guest', seed: number, opts: MapOptions) => void>(
    () => {},
  )
  const hitRef = useRef<(lane: number) => void>(() => {})
  const hitAnyRef = useRef<() => void>(() => {}) // 스윙 모드: 레인 상관없이 가장 가까운 노트 판정
  const startSwingRef = useRef<() => void>(() => {})
  const labelTimer = useRef<number | null>(null)

  const [ui, setUi] = useState({
    phase: 'ready' as Phase,
    score: 0,
    combo: 0,
    acc: 1,
    maxCombo: 0,
    swing: false,
  })
  const [label, setLabel] = useState<{ text: string; kind: JudgeKind } | null>(null)
  // 온라인 대전 상태
  const [lobbyOpen, setLobbyOpen] = useState(false)
  const [online, setOnline] = useState<{ role: 'host' | 'guest' } | null>(null)
  const [opp, setOpp] = useState<{
    score: number
    combo: number
    acc: number
    maxCombo: number
    done: boolean
  } | null>(null)
  const [oppLeft, setOppLeft] = useState(false)
  const [waitingStart, setWaitingStart] = useState(false) // guest: 방장 시작 대기

  // ── 메인 루프 & 게임 로직 (마운트 시 1회 구성) ──
  useEffect(() => {
    const g = gameRef.current
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const commit = () => {
      const acc = g.judged > 0 ? g.accSum / g.judged : 1
      setUi({ phase: g.phase, score: g.score, combo: g.combo, acc, maxCombo: g.maxCombo, swing: g.swing })
    }

    const showLabel = (kind: JudgeKind) => {
      const text = kind === 'perfect' ? 'PERFECT' : kind === 'good' ? 'GOOD' : 'MISS'
      setLabel({ text, kind })
      if (labelTimer.current) window.clearTimeout(labelTimer.current)
      labelTimer.current = window.setTimeout(() => setLabel(null), 500)
    }

    // 곡 시작(공통) — 솔로/온라인/스윙이 같이 쓴다
    const beginPlay = (map: Beatmap, online: 'host' | 'guest' | null, swing = false) => {
      g.beatmap = map
      g.online = online
      g.swing = swing
      g.phase = 'playing'
      g.score = 0
      g.combo = 0
      g.maxCombo = 0
      g.counts = { perfect: 0, good: 0, miss: 0 }
      g.accSum = 0
      g.judged = 0
      g.firstActive = 0
      g.particles = []
      g.lastBeat = -1
      g.lastProgress = 0
      g.finishedSent = false
      // 곡 시작 시각 = 지금 + 카운트인. songTime = now - songStart (카운트인 동안 음수)
      g.songStart = performance.now() + LEAD_IN_MS
      // 오디오: 같은 곡 시계에 맞춰 킥/하이햇/멜로디 예약
      audioRef.current?.scheduleSong(map, LEAD_IN_MS / 1000)
      commit()
    }

    const start = (d: Difficulty) => {
      const seed = (Math.floor(Math.random() * 1e9) % 1e9) + 1
      beginPlay(generateBeatmap(seed, d.opts), null)
    }
    startRef.current = start

    // 온라인: 같은 시드/옵션으로 동일 곡 생성 → 각자 자기 화면에서 판정
    const startOnline = (role: 'host' | 'guest', seed: number, opts: MapOptions) => {
      beginPlay(generateBeatmap(seed, opts), role)
    }
    startOnlineRef.current = startOnline

    // 폰 스윙: 한 손 입력이라 노트를 널찍하게(느린 BPM·낮은 밀도) + 동시노트 제거(같은 시각 1개만)
    const startSwing = () => {
      const seed = (Math.floor(Math.random() * 1e9) % 1e9) + 1
      const map = generateBeatmap(seed, { bpm: 108, beats: 72, density: 0.42 })
      const dedup: Note[] = []
      let prevT = -1
      for (const n of map.notes) {
        if (n.time === prevT) continue // 같은 시각 중복 제거 → 한 번 휘두르면 한 노트
        prevT = n.time
        dedup.push(n)
      }
      beginPlay({ ...map, notes: dedup }, null, true)
    }
    startSwingRef.current = startSwing

    // 스윙 입력: 레인 무시하고 판정창 안의 가장 가까운 노트를 판정
    const hitAny = () => {
      if (g.phase !== 'playing') return
      const t = songTime()
      g.laneFlash[0] = performance.now()
      const notes = g.beatmap.notes
      let best = -1
      let bestDelta = GOOD_MS + 1
      for (let i = g.firstActive; i < notes.length; i++) {
        const n = notes[i]
        if (n.time > t + GOOD_MS) break
        if (n.judged) continue
        const d = Math.abs(n.time - t)
        if (d < bestDelta) {
          bestDelta = d
          best = i
        }
      }
      if (best < 0) return
      const n = notes[best]
      judge(n, bestDelta <= PERFECT_MS ? 'perfect' : 'good')
    }
    hitAnyRef.current = hitAny

    // songTime(ms) = 현재 곡 진행 시각. 카운트인 동안 음수.
    const songTime = () => performance.now() - g.songStart

    // 레인 탭 → 그 레인에서 판정창 안의 가장 가까운 노트를 찾아 판정
    const hit = (lane: number) => {
      if (g.phase !== 'playing') return
      const t = songTime()
      g.laneFlash[lane] = performance.now()
      const notes = g.beatmap.notes
      let best = -1
      let bestDelta = GOOD_MS + 1
      for (let i = g.firstActive; i < notes.length; i++) {
        const n = notes[i]
        if (n.time > t + GOOD_MS) break // 정렬되어 있으니 더 볼 필요 없음
        if (n.judged || n.lane !== lane) continue
        const d = Math.abs(n.time - t)
        if (d < bestDelta) {
          bestDelta = d
          best = i
        }
      }
      if (best < 0) return // 근처에 칠 노트 없음 → 헛손질(패널티 없음, 너그럽게)
      const n = notes[best]
      const kind: JudgeKind = bestDelta <= PERFECT_MS ? 'perfect' : 'good'
      judge(n, kind)
    }
    hitRef.current = hit

    const judge = (n: Note, kind: JudgeKind) => {
      n.judged = true
      n.hit = kind !== 'miss'
      g.counts[kind]++
      g.accSum += JUDGE_ACC[kind]
      g.judged++
      if (kind === 'miss') {
        g.combo = 0
      } else {
        g.combo++
        g.maxCombo = Math.max(g.maxCombo, g.combo)
        // 콤보가 쌓일수록 점수 배율 up (최대 2배)
        const mult = 1 + Math.min(1, g.combo / 50)
        g.score += Math.round(JUDGE_SCORE[kind] * mult)
        spawnParticles(n.lane, kind)
        audioRef.current?.playHit(kind)
        vibrate(kind === 'perfect' ? 22 : 12)
      }
      showLabel(kind)
      commit()
    }

    const spawnParticles = (lane: number, kind: JudgeKind) => {
      const { pfX, pfW, laneW, hitY } = g.layout
      // 스윙(단일 레인)은 중앙에서, 일반은 해당 레인에서 파티클이 튄다
      const cx = g.swing ? pfX + pfW / 2 : pfX + laneW * (lane + 0.5)
      const color = LANE_COLORS[lane]
      const n = kind === 'perfect' ? 14 : 7
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5
        const sp = 2 + Math.random() * (kind === 'perfect' ? 4.5 : 2.5)
        g.particles.push({
          x: cx,
          y: hitY,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 1.5,
          life: 1,
          color,
          r: 2 + Math.random() * 2.5,
        })
      }
    }

    // 놓친 노트 처리 + 곡 종료 판단
    const update = (t: number) => {
      if (g.phase !== 'playing') return
      const notes = g.beatmap.notes
      // firstActive 를 판정 끝난 노트 뒤로 밀기
      while (g.firstActive < notes.length && notes[g.firstActive].judged) g.firstActive++
      // firstActive 부터, 판정선을 MISS_MS 넘긴 미판정 노트는 놓침
      for (let i = g.firstActive; i < notes.length; i++) {
        const n = notes[i]
        if (n.time > t - MISS_MS) break
        if (!n.judged) judge(n, 'miss')
      }
      // 파티클 물리
      const ps = g.particles
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.35 // 중력
        p.vx *= 0.96
        p.life -= 0.04
        if (p.life <= 0) ps.splice(i, 1)
      }
      // 매 박 진동/펄스 (곡 시작 후)
      if (t >= 0) {
        const beat = Math.floor(t / g.beatmap.beatMs)
        if (beat !== g.lastBeat) {
          g.lastBeat = beat
          vibrate(8)
          // 스윙 모드: 폰(컨트롤러)이 손으로 비트를 느끼도록 신호
          if (g.swing) socket.emit('game:beat')
        }
      }
      // 종료: 마지막 노트도 지나고 곡 길이 넘음
      if (t > g.beatmap.durationMs) {
        g.phase = 'result'
        audioRef.current?.stopSong()
        commit()
        // 온라인: 내 최종 점수 보고
        if (g.online && !g.finishedSent) {
          g.finishedSent = true
          const acc = g.judged > 0 ? g.accSum / g.judged : 1
          socket.emit('rt:progress', {
            score: g.score,
            combo: g.combo,
            acc,
            maxCombo: g.maxCombo,
            done: true,
          })
        }
      }
    }

    // ── 렌더링 ──
    const layout = () => {
      const { w, h } = g
      // 스윙(폰 컨트롤러)은 노트북 큰 화면 기준 넓은 단일 레인, 일반은 4레인
      const pfW = g.swing ? Math.min(w, 340) : Math.min(w, 480)
      const pfX = (w - pfW) / 2
      const laneCount = g.swing ? 1 : LANES
      const laneW = pfW / laneCount
      const topY = 0
      const hitY = h * 0.8
      g.layout = { pfX, pfW, laneW, topY, hitY }
      return g.layout
    }

    const render = (t: number) => {
      const { w, h } = g
      if (w === 0 || h === 0) return
      const L = layout()
      const { pfX, pfW, laneW, hitY } = L
      const now = performance.now()

      // 배경: 깊은 보라-검정 + 박에 맞춘 은은한 글로우 펄스
      const beatPhase = t >= 0 ? (t % g.beatmap.beatMs) / g.beatmap.beatMs : 1
      const pulse = g.phase === 'playing' ? (1 - beatPhase) * 0.5 : 0
      const bg = ctx.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#0b0616')
      bg.addColorStop(0.5, `rgba(30,12,54,${0.55 + pulse * 0.25})`)
      bg.addColorStop(1, '#060309')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      // 레인 수: 스윙은 1, 일반은 4
      const laneCount = g.swing ? 1 : LANES

      // 플레이필드 배경(약간 밝은 세로 띠) + 레인 구분선
      ctx.fillStyle = 'rgba(255,255,255,0.02)'
      ctx.fillRect(pfX, 0, pfW, h)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      for (let i = 0; i <= laneCount; i++) {
        const x = pfX + laneW * i
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }

      // 레인 탭/타격 순간 발광(위→아래 그라데이션)
      for (let i = 0; i < laneCount; i++) {
        const since = now - g.laneFlash[i]
        if (since < 180) {
          const a = (1 - since / 180) * 0.28
          const lg = ctx.createLinearGradient(0, hitY - 260, 0, hitY)
          lg.addColorStop(0, 'transparent')
          lg.addColorStop(1, LANE_COLORS[i])
          ctx.globalAlpha = a
          ctx.fillStyle = lg
          ctx.fillRect(pfX + laneW * i, hitY - 260, laneW, 260)
          ctx.globalAlpha = 1
        }
      }

      // 판정선 (네온 바) + 레인별 키패드
      ctx.save()
      ctx.shadowColor = 'rgba(120,180,255,0.9)'
      ctx.shadowBlur = 16 + pulse * 14
      ctx.strokeStyle = 'rgba(180,210,255,0.85)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(pfX, hitY)
      ctx.lineTo(pfX + pfW, hitY)
      ctx.stroke()
      ctx.restore()
      for (let i = 0; i < laneCount; i++) {
        const x = pfX + laneW * i
        const since = now - g.laneFlash[i]
        const active = since < 130
        ctx.save()
        ctx.strokeStyle = LANE_COLORS[i]
        ctx.globalAlpha = active ? 1 : 0.4
        ctx.shadowColor = LANE_COLORS[i]
        ctx.shadowBlur = active ? 22 : 8
        ctx.lineWidth = active ? 3 : 2
        roundRectPath(ctx, x + 6, hitY + 6, laneW - 12, 30, 8)
        ctx.stroke()
        ctx.restore()
        // 키보드 기기: 각 레인이 어떤 키(D·F·J·K)인지 판정선 키패드에 상시 표시
        if (!g.swing && likelyKeyboard) {
          ctx.save()
          ctx.fillStyle = LANE_COLORS[i]
          ctx.globalAlpha = active ? 1 : 0.75
          ctx.shadowColor = LANE_COLORS[i]
          ctx.shadowBlur = active ? 16 : 0
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.font = `900 ${active ? 19 : 16}px system-ui, sans-serif`
          ctx.fillText(LANE_KEY_LABELS[i], x + laneW / 2, hitY + 21)
          ctx.restore()
        }
      }

      // 노트 그리기 (판정 안 된 것만; 곡 진행 시각 t 기준으로 y 계산)
      const notes = g.beatmap.notes
      for (let i = g.firstActive; i < notes.length; i++) {
        const n = notes[i]
        if (n.judged) continue
        // 노트가 화면에 등장하는 시각 = time - LEAD_MS. 그때 topY, time 에 hitY.
        const prog = (t - (n.time - LEAD_MS)) / LEAD_MS
        if (prog < -0.1) break // 아직 등장 전(뒤 노트는 더 나중이니 중단)
        if (prog > 1.25) continue
        const y = lerp(L.topY, hitY, prog)
        // 스윙은 중앙 단일 레인, 일반은 노트의 레인 위치
        const x = g.swing ? pfX : pfX + laneW * n.lane
        drawNote(ctx, x + 7, y, laneW - 14, LANE_COLORS[n.lane])
      }

      // 파티클
      for (const p of g.particles) {
        ctx.globalAlpha = clamp(p.life, 0, 1)
        ctx.fillStyle = p.color
        ctx.shadowColor = p.color
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

      // 카운트인 3·2·1 (곡 시작 전)
      if (g.phase === 'playing' && t < 0) {
        const n = Math.ceil(-t / (LEAD_IN_MS / 3))
        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.shadowColor = '#a855f7'
        ctx.shadowBlur = 30
        ctx.font = `900 ${Math.round(h * 0.16)}px system-ui, sans-serif`
        ctx.fillText(String(clamp(n, 1, 3)), w / 2, h * 0.42)
        ctx.font = `700 ${Math.round(h * 0.03)}px system-ui, sans-serif`
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.fillText('준비…', w / 2, h * 0.42 + h * 0.12)
        ctx.restore()
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
    const frame = () => {
      const t = performance.now() - g.songStart
      update(t)
      render(t)
      // 온라인: 진행상황(점수/콤보/정확도)을 주기적으로 상대에게 전송
      if (g.online && g.phase === 'playing') {
        const nowMs = performance.now()
        if (nowMs - g.lastProgress > 130) {
          g.lastProgress = nowMs
          const acc = g.judged > 0 ? g.accSum / g.judged : 1
          socket.emit('rt:progress', {
            score: g.score,
            combo: g.combo,
            acc,
            maxCombo: g.maxCombo,
            done: false,
          })
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // 키보드 입력 (PC 테스트): 스윙 모드는 Space/↓ = 치기, 일반은 D·F·J·K = 각 레인
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      // 로비 코드 입력 등 텍스트 필드에 타이핑 중이면 게임 조작으로 가로채지 않음
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (gameRef.current.swing) {
        if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'Enter') {
          e.preventDefault()
          hitAnyRef.current()
        }
        return
      }
      const lane = LANE_KEYS.indexOf(e.code as (typeof LANE_KEYS)[number])
      if (lane >= 0) {
        e.preventDefault()
        hitRef.current(lane)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 폰=컨트롤러(스윙): 페어링·게임알림(disp:game)은 App 이 담당 → 여기선 폰 휘두름(ctrl:swing)만 받아 친다
  useEffect(() => {
    const onSwing = () => {
      if (gameRef.current.swing) hitAnyRef.current()
    }
    socket.on('ctrl:swing', onSwing)
    return () => {
      socket.off('ctrl:swing', onSwing)
    }
  }, [])

  // 오디오 엔진 준비/정리 + 설정의 "소리" 스위치 따라가기
  //  곡 예약은 그대로 두고 마스터 게인만 0 으로 내린다 — 판정이 곡 시계를 쓰므로
  //  엔진을 멈추면 음소거가 아니라 게임이 어긋난다.
  useEffect(() => {
    const engine = new AudioEngine()
    audioRef.current = engine
    engine.setMuted(!soundEnabled())
    const off = onFeedbackChange(() => engine.setMuted(!soundEnabled()))
    return () => {
      off()
      engine.dispose()
    }
  }, [])

  // 온라인 대전: 곡 시작 수신(게스트) / 상대 진행상황 / 상대 이탈
  useEffect(() => {
    const onStart = (d: { seed: number; opts: MapOptions }) => {
      setWaitingStart(false)
      setOpp(null)
      startOnlineRef.current('guest', d.seed, d.opts)
    }
    const onProgress = (p: {
      score: number
      combo: number
      acc: number
      maxCombo: number
      done: boolean
    }) => setOpp(p)
    const onLeft = () => setOppLeft(true)
    socket.on('rt:start', onStart)
    socket.on('rt:progress', onProgress)
    socket.on('rt:left', onLeft)
    return () => {
      socket.off('rt:start', onStart)
      socket.off('rt:progress', onProgress)
      socket.off('rt:left', onLeft)
    }
  }, [])

  // 로비 매칭 완료 → 역할별 시작
  const onMatched = useCallback((role: 'host' | 'guest') => {
    audioRef.current?.unlock()
    setLobbyOpen(false)
    setOnline({ role })
    setOpp(null)
    setOppLeft(false)
    if (role === 'host') {
      const seed = (Math.floor(Math.random() * 1e9) % 1e9) + 1
      const opts = DIFFICULTIES[1].opts // 온라인은 NORMAL 고정
      socket.emit('rt:start', { seed, opts })
      startOnlineRef.current('host', seed, opts)
    } else {
      setWaitingStart(true) // 방장이 곡을 시작하길 대기
    }
  }, [])

  // 시작 (오디오 unlock 은 사용자 제스처 안에서)
  const startGame = useCallback((d: Difficulty) => {
    audioRef.current?.unlock()
    startRef.current(d)
  }, [])

  // 스윙 시작: 페어링/게임알림은 허브·App 담당. 폰이 붙어 있으면 폰으로, 없으면 키보드(Space/↓)로.
  const startSwingNow = useCallback(() => {
    audioRef.current?.unlock()
    startSwingRef.current()
  }, [])

  // 레인 탭 (멀티터치: 레인마다 별도 div → 두 손가락 동시 인식)
  const onLaneDown = (lane: number) => (e: ReactPointerEvent) => {
    e.preventDefault()
    hitRef.current(lane)
  }

  const g = grade(ui.acc)
  const total = gameRef.current.counts

  return (
    <div className="fixed inset-0 flex flex-col bg-[#060309] text-white select-none overflow-hidden">
      {/* 상단 바: 점수 / 정확도 / 진동 토글 */}
      <div className="flex items-center justify-between px-4 py-2.5 z-10">
        <button onClick={onExit} className="text-sm text-white/60 hover:text-white">
          ‹ 게임 선택
        </button>
        <div className="flex items-center gap-5">
          <div className="text-center">
            <div className="label-mono text-white/40">SCORE</div>
            <div className="text-xl font-black tabular-nums text-[#22d3ee]">
              {ui.score.toLocaleString()}
            </div>
          </div>
          <div className="text-center">
            <div className="label-mono text-white/40">ACC</div>
            <div className="text-xl font-black tabular-nums text-[#a855f7]">
              {(ui.acc * 100).toFixed(1)}%
            </div>
          </div>
        </div>
        {/* 진동 토글은 여기 있던 pill 에서 공용 톱니바퀴로 옮겼다 —
            게임마다 따로 두면 저장도 안 되고 다른 화면의 설정과 어긋난다. */}
        <div className="flex items-center gap-2">
          {ui.swing && (
            <span
              className={`text-xs rounded-full px-3 py-1 border ${
                phoneConnected
                  ? 'border-[#4ade80]/60 text-[#4ade80]'
                  : 'border-white/20 text-white/50'
              }`}
            >
              {phoneConnected ? '🎮 폰 채 연결됨' : '🎮 키보드 Space/↓'}
            </span>
          )}
          <SettingsGear accent="#22d3ee" />
        </div>
      </div>

      {/* 캔버스 스테이지 + 레인 터치 영역 */}
      <div ref={containerRef} className="relative flex-1">
        <canvas ref={canvasRef} className="block" />

        {/* 입력 영역 (플레이 중에만). 스윙은 폰이 조종하지만 화면 탭도 fallback 으로 허용 */}
        {ui.phase === 'playing' &&
          (ui.swing ? (
            <div
              className="absolute inset-0 touch-none active:bg-white/5"
              onPointerDown={(e) => {
                e.preventDefault()
                hitAnyRef.current()
              }}
            />
          ) : (
            <div
              className="absolute inset-0 flex justify-center touch-none"
              style={{ pointerEvents: 'none' }}
            >
              <div className="flex w-full max-w-[480px]" style={{ pointerEvents: 'auto' }}>
                {Array.from({ length: LANES }).map((_, i) => (
                  <div
                    key={i}
                    onPointerDown={onLaneDown(i)}
                    className="flex-1 h-full active:bg-white/5"
                  />
                ))}
              </div>
            </div>
          ))}

        {/* 콤보 (중앙 위, 네온) */}
        {ui.phase === 'playing' && ui.combo >= 3 && (
          <ComboCounter key={ui.combo} count={ui.combo} />
        )}

        {/* 판정 라벨 */}
        {label && (
          <div className="pointer-events-none absolute left-0 right-0 top-[52%] flex justify-center">
            <span
              className="text-3xl sm:text-4xl font-black italic animate-combo-pop"
              style={{
                color:
                  label.kind === 'perfect'
                    ? '#22d3ee'
                    : label.kind === 'good'
                      ? '#a3e635'
                      : '#f87171',
                textShadow:
                  label.kind === 'perfect'
                    ? '0 0 18px rgba(34,211,238,0.8)'
                    : label.kind === 'good'
                      ? '0 0 14px rgba(163,230,53,0.6)'
                      : '0 2px 8px rgba(0,0,0,0.6)',
              }}
            >
              {label.text}
            </span>
          </div>
        )}

        {/* 온라인: 상대 진행상황 HUD (플레이 중) */}
        {online && ui.phase === 'playing' && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-xs">
            <span className="text-white/50">상대</span>
            <span className="font-black tabular-nums text-[#f0abfc]">
              {(opp?.score ?? 0).toLocaleString()}
            </span>
            {opp && opp.combo >= 2 && (
              <span className="text-white/60">🔥{opp.combo}</span>
            )}
            {opp?.done && <span className="text-white/60">완주!</span>}
          </div>
        )}

        {/* 온라인 로비 */}
        {lobbyOpen && (
          <MatchLobby
            prefix="rt"
            title="리듬 탭 대전"
            accent="#a855f7"
            onMatched={onMatched}
            onCancel={() => setLobbyOpen(false)}
          />
        )}

        {/* 게스트: 방장이 곡을 시작하길 대기 */}
        {waitingStart && (
          <Overlay>
            <div className="text-4xl mb-3 animate-pulse">🎧</div>
            <p className="text-white/70">방장이 곡을 고르는 중…</p>
            <p className="text-white/40 text-sm mt-1">잠시만요! 같은 곡으로 대결해요.</p>
          </Overlay>
        )}

        {/* 상대 이탈 */}
        {oppLeft && (
          <Overlay>
            <div className="text-5xl mb-2">🔌</div>
            <h2 className="text-xl font-black mb-1">상대가 나갔어요</h2>
            <p className="text-white/60 mb-6 text-sm">연결이 끊어졌습니다.</p>
            <button
              onClick={onExit}
              className="px-8 py-3 rounded-2xl font-black active:brightness-110"
              style={{ background: 'linear-gradient(120deg,#6d28d9,#a855f7)' }}
            >
              게임 선택으로
            </button>
          </Overlay>
        )}

        {/* 시작 화면 */}
        {ui.phase === 'ready' && !online && !lobbyOpen && (
          <Overlay>
            <div className="text-5xl mb-2">🎵</div>
            <h1
              className="text-3xl font-black mb-1 tracking-tight"
              style={{ textShadow: '0 0 24px rgba(168,85,247,0.7)' }}
            >
              RHYTHM TAP
            </h1>
            <p className="text-white/55 text-sm mb-5 text-center leading-relaxed">
              내려오는 네온 노트가 <b className="text-[#22d3ee]">판정선</b>에 닿는 순간 그 줄을 탭!
              <br />
              정확할수록 <b className="text-[#22d3ee]">PERFECT</b> · 콤보를 이어가세요.
            </p>
            {phoneConnected && (
              <div className="mb-3 px-4 py-2 rounded-xl bg-[#22d3ee]/10 border border-[#22d3ee]/40 text-[#22d3ee] text-sm font-bold text-center animate-pulse">
                📱 폰 연결됨 — 아래 <b>🥁 폰으로 스윙</b> 을 누르세요!
              </div>
            )}
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {DIFFICULTIES.map((d, i) => (
                <button
                  key={d.key}
                  onClick={() => startGame(d)}
                  className="px-6 py-3 rounded-2xl font-black tracking-wide active:brightness-110 transition"
                  style={{
                    background:
                      i === 0
                        ? 'linear-gradient(120deg,#0e7490,#22d3ee)'
                        : i === 1
                          ? 'linear-gradient(120deg,#6d28d9,#a855f7)'
                          : 'linear-gradient(120deg,#be185d,#ec4899)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  }}
                >
                  {d.label}
                  <span className="ml-2 text-xs font-semibold text-white/70">
                    {d.opts.bpm} BPM
                  </span>
                </button>
              ))}
              <button
                onClick={startSwingNow}
                className="mt-1 px-6 py-3 rounded-2xl font-black active:brightness-110"
                style={{
                  background: 'linear-gradient(120deg,#7c3aed,#22d3ee)',
                  boxShadow: '0 8px 24px rgba(124,58,237,0.35)',
                }}
              >
                🥁 폰으로 스윙 (채로 내려치기)
                <span className="ml-2 text-xs font-semibold text-white/75">
                  {phoneConnected ? '· 폰 연결됨 🟢' : '· 키보드 OK'}
                </span>
              </button>
              <button
                onClick={() => {
                  // iOS: 로비 여는 이 탭(사용자 제스처) 안에서 오디오를 미리 깨운다.
                  // (호스트 시작은 소켓 이벤트라 제스처 밖 → 여기서 unlock 필요)
                  audioRef.current?.unlock()
                  setLobbyOpen(true)
                }}
                className="px-6 py-3 rounded-2xl bg-white/8 border border-white/15 text-white/85 font-bold active:bg-white/15"
              >
                🌐 온라인 1:1 · 같은 곡 점수 대결
              </button>
            </div>
            {likelyKeyboard ? (
              // 키보드 기기: 각 레인 = 어떤 키인지 색맞춰 또렷하게 안내
              <div className="mt-6 flex flex-col items-center gap-2">
                <span className="text-white/50 text-xs">⌨️ 키보드로 각 줄을 연주하세요</span>
                <div className="flex gap-2">
                  {LANE_KEY_LABELS.map((k, i) => (
                    <span
                      key={k}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border-2 font-black text-base"
                      style={{
                        borderColor: LANE_COLORS[i],
                        color: LANE_COLORS[i],
                        background: `${LANE_COLORS[i]}1a`,
                        boxShadow: `0 0 10px ${LANE_COLORS[i]}55`,
                      }}
                    >
                      {k}
                    </span>
                  ))}
                </div>
                <span className="text-white/30 text-xs">📱 폰은 화면의 각 줄을 터치</span>
              </div>
            ) : (
              <p className="text-white/35 text-xs mt-6 text-center">
                📱 내려오는 노트를 각 줄에서 <b className="text-white/55">터치</b>
              </p>
            )}
            {!phoneConnected && (
              <p className="text-white/30 text-xs mt-2 text-center">
                🥁 스윙은 게임 선택 화면에서 <b className="text-white/50">폰 연결</b> 먼저 (없으면 키보드
                Space/↓)
              </p>
            )}
          </Overlay>
        )}

        {/* 결과 화면 */}
        {ui.phase === 'result' && !oppLeft && (
          <Overlay>
            {online ? (
              // ── 온라인: 상대 점수와 비교 ──
              (() => {
                const oppDone = !!opp?.done
                const oppScore = opp?.score ?? 0
                const iWin = ui.score >= oppScore
                return (
                  <>
                    {oppDone ? (
                      <>
                        <div className="text-6xl mb-1">{iWin ? '🏆' : '😢'}</div>
                        <h2
                          className="text-3xl font-black mb-4"
                          style={{ color: iWin ? '#22d3ee' : '#f87171' }}
                        >
                          {ui.score === oppScore ? '무승부!' : iWin ? '승리!' : '패배'}
                        </h2>
                        <div className="flex items-center gap-6 mb-4">
                          <div className="text-center">
                            <div className="label-mono text-white/40">나</div>
                            <div className="text-3xl font-black tabular-nums text-[#22d3ee]">
                              {ui.score.toLocaleString()}
                            </div>
                          </div>
                          <span className="text-white/30 text-xl font-black">:</span>
                          <div className="text-center">
                            <div className="label-mono text-white/40">상대</div>
                            <div className="text-3xl font-black tabular-nums text-[#f0abfc]">
                              {oppScore.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-5xl mb-2 animate-pulse">⏳</div>
                        <h2 className="text-xl font-black mb-1">완주!</h2>
                        <p className="text-white/60 text-sm mb-4">
                          내 점수 <b className="text-[#22d3ee]">{ui.score.toLocaleString()}</b> · 상대
                          마무리를 기다리는 중…
                        </p>
                      </>
                    )}
                    <div className="flex gap-5 text-xs text-white/60 mb-1">
                      <span>MAX COMBO {ui.maxCombo}</span>
                      <span>ACC {(ui.acc * 100).toFixed(1)}%</span>
                    </div>
                    {online.role === 'host' ? (
                      <button
                        onClick={() => onMatched('host')}
                        className="mt-6 px-8 py-3 rounded-2xl font-black active:brightness-110"
                        style={{ background: 'linear-gradient(120deg,#6d28d9,#a855f7)' }}
                      >
                        다시 대결
                      </button>
                    ) : (
                      <p className="mt-6 text-sm text-white/50">방장이 다시 시작하면 이어집니다…</p>
                    )}
                    <button onClick={onExit} className="mt-3 text-sm text-white/50 underline">
                      나가기
                    </button>
                  </>
                )
              })()
            ) : (
              // ── 솔로: 등급/통계 ──
              <>
                <div
                  className="text-7xl font-black mb-1"
                  style={{ color: g.color, textShadow: `0 0 30px ${g.color}` }}
                >
                  {g.letter}
                </div>
                <h2 className="text-xl font-black mb-4">
                  {ui.acc >= 0.9 ? 'AMAZING!' : ui.acc >= 0.7 ? 'GOOD JOB!' : 'CLEAR'}
                </h2>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm mb-1">
                  <Stat label="SCORE" value={ui.score.toLocaleString()} color="#ffffff" />
                  <Stat label="MAX COMBO" value={`${ui.maxCombo}`} color="#a855f7" />
                  <Stat label="PERFECT" value={`${total.perfect}`} color="#22d3ee" />
                  <Stat label="GOOD" value={`${total.good}`} color="#a3e635" />
                  <Stat label="MISS" value={`${total.miss}`} color="#f87171" />
                  <Stat label="ACC" value={`${(ui.acc * 100).toFixed(1)}%`} color="#e879f9" />
                </div>
                <button
                  onClick={() => (ui.swing ? startSwingRef.current() : startGame(DIFFICULTIES[1]))}
                  className="mt-6 px-8 py-3 rounded-2xl font-black active:brightness-110"
                  style={{ background: 'linear-gradient(120deg,#6d28d9,#a855f7)' }}
                >
                  다시 하기
                </button>
                <button onClick={onExit} className="mt-3 text-sm text-white/50 underline">
                  다른 게임 고르기
                </button>
              </>
            )}
          </Overlay>
        )}
      </div>
    </div>
  )
}

/** 네온 노트 (둥근 사각형 + 글로우 + 위쪽 하이라이트) */
function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string) {
  const h = 24
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 16
  ctx.fillStyle = color
  roundRectPath(ctx, x, y - h / 2, w, h, 8)
  ctx.fill()
  // 위쪽 밝은 라인 (입체감)
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  roundRectPath(ctx, x + 3, y - h / 2 + 3, w - 6, 5, 3)
  ctx.fill()
  ctx.restore()
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** 콤보 카운터 — 콤보가 오를수록 뜨거워지는 색/크기 (리마운트로 팝 애니메이션) */
function ComboCounter({ count }: { count: number }) {
  const tier =
    count >= 40
      ? { color: '#ec4899', glow: '0 0 26px rgba(236,72,153,0.8)' }
      : count >= 20
        ? { color: '#a855f7', glow: '0 0 22px rgba(168,85,247,0.75)' }
        : { color: '#22d3ee', glow: '0 0 18px rgba(34,211,238,0.7)' }
  return (
    <div className="pointer-events-none absolute top-[12%] left-1/2 -translate-x-1/2 text-center animate-combo-hit">
      <div
        className="text-6xl font-black tabular-nums leading-none"
        style={{ color: tier.color, textShadow: tier.glow }}
      >
        {count}
      </div>
      <div className="label-mono text-white/60 mt-1">COMBO</div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="label-mono text-white/40">{label}</span>
      <span className="font-black tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  )
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#060309]/88 backdrop-blur-sm px-6">
      {children}
    </div>
  )
}

/**
 * AudioEngine — WebAudio 로 "곡"을 실시간 합성.
 * -------------------------------------------------------------
 * 음원 파일이 없으니 킥/하이햇/멜로디를 오실레이터로 만든다.
 * scheduleSong() 이 채보의 모든 소리 이벤트를 audioCtx 시계에 예약하고,
 * 짧은 주기(setInterval)로 lookahead 만큼 앞당겨 실제 노드로 실행한다.
 * (곡 시계와 화면 시계는 둘 다 실시간이라 자동으로 대략 맞는다)
 */
interface SoundEvent {
  t: number // audioCtx.currentTime 기준 재생 시각(초)
  kind: 'kick' | 'hat' | 'melody'
  freq?: number
}

const MASTER_VOL = 0.5

class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private events: SoundEvent[] = []
  private nextIdx = 0
  private timer: number | null = null
  private muted = false

  /** 사용자 제스처(시작 버튼) 안에서 호출 → iOS 포함 오디오 깨우기 */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new Ctx()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : MASTER_VOL
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      // 오디오 불가 환경이면 조용히 무시(게임은 계속됨)
    }
  }

  /** 설정의 "소리" 스위치. unlock 보다 먼저 불려도 되게 muted 를 기억해 둔다. */
  setMuted(muted: boolean) {
    this.muted = muted
    if (this.master) this.master.gain.value = muted ? 0 : MASTER_VOL
  }

  /** 채보를 소리 이벤트로 펼쳐서 예약 시작. startDelaySec 후 곡 0ms 시작. */
  scheduleSong(map: Beatmap, startDelaySec: number) {
    if (!this.ctx) return
    const t0 = this.ctx.currentTime + startDelaySec
    const events: SoundEvent[] = []
    // 킥(매 박) + 하이햇(엇박)
    const beats = Math.ceil(map.durationMs / map.beatMs)
    for (let b = 0; b < beats; b++) {
      events.push({ t: t0 + (b * map.beatMs) / 1000, kind: 'kick' })
      events.push({ t: t0 + ((b + 0.5) * map.beatMs) / 1000, kind: 'hat' })
    }
    // 멜로디: 각 노트를 펜타토닉 음으로 (레인별 음정) → 맞추면 곡처럼 들림
    const penta = [261.63, 311.13, 349.23, 392.0, 466.16, 523.25] // C Eb F G Bb C (마이너 펜타)
    for (const n of map.notes) {
      const freq = penta[(n.lane * 2 + (n.id % 2)) % penta.length] * (n.lane >= 2 ? 2 : 1)
      events.push({ t: t0 + n.time / 1000, kind: 'melody', freq })
    }
    events.sort((a, b) => a.t - b.t)
    this.events = events
    this.nextIdx = 0
    if (this.timer) window.clearInterval(this.timer)
    // 25ms 마다 앞으로 120ms 안에 올 이벤트를 미리 노드로 예약
    this.timer = window.setInterval(() => this.tick(), 25)
  }

  private tick() {
    if (!this.ctx) return
    const ahead = this.ctx.currentTime + 0.12
    while (this.nextIdx < this.events.length && this.events[this.nextIdx].t <= ahead) {
      const ev = this.events[this.nextIdx++]
      if (ev.kind === 'kick') this.kick(ev.t)
      else if (ev.kind === 'hat') this.hat(ev.t)
      else this.tone(ev.freq ?? 440, ev.t, 0.18, 'triangle', 0.12)
    }
    if (this.nextIdx >= this.events.length && this.timer) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 즉시 재생되는 손맛 효과음(탭 판정) */
  playHit(kind: JudgeKind) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    if (kind === 'perfect') this.tone(880, t, 0.09, 'square', 0.16)
    else this.tone(560, t, 0.07, 'square', 0.1)
  }

  stopSong() {
    if (this.timer) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    this.events = []
    this.nextIdx = 0
  }

  dispose() {
    this.stopSong()
    try {
      void this.ctx?.close()
    } catch {
      /* 무시 */
    }
    this.ctx = null
  }

  // ── 소리 만들기 (아주 짧은 엔벨로프) ──
  private kick(at: number) {
    if (!this.ctx || !this.master) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, at)
    osc.frequency.exponentialRampToValueAtTime(48, at + 0.12)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(0.9, at + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16)
    osc.connect(g).connect(this.master)
    osc.start(at)
    osc.stop(at + 0.2)
  }

  private hat(at: number) {
    if (!this.ctx || !this.master) return
    // 짧은 고역 노이즈 대용: 높은 사각파를 아주 짧게
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 8000
    g.gain.setValueAtTime(0.08, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03)
    osc.connect(g).connect(this.master)
    osc.start(at)
    osc.stop(at + 0.04)
  }

  private tone(
    freq: number,
    at: number,
    dur: number,
    type: OscillatorType,
    vol: number,
  ) {
    if (!this.ctx || !this.master) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(vol, at + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    osc.connect(g).connect(this.master)
    osc.start(at)
    osc.stop(at + dur + 0.02)
  }
}
