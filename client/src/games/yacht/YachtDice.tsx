import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DiceBoard from './DiceBoard'
import ScoreCard from './ScoreCard'
import { useMotionDice } from '../../hooks/useMotionDice'
import { feedbackShake, feedbackThrow, unlockAudio } from '../../lib/feedback'
import {
  CATEGORIES,
  calloutHand,
  emptyScoreSheet,
  isGameOver,
  scoreFor,
  totalScore,
  type CategoryId,
  type ScoreSheet,
} from '../../game/yacht'

/**
 * YachtDice — 혼자 하는 요트 다이스 (완전 클라이언트)
 * -------------------------------------------------------------
 * 12라운드 × 3번 굴리기. 규칙은 game/yacht.ts 그대로 쓰고,
 * 주사위 연출은 games/yacht/dice3d.ts (Three.js 물리) 가 전담한다.
 *
 * 디자인 정체성: 딥그린 펠트 · 월넛 · 골드 (다른 미니게임과 겹치지 않는 톤).
 * 조작: 주사위를 탭하면 앞쪽 KEEP 레일로 넘어가 고정, 다시 탭하면 판으로 복귀.
 *       기록은 "칸 선택 → 아래 큰 버튼으로 확정" 2단계 (오탭으로 칸을 날리지 않게).
 */

const MAX_ROLLS = 3
const BEST_KEY = 'yacht.best'

/* ── 개발용 족보 치트 (배포 빌드에는 안 들어간다) ──
   요트는 한 번 굴려 나올 확률이 1/1296 이라 연출을 눈으로 확인할 방법이 없다.
   숫자키로 다음 굴리기 결과를 고정한다. 물리가 그 눈으로 착지하므로
   실제 플레이와 같은 경로로 콜아웃이 뜬다(연출만 따로 띄우는 게 아니다). */
const DEV_HANDS: Record<string, { faces: number[]; label: string }> = {
  '1': { faces: [5, 5, 5, 5, 5], label: '요트' },
  '2': { faces: [2, 3, 4, 5, 6], label: '라지' },
  '3': { faces: [4, 4, 4, 4, 2], label: '포카드' },
  '4': { faces: [3, 3, 3, 6, 6], label: '풀하우스' },
  '5': { faces: [1, 2, 3, 4, 6], label: '스몰' },
}

/** 족보 콜아웃 문구·급·색. 급은 index.css 의 .yd-callout[data-tier] 가 받는다. */
const CALLOUT: Record<string, { text: string; tier: 'big' | 'mid' | 'low'; color: string }> = {
  yacht: { text: '요트!!!', tier: 'big', color: '#ffd76a' },
  largeStraight: { text: '라지 스트레이트!', tier: 'mid', color: '#7fe3c4' },
  fourKind: { text: '포카드!', tier: 'mid', color: '#ffb066' },
  fullHouse: { text: '풀하우스!', tier: 'mid', color: '#f0a2d8' },
  smallStraight: { text: '스몰 스트레이트~', tier: 'low', color: '#a8d5ff' },
}

const randomFace = () => 1 + Math.floor(Math.random() * 6)
const FRESH: boolean[] = [false, false, false, false, false]

function grade(total: number) {
  if (total >= 300) return { title: '요트 마스터', emoji: '👑' }
  if (total >= 250) return { title: '고수', emoji: '🏅' }
  if (total >= 200) return { title: '잘했어요', emoji: '✨' }
  if (total >= 150) return { title: '무난한 판', emoji: '🎲' }
  return { title: '다음 판이 있잖아요', emoji: '🍀' }
}

export default function YachtDice({ onExit }: { onExit: () => void }) {
  const [sheet, setSheet] = useState<ScoreSheet>(() => emptyScoreSheet())
  const [values, setValues] = useState<number[]>([1, 2, 3, 4, 5])
  const [kept, setKept] = useState<boolean[]>(FRESH)
  const [rollsLeft, setRollsLeft] = useState(MAX_ROLLS)
  const [rolled, setRolled] = useState(false)
  const [rollKey, setRollKey] = useState(0)
  const [tumbling, setTumbling] = useState(false)
  const [selected, setSelected] = useState<CategoryId | null>(null)
  const [justScored, setJustScored] = useState<CategoryId | null>(null)
  const [motionOn, setMotionOn] = useState(false)
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY) || 0))
  // 족보 콜아웃 — id 를 바꿔 리마운트시켜 애니메이션을 다시 재생한다
  const [callout, setCallout] = useState<{ id: number; cat: CategoryId } | null>(null)
  const calloutSeq = useRef(0)
  const calloutTimer = useRef<number | null>(null)
  // 이번 라운드에 이미 알린 족보 — 리롤할 때마다 같은 걸 또 외치면 시끄럽다
  const announced = useRef<Set<CategoryId>>(new Set())

  const flashTimer = useRef<number | null>(null)

  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  )

  const done = CATEGORIES.filter((c) => sheet[c.id] !== null).length
  const finished = isGameOver(sheet)
  const round = Math.min(done + 1, CATEGORIES.length)
  const total = totalScore(sheet)

  /* ── 굴리기 ── */
  const roll = useCallback(() => {
    if (tumbling || finished || rollsLeft <= 0) return
    unlockAudio()
    setValues((prev) => prev.map((v, i) => (kept[i] ? v : randomFace())))
    setRollsLeft((n) => n - 1)
    setRolled(true)
    setSelected(null)
    setTumbling(true)
    setRollKey((k) => k + 1)
    feedbackShake()
  }, [tumbling, finished, rollsLeft, kept])

  /* 개발용: 다음 굴리기를 지정한 족보로 고정해 바로 굴린다.
     굴리기 횟수·킵·중복알림 기록을 초기화해 몇 번이고 다시 볼 수 있게 한다. */
  const devRoll = useCallback((faces: number[]) => {
    if (tumbling || finished) return
    unlockAudio()
    setKept(FRESH)
    announced.current.clear()
    setRollsLeft(MAX_ROLLS - 1)
    setValues(faces)
    setRolled(true)
    setSelected(null)
    setTumbling(true)
    setRollKey((k) => k + 1)
    feedbackShake()
  }, [tumbling, finished])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const hand = DEV_HANDS[e.key]
      if (!hand) return
      e.preventDefault()
      devRoll(hand.faces)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [devRoll])

  // 폰을 흔들어도 굴러간다 (센서). 굴리는 중엔 잠근다.
  const { permission, requestPermission } = useMotionDice({
    onShake: roll,
    onThrow: roll,
    enabled: motionOn && !tumbling && !finished,
  })

  const enableMotion = async () => {
    unlockAudio()
    await requestPermission()
    setMotionOn(true)
  }

  /** 다 굴러 멈춤 — 어느 자리에 어느 눈이 놓였는지 확정된다 */
  const onSettle = useCallback(
    (shown: number[]) => {
      setValues(shown)
      setTumbling(false)
      // 성립한 족보가 있으면(아직 안 쓴 칸만) 크게 알린다
      const cat = calloutHand(shown, sheet)
      if (!cat || announced.current.has(cat)) return
      announced.current.add(cat)
      calloutSeq.current += 1
      setCallout({ id: calloutSeq.current, cat })
      if (CALLOUT[cat].tier === 'big') feedbackThrow()
      else feedbackShake()
      if (calloutTimer.current) window.clearTimeout(calloutTimer.current)
      calloutTimer.current = window.setTimeout(() => setCallout(null), 1600)
    },
    [sheet],
  )

  const toggleKeep = useCallback(
    (i: number) => {
      if (!rolled || tumbling || finished) return
      setKept((prev) => prev.map((k, idx) => (idx === i ? !k : k)))
    },
    [rolled, tumbling, finished],
  )

  /* ── 기록 ── */
  const preview = useCallback(
    (id: CategoryId) => (rolled && !tumbling ? scoreFor(id, values) : null),
    [rolled, tumbling, values],
  )

  const commit = () => {
    if (!selected || !rolled || tumbling) return
    const gained = scoreFor(selected, values)
    const next: ScoreSheet = { ...sheet, [selected]: gained }
    setSheet(next)
    setJustScored(selected)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setJustScored(null), 700)

    if (isGameOver(next)) {
      const t = totalScore(next)
      if (t > best) {
        setBest(t)
        localStorage.setItem(BEST_KEY, String(t))
      }
      return
    }
    // 다음 라운드 — 판을 정리하고 굴리기 3번을 돌려준다
    setSelected(null)
    setKept(FRESH)
    announced.current.clear()
    setRollsLeft(MAX_ROLLS)
    setRolled(false)
    setRollKey(0)
  }

  const restart = () => {
    setSheet(emptyScoreSheet())
    setValues([1, 2, 3, 4, 5])
    setKept(FRESH)
    announced.current.clear()
    setRollsLeft(MAX_ROLLS)
    setRolled(false)
    setRollKey(0)
    setSelected(null)
    setTumbling(false)
  }

  /* ── 아래 큰 버튼: 상황에 따라 굴리기 / 기록하기 ── */
  const selLabel = selected ? CATEGORIES.find((c) => c.id === selected)!.label : ''
  const mode: 'tumbling' | 'commit' | 'roll' | 'pick' = tumbling
    ? 'tumbling'
    : selected
      ? 'commit'
      : rollsLeft > 0
        ? 'roll'
        : 'pick'

  return (
    <div className="yd flex min-h-full flex-col">
      {/* my-auto: 여유가 있으면 세로 중앙, 내용이 넘치면 그대로 흐른다(잘리지 않음).
          전체화면에서 컨테이너가 위에 붙어 아래가 텅 비어 보이던 문제. */}
      <div className="mx-auto my-auto w-full max-w-5xl px-4 py-4 xl:max-w-6xl">
        {/* 헤더 */}
        <header className="flex items-center justify-between gap-3 mb-3">
          <button onClick={onExit} className="yd-ghost" aria-label="나가기">
            ‹ 나가기
          </button>
          <div className="text-center leading-none">
            <div className="font-display text-lg font-black text-[var(--ink)]">요트 다이스</div>
            <div className="label-mono text-[var(--gold)] opacity-70 mt-0.5">YACHT DICE</div>
          </div>
          <div className="text-right">
            <div className="yd-pill tabular-nums">
              R <b className="text-[var(--gold-2)]">{round}</b>
              <span className="opacity-45">/{CATEGORIES.length}</span>
            </div>
            {best > 0 && (
              <div className="text-[10px] text-[var(--ink-3)] mt-1 tabular-nums">최고 {best}</div>
            )}
          </div>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4 lg:gap-5 items-start">
          {/* ── 보드 + 조작 ── */}
          <section className="min-w-0">
            <DiceBoard
              values={values}
              kept={kept}
              rollKey={rollKey}
              reducedMotion={reducedMotion}
              disabled={tumbling || finished || !rolled}
              onToggleKeep={toggleKeep}
              onSettle={onSettle}
            />

            {/* 남은 굴리기 + 안내 */}
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

            <button
              onClick={mode === 'commit' ? commit : roll}
              disabled={mode === 'tumbling' || mode === 'pick' || finished}
              className={`yd-cta ${mode === 'commit' ? 'is-commit' : ''}`}
            >
              {mode === 'tumbling'
                ? '구르는 중…'
                : mode === 'commit'
                  ? `${selLabel} · ${scoreFor(selected!, values)}점 기록`
                  : mode === 'roll'
                    ? rolled
                      ? `다시 굴리기 · ${rollsLeft}번 남음`
                      : '굴리기'
                    : '기록할 칸을 고르세요'}
            </button>

            {permission !== 'granted' && (
              <button onClick={enableMotion} className="yd-link mt-2">
                📳 흔들어서 굴리기 켜기
              </button>
            )}

            {/* 개발 중에만 보이는 족보 연출 확인용 안내 */}
            {import.meta.env.DEV && (
              <div className="mt-2 text-center text-[10px] text-[var(--ink-3)]">
                DEV ·{' '}
                {Object.entries(DEV_HANDS).map(([k, h], i) => (
                  <span key={k}>
                    {i > 0 && ' · '}
                    <b className="text-[var(--gold)]">{k}</b> {h.label}
                  </span>
                ))}{' '}
                키로 족보 굴리기
              </div>
            )}
          </section>

          {/* ── 점수표 ── */}
          <aside className="lg:sticky lg:top-3 min-w-0">
            <ScoreCard
              sheet={sheet}
              preview={preview}
              selected={selected}
              onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
              justScored={justScored}
            />
          </aside>
        </div>
      </div>

      {/* ── 족보 콜아웃 ── */}
      {callout && (
        <div key={callout.id} className="yd-callout" data-tier={CALLOUT[callout.cat].tier} aria-live="polite">
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
              WebkitTextStroke: CALLOUT[callout.cat].tier === 'big' ? '2px rgba(40,26,8,0.55)' : undefined,
            }}
          >
            {CALLOUT[callout.cat].text}
          </span>
        </div>
      )}

      {/* ── 결과 ── */}
      {finished && (
        <div className="yd-overlay">
          <div className="yd-result">
            <div className="text-5xl">{grade(total).emoji}</div>
            <div className="label-mono text-[var(--gold)] mt-3 opacity-80">FINAL SCORE</div>
            <div className="font-display text-6xl font-black tabular-nums text-[var(--ink)] leading-none mt-1">
              {total}
            </div>
            <div className="font-display text-[var(--gold-2)] font-bold mt-2 text-lg">{grade(total).title}</div>
            <div className="text-xs text-[var(--ink-3)] mt-1 tabular-nums">
              최고 기록 {Math.max(best, total)}
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={restart} className="yd-cta flex-1">
                다시 하기
              </button>
              <button onClick={onExit} className="yd-ghost px-5">
                나가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
