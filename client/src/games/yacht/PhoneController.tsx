import { useEffect, useRef, useState } from 'react'
import { socket } from '../../net/socket'
import { feedbackTap, feedbackTurn } from '../../lib/feedback'
import { UPPER_BONUS_POINTS, UPPER_BONUS_THRESHOLD } from '../../game/yacht'
import { REACTION_EMOJI, type ReactionType } from '../../net/types'
import {
  YACHT_KEEP,
  YACHT_REACT,
  YACHT_SCORE,
  YACHT_SELECT,
  YACHT_VIEW,
  type YachtView,
} from './ctrlProtocol'

/**
 * PhoneController — 요트 다이스용 폰 컨트롤러 화면
 * -------------------------------------------------------------
 * 다른 게임은 "휘두르기" 하나로 끝나지만 요트는 킵·점수 선택이 게임의 본체다.
 * 폰만으로 한 턴을 끝낼 수 있어야 노트북 마우스를 안 잡는다.
 *
 * 이 화면은 스스로 판단하지 않는다. 노트북이 보내 주는 view 를 그대로 그리고,
 * 누른 것만 올려보낸다 → 노트북 화면과 항상 같은 상태가 된다.
 * 기록은 노트북과 같은 2단계(칸 선택 → 아래 큰 버튼 확정)로 맞췄다.
 * 작은 화면에서 오탭으로 한 칸을 날리는 게 제일 아프기 때문이다.
 *
 * 세로 한 화면에 담기지 않으므로 위(주사위·굴리기)는 고정, 점수판만 스크롤한다.
 */

const GOLD = '#d8a24a'
const GOLD_2 = '#f0c983'
const POS = '#3fbf9b'
const REACTIONS: ReactionType[] = ['like', 'laugh', 'shock', 'clap', 'gg']

/** 주사위 눈을 점으로 (숫자보다 눈에 빨리 읽힌다) */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
}

function Die({ value, kept, disabled, onTap }: {
  value: number
  kept: boolean
  disabled: boolean
  onTap: () => void
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      aria-label={`${value} ${kept ? '고정 해제' : '고정'}`}
      className="relative flex-1 rounded-xl transition-all active:scale-95"
      style={{
        aspectRatio: '1',
        background: kept ? `linear-gradient(180deg,${GOLD_2},${GOLD})` : '#f4efe4',
        boxShadow: kept
          ? `0 0 0 3px rgba(216,162,74,0.35), 0 6px 14px rgba(216,162,74,0.3)`
          : '0 3px 8px rgba(0,0,0,0.45)',
        transform: kept ? 'translateY(-6px)' : undefined,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span className="absolute inset-[18%] grid grid-cols-3 grid-rows-3">
        {PIPS[value]?.map(([cx, cy], i) => (
          <span
            key={i}
            className="rounded-full"
            style={{
              gridColumn: cx + 1,
              gridRow: cy + 1,
              background: '#17120a',
              width: '100%',
              aspectRatio: '1',
            }}
          />
        ))}
      </span>
      {kept && (
        <span
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded px-1 text-[9px] font-black"
          style={{ background: '#17120a', color: GOLD_2 }}
        >
          KEEP
        </span>
      )}
    </button>
  )
}

/**
 * BonusGauge — 상단(1~6) 보너스 진행 막대
 * -------------------------------------------------------------
 * 노트북 점수표(ScoreCard)에는 있는데 폰에는 없어서, 폰만 보고 플레이하면
 * "왜 굳이 6을 모아야 하는지"가 안 보였다. 같은 게이지를 폰 크기로 옮긴다.
 *
 * 세 가지 상태를 구분한다 — 남은 점수를 알려주는 게 이 게이지의 존재 이유고,
 * 상단을 다 채웠는데 63을 못 넘긴 경우를 '진행 중'처럼 두면 계속 기다리게 된다.
 *   진행 중 : 금색 · "N점 더"
 *   달성    : 초록 · +35 확정
 *   놓침    : 상단 6칸을 다 채웠는데 63 미만 → 회색 (더 기다릴 필요 없음)
 */
function BonusGauge({ sum, upperDone }: { sum: number; upperDone: boolean }) {
  const got = sum >= UPPER_BONUS_THRESHOLD
  const missed = upperDone && !got
  const left = UPPER_BONUS_THRESHOLD - sum
  const accent = got ? POS : missed ? 'rgba(255,255,255,0.32)' : GOLD

  return (
    <div
      className="mt-1 rounded-lg px-2 py-1.5"
      aria-label={`상단 보너스 ${sum} / ${UPPER_BONUS_THRESHOLD}점`}
      style={{
        background: got ? 'rgba(63,191,155,0.14)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${got ? 'rgba(63,191,155,0.45)' : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="truncate text-[10px] font-bold" style={{ color: accent }}>
          {got ? `보너스 +${UPPER_BONUS_POINTS} 획득` : missed ? '보너스 놓침' : `보너스 +${UPPER_BONUS_POINTS}`}
        </span>
        <span className="shrink-0 text-[10px] font-black tabular-nums" style={{ color: accent }}>
          {sum}
          <span className="font-bold text-white/30">/{UPPER_BONUS_THRESHOLD}</span>
        </span>
      </div>

      <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(0,0,0,0.35)' }}>
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${Math.min(100, (sum / UPPER_BONUS_THRESHOLD) * 100)}%`,
            background: got
              ? POS
              : missed
                ? 'rgba(255,255,255,0.16)'
                : `linear-gradient(90deg,${GOLD},${GOLD_2})`,
          }}
        />
      </div>

      {!got && !missed && (
        <p className="mt-1 text-[9px] leading-none text-white/40">
          <b className="tabular-nums text-white/60">{left}점</b> 더 채우면 +{UPPER_BONUS_POINTS}
        </p>
      )}
    </div>
  )
}

export default function PhoneController({ onSwing }: { onSwing: () => void }) {
  const [view, setView] = useState<YachtView | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [flash, setFlash] = useState(0) // 내 차례 플래시 (키를 바꿔 애니메이션 재생)
  const wasMine = useRef(false)

  /* 진동은 이 화면이 신경 쓰지 않는다 — feedbackTap 이 기기별로 알아서 처리한다
     (아이폰은 웹 진동이 불가능해서 무동작. lib/feedback.ts 의 canVibrate 참고).
     ※ 예전에 여기서 붙였던 ios-vibrator-pro-max 는 제거했다. 모든 버튼 위에
       투명 오버레이를 덮는 방식이라 주사위 킵 탭이 씹혔다. */

  // 노트북이 보내 주는 화면 상태 수신
  useEffect(() => {
    const onView = (v: YachtView) => setView(v)
    socket.on(YACHT_VIEW, onView)
    return () => {
      socket.off(YACHT_VIEW, onView)
    }
  }, [])

  // 남은 시간 표시용 (deadline 이 있을 때만)
  useEffect(() => {
    if (!view?.deadline) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [view?.deadline])

  /* 내 차례가 되는 순간 알림 — 폰을 손에 들고 노트북을 보는 자세라
     화면 표시만으로는 놓친다. 진동 + 소리 + 화면 플래시를 같이 준다.
     아이폰은 웹 진동이 없으므로(크롬도 동일) 소리·플래시가 유일한 알림이다. */
  useEffect(() => {
    const mine = !!view?.mine
    if (mine && !wasMine.current) {
      feedbackTurn()
      setFlash((n) => n + 1)
    }
    wasMine.current = mine
  }, [view?.mine])

  if (!view) {
    return (
      <div className="mt-8 w-full max-w-xs text-center">
        <div className="mb-3 animate-pulse text-5xl">🎲</div>
        <p className="text-sm text-white/60">
          노트북에서 <b className="text-white">요트 다이스</b>를 시작하면
          <br />
          여기에 주사위와 점수판이 나타납니다.
        </p>
      </div>
    )
  }

  const locked = !view.mine || view.tumbling
  const canKeep = view.mine && view.rolled && !view.tumbling
  const canPick = canKeep
  const remain = view.deadline ? Math.max(0, Math.ceil((view.deadline - now) / 1000)) : null
  const upper = view.cells.slice(0, 6)
  const lower = view.cells.slice(6)
  /* 상단 보너스는 노트북에서 따로 받지 않고 여기서 센다 — 점수판(cells)이 이미
     노트북이 보내 준 확정값이므로 두 화면이 어긋날 일이 없다. (규칙 판정은
     계속 노트북에만 있고, 폰은 받은 숫자를 더하기만 한다.) */
  const upperTotal = upper.reduce((s, c) => s + (c.score ?? 0), 0)
  const upperDone = upper.every((c) => c.score !== null)

  const cell = (c: YachtView['cells'][number]) => {
    const filled = c.score !== null
    const isSel = view.selected === c.id
    const pickable = canPick && !filled && c.preview !== null
    return (
      <button
        key={c.id}
        disabled={!pickable}
        onClick={() => {
          feedbackTap()
          socket.emit(YACHT_SELECT, { categoryId: c.id })
        }}
        className="flex items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors active:scale-[0.98]"
        style={{
          background: isSel ? 'rgba(63,191,155,0.22)' : filled ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.07)',
          border: `1px solid ${isSel ? POS : 'transparent'}`,
          opacity: filled ? 0.5 : 1,
        }}
      >
        <span className="truncate text-[12px] font-semibold text-white/85">{c.label}</span>
        <span
          className="ml-1.5 shrink-0 text-[13px] font-black tabular-nums"
          style={{
            color: filled ? '#fff' : isSel ? POS : c.preview === 0 ? 'rgba(255,255,255,0.35)' : GOLD_2,
          }}
        >
          {filled ? c.score : pickable ? c.preview : '·'}
        </span>
      </button>
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* 차례 · 라운드 · 남은 시간 */}
      <div
        className="flex items-center justify-between rounded-xl px-3 py-2"
        style={{
          background: view.mine ? 'rgba(216,162,74,0.16)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${view.mine ? GOLD : 'rgba(255,255,255,0.1)'}`,
        }}
      >
        <span className="truncate text-[13px] font-bold" style={{ color: view.mine ? GOLD_2 : 'rgba(255,255,255,0.6)' }}>
          {view.mine ? '🎲 내 차례!' : `⏳ ${view.turn}님의 차례`}
        </span>
        <span className="ml-2 shrink-0 text-[11px] tabular-nums text-white/50">
          R{view.round}/{view.totalRounds}
          {remain !== null && (
            <b className="ml-1.5" style={{ color: remain <= 5 ? '#e0483a' : GOLD }}>
              {remain}s
            </b>
          )}
        </span>
      </div>

      {/* 주사위 — 탭하면 킵 */}
      <div className="mt-3.5 flex gap-1.5">
        {view.dice.map((v, i) => (
          <Die
            key={i}
            value={v}
            kept={view.kept[i]}
            disabled={!canKeep}
            onTap={() => {
              feedbackTap()
              socket.emit(YACHT_KEEP, { index: i })
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-center text-[11px] text-white/40">
        {canKeep ? '남길 주사위를 탭해서 고정' : view.mine ? '먼저 굴리세요' : '관전 중'}
      </p>

      {/* 남은 굴리기 + 굴리기/기록 버튼 */}
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 rotate-45 rounded-[2px]"
            style={{ background: i < view.rollsLeft ? GOLD : 'rgba(255,255,255,0.15)' }}
          />
        ))}
        <span className="ml-1 text-[11px] text-white/40">남은 굴리기 {view.rollsLeft}</span>
      </div>

      {view.selected ? (
        <button
          onClick={() => {
            feedbackTap(true) // 확정은 조금 더 확실하게
            socket.emit(YACHT_SCORE, { categoryId: view.selected })
          }}
          disabled={locked}
          className="mt-2 w-full rounded-2xl py-4 text-[15px] font-black disabled:opacity-40"
          style={{ background: `linear-gradient(180deg,#6fdcba,#2fa98b)`, color: '#05231b' }}
        >
          ✓ {view.cells.find((c) => c.id === view.selected)?.label} 기록
        </button>
      ) : (
        <button
          onClick={() => {
            feedbackTap()
            onSwing()
          }}
          disabled={locked || view.rollsLeft <= 0}
          className="mt-2 w-full rounded-2xl py-4 text-[15px] font-black disabled:opacity-40"
          style={{ background: `linear-gradient(180deg,${GOLD_2},${GOLD})`, color: '#17120a' }}
        >
          {view.tumbling
            ? '구르는 중…'
            : !view.mine
              ? '관전 중'
              : view.rollsLeft > 0
                ? '🎲 굴리기 (또는 폰 흔들기)'
                : '기록할 칸을 고르세요'}
        </button>
      )}

      {/* 점수판 — 2열, 이 영역만 스크롤 */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        <div className="mb-1 flex items-baseline justify-between px-1">
          <span className="text-[10px] tracking-widest text-white/35">SCORE</span>
          <span className="text-[11px] text-white/45">
            내 총점 <b className="tabular-nums" style={{ color: GOLD_2 }}>{view.total}</b>
          </span>
        </div>
        <div className="grid grid-cols-2 items-start gap-1.5">
          {/* 왼쪽(1~6) 아래에 보너스 게이지 — 노트북 점수표와 같은 자리 */}
          <div className="flex flex-col gap-1">
            {upper.map(cell)}
            <BonusGauge sum={upperTotal} upperDone={upperDone} />
          </div>
          <div className="flex flex-col gap-1">{lower.map(cell)}</div>
        </div>
      </div>

      {/* 내 차례 플래시 (소리를 껐거나 못 듣는 상황의 보조 신호) */}
      {flash > 0 && <span key={flash} className="yc-turn-flash" />}

      {/* 리액션 — 남의 차례에도 참견할 수 있게 */}
      {view.canReact && (
        <div className="mt-2 flex shrink-0 justify-center gap-1.5">
          {REACTIONS.map((t) => (
            <button
              key={t}
              onClick={() => {
                feedbackTap()
                socket.emit(YACHT_REACT, { type: t })
              }}
              aria-label={`리액션 ${t}`}
              className="flex h-10 w-10 items-center justify-center rounded-full text-lg active:scale-90"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {REACTION_EMOJI[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
