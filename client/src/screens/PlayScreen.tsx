import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DiceTray from '../components/DiceTray'
import ScoreBoard from '../components/ScoreBoard'
import PlayerStrip from '../components/PlayerStrip'
import RoundTimer from '../components/RoundTimer'
import ReactionDock from '../components/ReactionDock'
import { useMotionDice } from '../hooks/useMotionDice'
import { feedbackShake, feedbackThrow, unlockAudio } from '../lib/feedback'
import { CategoryId, scoreFor } from '../game/yacht'
import { REACTION_EMOJI, type PlayerState, type ReactionType, type RoomState } from '../net/types'

const MAX_ROLLS = 3
const ROLL_DEBOUNCE_MS = 1600
const TUMBLE_MS = 1600 // 굴러 멈추기까지(약 1.5초 + 여유). 이 동안 킵/기록 잠금

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

export default function PlayScreen({
  room,
  you,
  onRoll,
  onScore,
  onReact,
  subscribeReaction,
}: PlayScreenProps) {
  const [values, setValues] = useState<number[]>([1, 1, 1, 1, 1])
  const [kept, setKept] = useState<boolean[]>([false, false, false, false, false])
  const [rollsLeft, setRollsLeft] = useState(MAX_ROLLS)
  const [rolled, setRolled] = useState(false)
  const [rollKey, setRollKey] = useState(0)
  const [tumbling, setTumbling] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [motionOn, setMotionOn] = useState(false)
  const [floats, setFloats] = useState<Float[]>([])

  const lastRollAt = useRef(0)
  const tumbleTimer = useRef<number | null>(null)
  const floatId = useRef(0)

  // 접근성: 모션 최소화 설정
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  )

  // 라운드 바뀌면 로컬 초기화
  useEffect(() => {
    if (tumbleTimer.current) window.clearTimeout(tumbleTimer.current)
    setValues([1, 1, 1, 1, 1])
    setKept([false, false, false, false, false])
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
    const next = values.map((v, i) => (kept[i] ? v : randomFace()))
    const left = rollsLeft - 1
    setValues(next)
    setRolled(true)
    setRollsLeft(left)
    setRollKey((k) => k + 1)
    onRoll(next, left)
    feedbackShake()

    if (reducedMotion) {
      feedbackThrow()
      return
    }
    setTumbling(true)
    if (tumbleTimer.current) window.clearTimeout(tumbleTimer.current)
    tumbleTimer.current = window.setTimeout(() => {
      setTumbling(false)
      feedbackThrow() // 착지 '툭'
    }, TUMBLE_MS)
  }, [values, kept, rollsLeft, locked, tumbling, onRoll, reducedMotion])

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
    <div className="relative min-h-full w-full max-w-5xl mx-auto flex flex-col px-4 pt-3 pb-5">
      {/* 헤더 */}
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-black text-[var(--ink)]">요르</span>
          <span className="label-mono text-[var(--ink-3)]">YORR</span>
        </div>
        <div className="text-right text-xs text-[var(--ink-2)]">
          <span className="font-mono tracking-widest text-[var(--ink)]">{room.code}</span>
          <span className="mx-1.5 text-[var(--line-2)]">·</span>R {room.round}/{room.totalRounds}
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
      <div className="grid lg:grid-cols-[1fr_360px] gap-4 lg:gap-5 items-start">
        {/* ── 왼쪽: 다이스 트레이 + 굴리기 CTA ── */}
        <section className="flex flex-col">
          <DiceTray
            values={values}
            kept={kept}
            rollKey={rollKey}
            rolled={rolled}
            reducedMotion={reducedMotion}
            disabled={locked || tumbling}
            onToggleKeep={toggleKeep}
          />

          <button
            onClick={() => {
              unlockAudio()
              roll()
            }}
            disabled={!canRoll}
            aria-label="주사위 굴리기"
            className="w-full py-4 mt-3 rounded-2xl text-white text-lg font-black shadow-md disabled:opacity-45 transition-[filter] active:brightness-95"
            style={{ background: rollsLeft > 0 ? 'var(--coral)' : 'var(--ink-3)' }}
          >
            {locked
              ? '다른 플레이어 기다리는 중…'
              : tumbling
                ? '구르는 중…'
                : rollsLeft > 0
                  ? `흔들어서 굴리기 · ${rollsLeft}번 남음`
                  : '기록할 칸을 선택하세요'}
          </button>
          {permission !== 'granted' && (
            <button
              onClick={enableMotion}
              className="mt-2 mx-auto text-xs text-[var(--ink-2)] underline"
            >
              📳 흔들어서 굴리기 켜기 (센서)
            </button>
          )}
        </section>

        {/* ── 오른쪽: 점수판 (넓은 화면에선 스크롤 시 상단 고정) ── */}
        <aside className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 lg:sticky lg:top-3">
          <div className="label-mono text-[var(--ink-3)] mb-2">SCORE BOARD · 점수판</div>
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
  )
}
