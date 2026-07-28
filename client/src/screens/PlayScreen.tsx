import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DiceBoard from '../games/yacht/DiceBoard'
import ScoreBoard from '../components/ScoreBoard'
import PlayerStrip from '../components/PlayerStrip'
import RoundTimer from '../components/RoundTimer'
import ReactionDock from '../components/ReactionDock'
import { useMotionDice } from '../hooks/useMotionDice'
import { feedbackShake, unlockAudio } from '../lib/feedback'
import { CategoryId, scoreFor } from '../game/yacht'
import { REACTION_EMOJI, type PlayerState, type ReactionType, type RoomState } from '../net/types'

/**
 * PlayScreen — 온라인 방에서의 요트 플레이 화면
 * -------------------------------------------------------------
 * 주사위 연출은 솔로와 완전히 같은 3D 보드(games/yacht/DiceBoard)를 쓴다.
 * 화면 전체를 .yd 로 감싸면 팔레트가 다크 프리미엄으로 바뀌고,
 * 타이머·플레이어 스트립·리액션 독처럼 공통 변수만 쓰는 컴포넌트는
 * 코드를 고치지 않아도 그대로 따라온다.
 *
 * "구르는 중" 잠금은 타이머가 아니라 보드가 실제로 멈췄다고 알려줄 때 풀린다.
 */

const MAX_ROLLS = 3
const ROLL_DEBOUNCE_MS = 1600

function randomFace() {
  return 1 + Math.floor(Math.random() * 6)
}

export interface PlayScreenProps {
  room: RoomState
  you: PlayerState
  onRoll: (dice: number[], rollsLeft: number) => void
  onScore: (categoryId: CategoryId, score: number) => void
  onReact: (type: ReactionType) => void
  subscribeReaction: (cb: (r: { playerId: string; type: ReactionType }) => void) => () => void
}

interface Float {
  id: number
  emoji: string
  left: number
}

const FRESH: boolean[] = [false, false, false, false, false]

export default function PlayScreen({
  room,
  you,
  onRoll,
  onScore,
  onReact,
  subscribeReaction,
}: PlayScreenProps) {
  const [values, setValues] = useState<number[]>([1, 2, 3, 4, 5])
  const [kept, setKept] = useState<boolean[]>(FRESH)
  const [rollsLeft, setRollsLeft] = useState(MAX_ROLLS)
  const [rolled, setRolled] = useState(false)
  const [rollKey, setRollKey] = useState(0)
  const [tumbling, setTumbling] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [motionOn, setMotionOn] = useState(false)
  const [floats, setFloats] = useState<Float[]>([])

  const lastRollAt = useRef(0)
  const floatId = useRef(0)

  // 접근성: 모션 최소화 설정
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  )

  // 라운드 바뀌면 로컬 초기화
  useEffect(() => {
    setKept(FRESH)
    setRollsLeft(MAX_ROLLS)
    setRolled(false)
    setRollKey(0)
    setTumbling(false)
    setSubmitting(false)
  }, [room.round])

  // 리액션 수신 → 떠오르는 이모지
  useEffect(() => {
    const off = subscribeReaction(({ type }) => {
      const id = floatId.current++
      const left = 15 + Math.random() * 70
      setFloats((f) => [...f, { id, emoji: REACTION_EMOJI[type], left }])
      window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1100)
    })
    return off
  }, [subscribeReaction])

  const locked = you.done || submitting
  const canRoll = rollsLeft > 0 && !locked && !tumbling

  const roll = useCallback(() => {
    if (rollsLeft <= 0 || locked || tumbling) return
    unlockAudio()
    const next = values.map((v, i) => (kept[i] ? v : randomFace()))
    const left = rollsLeft - 1
    setValues(next)
    setRolled(true)
    setRollsLeft(left)
    setRollKey((k) => k + 1)
    setTumbling(true)
    onRoll(next, left)
    feedbackShake()
  }, [values, kept, rollsLeft, locked, tumbling, onRoll])

  const requestRoll = useCallback(() => {
    const now = Date.now()
    if (now - lastRollAt.current < ROLL_DEBOUNCE_MS) return
    if (rollsLeft <= 0 || locked || tumbling) return
    lastRollAt.current = now
    roll()
  }, [roll, rollsLeft, locked, tumbling])

  // 센서(흔들기)도 같은 roll() 로 연결 — 수동 버튼과 동일 동작
  const { permission, requestPermission } = useMotionDice({
    onShake: requestRoll,
    onThrow: requestRoll,
    enabled: motionOn && !locked && !tumbling,
  })

  /** 주사위가 다 멈췄다 — 자리마다 어떤 눈이 놓였는지 확정 */
  const onSettle = useCallback((shown: number[]) => {
    setValues(shown)
    setTumbling(false)
  }, [])

  const toggleKeep = (index: number) => {
    if (!rolled || locked || tumbling) return
    setKept((prev) => prev.map((k, i) => (i === index ? !k : k)))
  }

  const assign = (id: CategoryId) => {
    if (!rolled || locked || tumbling) return
    setSubmitting(true)
    onScore(id, scoreFor(id, values))
  }

  const enableMotion = async () => {
    unlockAudio()
    await requestPermission()
    setMotionOn(true)
  }

  return (
    <div className="yd min-h-full">
      <div className="relative w-full max-w-5xl mx-auto flex flex-col px-4 pt-3 pb-5">
        {/* 헤더 */}
        <header className="flex items-center justify-between mb-3">
          <div className="leading-none">
            <span className="text-lg font-black text-[var(--ink)]">요트 다이스</span>
            <span className="label-mono text-[var(--gold)] opacity-70 ml-2">YACHT</span>
          </div>
          <div className="yd-pill tabular-nums">
            <span className="tracking-[0.2em] text-[var(--gold-2)]">{room.code}</span>
            <span className="mx-1.5 opacity-30">·</span>R {room.round}/{room.totalRounds}
          </div>
        </header>

        {/* 타이머 */}
        <div className="mb-3">
          <RoundTimer deadline={room.deadline} />
        </div>

        {/* 플레이어 스트립 */}
        <div className="mb-3">
          <PlayerStrip players={room.players} youId={you.id} />
        </div>

        {/* 2단 구성: 왼쪽 플레이 영역 / 오른쪽 점수판 (모바일에선 아래로 쌓임) */}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-4 lg:gap-5 items-start">
          {/* ── 왼쪽: 3D 보드 + 굴리기 CTA ── */}
          <section className="flex flex-col min-w-0">
            <DiceBoard
              values={values}
              kept={kept}
              rollKey={rollKey}
              reducedMotion={reducedMotion}
              disabled={locked || tumbling || !rolled}
              onToggleKeep={toggleKeep}
              onSettle={onSettle}
            />

            <div className="flex items-center justify-between mt-3 mb-2 px-0.5">
              <div className="flex items-center gap-1.5" aria-label={`남은 굴리기 ${rollsLeft}번`}>
                {Array.from({ length: MAX_ROLLS }, (_, i) => (
                  <span key={i} className={`yd-dot ${i < rollsLeft ? 'on' : ''}`} />
                ))}
                <span className="text-[11px] text-[var(--ink-3)] ml-1.5">남은 굴리기</span>
              </div>
              <span className="text-[11px] text-[var(--ink-3)]">
                {rolled ? '주사위를 탭하면 고정' : '흔들거나 눌러서 굴리기'}
              </span>
            </div>

            <button onClick={roll} disabled={!canRoll} aria-label="주사위 굴리기" className="yd-cta">
              {locked
                ? '다른 플레이어 기다리는 중…'
                : tumbling
                  ? '구르는 중…'
                  : rollsLeft > 0
                    ? rolled
                      ? `다시 굴리기 · ${rollsLeft}번 남음`
                      : '굴리기'
                    : '기록할 칸을 선택하세요'}
            </button>
            {permission !== 'granted' && (
              <button onClick={enableMotion} className="yd-link mt-2">
                📳 흔들어서 굴리기 켜기 (센서)
              </button>
            )}
          </section>

          {/* ── 오른쪽: 점수판 (넓은 화면에선 스크롤 시 상단 고정) ── */}
          <aside className="yd-card lg:sticky lg:top-3 min-w-0">
            <div className="yd-sec">SCORE BOARD · 점수판</div>
            <ScoreBoard
              players={room.players}
              youId={you.id}
              canAssign={rolled && !locked && !tumbling}
              previewScore={(id) => scoreFor(id, values)}
              onAssign={assign}
            />
          </aside>
        </div>

        {/* 리액션 독 (하단 전체 폭) */}
        <div className="mt-5">
          <ReactionDock onReact={onReact} />
        </div>

        {/* 떠오르는 리액션 오버레이 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-16 h-40 overflow-hidden">
          {floats.map((f) => (
            <span
              key={f.id}
              className="absolute bottom-0 text-3xl animate-reaction"
              style={{ left: `${f.left}%` }}
            >
              {f.emoji}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
