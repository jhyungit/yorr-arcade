import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DiceBoard from '../games/yacht/DiceBoard'
import ScoreBoard from '../components/ScoreBoard'
import PlayerStrip, { seatColor } from '../components/PlayerStrip'
import RoundTimer from '../components/RoundTimer'
import ReactionDock from '../components/ReactionDock'
import { useMotionDice } from '../hooks/useMotionDice'
import { notifyDiceLanded, usePhoneRoll } from '../games/yacht/usePhoneRoll'
import { useWakeLock } from '../lib/wakeLock'
import { feedbackShake, feedbackThrow, unlockAudio } from '../lib/feedback'
import { CATEGORIES, CategoryId, calloutHand, scoreFor } from '../game/yacht'
import {
  REACTION_EMOJI,
  type PlayerState,
  type ReactionType,
  type RoomLog,
  type RoomState,
} from '../net/types'

/**
 * PlayScreen — 온라인 방에서의 요트 플레이 화면 (턴제)
 * -------------------------------------------------------------
 * 보드는 화면에 하나뿐이고, "지금 차례인 사람의 주사위"를 모두가 같이 본다.
 * 주사위 눈은 서버가 정하므로(room.dice) 6명의 화면에 같은 숫자가 뜬다.
 * 굴리는 연출은 각자의 물리로 돌지만 착지하는 눈이 같아 어긋나 보이지 않는다.
 *
 * 상태를 어떻게 맞추나
 *  - room.turnSeq 가 바뀌면 → 차례가 넘어갔다. 판을 새로 깐다(rollKey=0).
 *  - room.rollSeq 가 바뀌면 → 누가 굴렸다. 굴리기 연출을 재생한다(rollKey+1).
 *  - "구르는 중" 잠금은 타이머가 아니라 보드가 실제로 멈췄다고 알려줄 때 풀린다.
 * 내 차례가 아니면 모든 조작이 잠기고 관전만 한다.
 */

const MAX_ROLLS = 3
const FRESH_DICE = [1, 2, 3, 4, 5]

/** 족보 콜아웃 문구·급·색 (솔로와 같은 연출 — 관전자도 같이 본다) */
const CALLOUT: Record<string, { text: string; tier: 'big' | 'mid' | 'low'; color: string }> = {
  yacht: { text: '요트!!!', tier: 'big', color: '#ffd76a' },
  largeStraight: { text: '라지 스트레이트!', tier: 'mid', color: '#7fe3c4' },
  fourKind: { text: '포카드!', tier: 'mid', color: '#ffb066' },
  fullHouse: { text: '풀하우스!', tier: 'mid', color: '#f0a2d8' },
  smallStraight: { text: '스몰 스트레이트~', tier: 'low', color: '#a8d5ff' },
}

export interface PlayScreenProps {
  room: RoomState
  you: PlayerState
  isMyTurn: boolean
  /** 페어링된 폰이 붙어 있는가 (허브에서 연결) */
  phoneConnected?: boolean
  onRoll: () => void
  onToggleKeep: (index: number) => void
  onScore: (categoryId: CategoryId) => void
  onReact: (type: ReactionType) => void
  onLeave: () => void
  subscribeReaction: (cb: (r: { playerId: string; type: ReactionType }) => void) => () => void
  subscribeLog: (cb: (log: RoomLog) => void) => () => void
}

interface Float {
  id: number
  emoji: string
  left: number
  color: string
}

export default function PlayScreen({
  room,
  you,
  isMyTurn,
  phoneConnected = false,
  onRoll,
  onToggleKeep,
  onScore,
  onReact,
  onLeave,
  subscribeReaction,
  subscribeLog,
}: PlayScreenProps) {
  // 화면에 그리는 주사위 — 서버 값을 받아 연출과 함께 갱신한다
  const [boardValues, setBoardValues] = useState<number[]>(FRESH_DICE)
  /* -1 로 시작하는 이유: 아래 첫 이펙트가 rollKey 를 0(=판 새로 깔기)으로 바꿀 때
     "값이 달라졌다"가 되어야 DiceBoard 가 서버 주사위로 판을 다시 깐다.
     0 으로 시작하면 변화가 없어서, 굴리는 중에 재접속·중간 관전으로 들어온 사람은
     실제 주사위와 다른 1,2,3,4,5 를 계속 보게 된다. */
  const [rollKey, setRollKey] = useState(-1)
  const [tumbling, setTumbling] = useState(false)
  const [selected, setSelected] = useState<CategoryId | null>(null)
  const [motionOn, setMotionOn] = useState(false)
  const [floats, setFloats] = useState<Float[]>([])
  const [callout, setCallout] = useState<{ id: number; cat: CategoryId } | null>(null)
  const [lastLog, setLastLog] = useState<RoomLog | null>(null)

  const floatId = useRef(0)
  const calloutSeq = useRef(0)
  const calloutTimer = useRef<number | null>(null)
  const logTimer = useRef<number | null>(null)
  // 이번 차례에 이미 외친 족보 — 리롤마다 같은 걸 또 외치면 시끄럽다
  const announced = useRef<Set<CategoryId>>(new Set())
  const lastTurn = useRef(-1)
  const lastRoll = useRef(-1)

  // 접근성: 모션 최소화 설정
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  )

  // 남의 차례를 기다리는 동안 화면이 꺼지면 안 된다
  useWakeLock(true)

  const active = room.players.find((p) => p.id === room.turnId) ?? null
  const activeDice = active?.dice ?? FRESH_DICE
  const activeKept = active?.kept ?? [false, false, false, false, false]
  const rollsLeft = active?.rollsLeft ?? 0
  const rolled = !!active?.rolled

  /* ── 서버 상태 → 보드 연출 ──
     turnSeq 가 바뀌면 판을 새로 깔고, rollSeq 가 바뀌면 굴린다. */
  useEffect(() => {
    if (room.turnSeq !== lastTurn.current) {
      lastTurn.current = room.turnSeq
      lastRoll.current = room.rollSeq
      setBoardValues(activeDice)
      setRollKey(0) // 0 = 판 새로 깔기 (DiceBoard 규약)
      setTumbling(false)
      setSelected(null)
      announced.current.clear()
      return
    }
    if (room.rollSeq !== lastRoll.current) {
      lastRoll.current = room.rollSeq
      setBoardValues(activeDice)
      setRollKey((k) => k + 1)
      setTumbling(true)
      setSelected(null)
      feedbackShake()
    }
    // activeDice 는 seq 와 함께 갱신되므로 의존성은 seq 두 개로 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.turnSeq, room.rollSeq])

  /** 주사위가 다 멈췄다 — 족보가 성립하면 모두에게 크게 알린다 */
  const onSettle = useCallback(
    (shown: number[]) => {
      setBoardValues(shown)
      setTumbling(false)
      notifyDiceLanded() // 페어링된 폰에도 착지를 알린다 (짧은 진동)
      const sheet = active?.sheet
      if (!sheet) return
      const cat = calloutHand(shown, sheet)
      if (!cat || announced.current.has(cat)) return
      announced.current.add(cat)
      calloutSeq.current += 1
      setCallout({ id: calloutSeq.current, cat })
      if (CALLOUT[cat].tier === 'big') feedbackThrow()
      if (calloutTimer.current) window.clearTimeout(calloutTimer.current)
      calloutTimer.current = window.setTimeout(() => setCallout(null), 1600)
    },
    [active?.sheet],
  )

  // 리액션 수신 → 떠오르는 이모지
  useEffect(() => {
    const off = subscribeReaction(({ playerId, type }) => {
      const id = floatId.current++
      setFloats((f) => [
        ...f,
        { id, emoji: REACTION_EMOJI[type], left: 12 + Math.random() * 76, color: seatColor(playerId) },
      ])
      window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1100)
    })
    return off
  }, [subscribeReaction])

  // 진행 로그 — "누가 어디에 몇 점" 을 잠깐 띄운다
  useEffect(() => {
    const off = subscribeLog((log) => {
      setLastLog(log)
      if (logTimer.current) window.clearTimeout(logTimer.current)
      logTimer.current = window.setTimeout(() => setLastLog(null), 3200)
    })
    return off
  }, [subscribeLog])

  useEffect(
    () => () => {
      if (calloutTimer.current) window.clearTimeout(calloutTimer.current)
      if (logTimer.current) window.clearTimeout(logTimer.current)
    },
    [],
  )

  /* ── 조작 (내 차례에만) ── */
  const canRoll = isMyTurn && rollsLeft > 0 && !tumbling
  const canAssign = isMyTurn && rolled && !tumbling

  const roll = useCallback(() => {
    if (!canRoll) return
    unlockAudio()
    onRoll() // 실제 눈은 서버가 정한다 → room.rollSeq 로 되돌아온다
  }, [canRoll, onRoll])

  // 센서(흔들기)로도 굴린다 — 내 차례가 아니면 아예 안 듣는다
  const { permission, requestPermission } = useMotionDice({
    onShake: roll,
    onThrow: roll,
    enabled: motionOn && canRoll,
  })

  // 노트북을 화면으로 쓰고 "페어링한 폰"을 흔드는 경로 (ctrl:swing).
  // canRoll 이 내 차례·굴리기 남음·구르는 중 아님을 이미 다 본다.
  usePhoneRoll({ onRoll: roll, enabled: canRoll })

  const toggleKeep = (index: number) => {
    if (!isMyTurn || !rolled || tumbling) return
    onToggleKeep(index)
  }

  const commit = () => {
    if (!selected || !canAssign) return
    onScore(selected)
    setSelected(null)
  }

  const enableMotion = async () => {
    unlockAudio()
    await requestPermission()
    setMotionOn(true)
  }

  /* ── 아래 큰 버튼: 상황에 따라 굴리기 / 기록 / 관전 ── */
  const selLabel = selected ? CATEGORIES.find((c) => c.id === selected)?.label : ''
  const mode: 'wait' | 'tumbling' | 'commit' | 'roll' | 'pick' = !isMyTurn
    ? 'wait'
    : tumbling
      ? 'tumbling'
      : selected
        ? 'commit'
        : rollsLeft > 0
          ? 'roll'
          : 'pick'

  const ctaText =
    mode === 'wait'
      ? tumbling
        ? `${active?.nickname ?? '상대'}님이 굴리는 중…`
        : `${active?.nickname ?? '상대'}님의 차례 — 관전 중`
      : mode === 'tumbling'
        ? '구르는 중…'
        : mode === 'commit'
          ? `${selLabel} · ${scoreFor(selected!, boardValues)}점 기록`
          : mode === 'roll'
            ? rolled
              ? `다시 굴리기 · ${rollsLeft}번 남음`
              : '굴리기'
            : '기록할 칸을 고르세요'

  return (
    <div className="yd min-h-full">
      <div className="relative mx-auto flex w-full max-w-5xl flex-col px-4 pb-6 pt-3 xl:max-w-6xl">
        {/* 헤더 */}
        <header className="mb-2.5 flex items-center justify-between gap-3">
          <button onClick={onLeave} className="yd-ghost" aria-label="방에서 나가기">
            ‹ 나가기
          </button>
          <div className="text-center leading-none">
            <div className="font-display text-base font-black text-[var(--ink)]">요트 다이스</div>
            <div className="label-mono mt-0.5 text-[var(--gold)] opacity-70">
              {room.players.length}인 턴제
            </div>
          </div>
          <div className="yd-pill tabular-nums">
            <span className="tracking-[0.14em] text-[var(--gold-2)]">{room.code}</span>
            <span className="mx-1.5 opacity-30">·</span>R {room.round}/{room.totalRounds}
          </div>
        </header>

        {/* 차례 안내 + 남은 시간 */}
        <div className="yd-turnbar" data-mine={isMyTurn ? 1 : 0}>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ background: active ? seatColor(active.id) : 'var(--ink-3)' }}
            >
              {(active?.nickname ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-[13px] font-bold">
              {isMyTurn ? '내 차례!' : `${active?.nickname ?? '…'}님의 차례`}
            </span>
            {isMyTurn && (
              <span className="hidden text-[11px] text-[var(--ink-2)] sm:inline">
                {rolled ? '남길 주사위를 탭 → 칸 선택' : '굴려서 시작하세요'}
              </span>
            )}
          </span>
          <span className="w-28 shrink-0 sm:w-40">
            <RoundTimer deadline={room.deadline} totalMs={room.turnMs} />
          </span>
        </div>

        {/* 플레이어 스트립 */}
        <div className="mb-3 mt-2.5">
          <PlayerStrip
            players={room.players}
            youId={you.id}
            turnId={room.turnId}
            hostId={room.hostId}
          />
        </div>

        {/* 2단 구성: 왼쪽 플레이 영역 / 오른쪽 점수판 (모바일에선 아래로 쌓임) */}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
          {/* ── 왼쪽: 3D 보드 + 굴리기 CTA ── */}
          <section className="flex min-w-0 flex-col">
            <DiceBoard
              values={boardValues}
              kept={activeKept}
              rollKey={rollKey}
              reducedMotion={reducedMotion}
              disabled={!isMyTurn || tumbling || !rolled}
              onToggleKeep={toggleKeep}
              onSettle={onSettle}
            />

            <div className="mb-2 mt-3 flex items-center justify-between px-0.5">
              <div className="flex items-center gap-1.5" aria-label={`남은 굴리기 ${rollsLeft}번`}>
                {Array.from({ length: MAX_ROLLS }, (_, i) => (
                  <span key={i} className={`yd-dot ${i < rollsLeft ? 'on' : ''}`} />
                ))}
                <span className="ml-1.5 text-[11px] text-[var(--ink-3)]">
                  {isMyTurn ? '남은 굴리기' : `${active?.nickname ?? ''} 남은 굴리기`}
                </span>
              </div>
              <span className="text-[11px] text-[var(--ink-3)]">
                {!isMyTurn
                  ? '관전 중'
                  : rolled
                    ? '주사위를 탭하면 고정'
                    : phoneConnected
                      ? '📱 폰을 흔들어 굴리기'
                      : '흔들거나 눌러서 굴리기'}
              </span>
            </div>

            <button
              onClick={mode === 'commit' ? commit : roll}
              disabled={mode === 'wait' || mode === 'tumbling' || mode === 'pick'}
              aria-label={ctaText}
              className={`yd-cta ${mode === 'commit' ? 'is-commit' : ''}`}
            >
              {ctaText}
            </button>

            {isMyTurn && phoneConnected && (
              <p className="mt-2 text-center text-[11px] text-[var(--pos)]">
                📱 폰 컨트롤러 연결됨 — 폰을 흔들면 굴러갑니다
              </p>
            )}
            {isMyTurn && !phoneConnected && permission !== 'granted' && (
              <button onClick={enableMotion} className="yd-link mt-2">
                📳 흔들어서 굴리기 켜기 (센서)
              </button>
            )}

            {/* 리액션 독 */}
            <div className="mt-4">
              <ReactionDock onReact={onReact} />
            </div>
          </section>

          {/* ── 오른쪽: 점수판 (넓은 화면에선 스크롤 시 상단 고정) ── */}
          <aside className="yd-card min-w-0 lg:sticky lg:top-3">
            <div className="yd-sec">
              <span>SCORE BOARD · 점수판</span>
              {canAssign && <span className="text-[var(--gold-2)]">칸을 고르세요</span>}
            </div>
            <ScoreBoard
              players={room.players}
              youId={you.id}
              turnId={room.turnId}
              canAssign={canAssign}
              previewScore={(id) => scoreFor(id, boardValues)}
              selected={selected}
              onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
            />
          </aside>
        </div>

        {/* 방금 누가 뭘 기록했는지 */}
        {lastLog && (
          <div className="yd-log" key={lastLog.seq}>
            <b style={{ color: seatColor(lastLog.playerId) }}>{lastLog.nickname}</b>
            <span className="text-[var(--ink-2)]">
              {CATEGORIES.find((c) => c.id === lastLog.categoryId)?.label}
            </span>
            <b className="tabular-nums text-[var(--gold-2)]">{lastLog.score}점</b>
            {lastLog.auto && <span className="text-[11px] text-[var(--ink-3)]">시간초과·자동</span>}
          </div>
        )}

        {/* 떠오르는 리액션 오버레이 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-16 h-40 overflow-hidden">
          {floats.map((f) => (
            <span
              key={f.id}
              className="animate-reaction absolute bottom-0 text-3xl"
              style={{ left: `${f.left}%`, filter: `drop-shadow(0 0 6px ${f.color})` }}
            >
              {f.emoji}
            </span>
          ))}
        </div>
      </div>

      {/* ── 족보 콜아웃 ── */}
      {callout && (
        <div
          key={callout.id}
          className="yd-callout"
          data-tier={CALLOUT[callout.cat].tier}
          aria-live="polite"
        >
          <span
            className="yd-callout-burst"
            style={{
              background: `radial-gradient(closest-side, ${CALLOUT[callout.cat].color}55, transparent)`,
            }}
          />
          <span
            className="yd-callout-text"
            style={{
              color: CALLOUT[callout.cat].color,
              WebkitTextStroke:
                CALLOUT[callout.cat].tier === 'big' ? '2px rgba(40,26,8,0.55)' : undefined,
            }}
          >
            {CALLOUT[callout.cat].text}
          </span>
        </div>
      )}
    </div>
  )
}
