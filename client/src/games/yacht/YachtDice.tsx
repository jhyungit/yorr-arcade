import { useCallback, useMemo, useRef, useState } from 'react'
import DiceBoard from './DiceBoard'
import ScoreCard from './ScoreCard'
import { useMotionDice } from '../../hooks/useMotionDice'
import { feedbackShake, unlockAudio } from '../../lib/feedback'
import {
  CATEGORIES,
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
  const onSettle = useCallback((shown: number[]) => {
    setValues(shown)
    setTumbling(false)
  }, [])

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
    setRollsLeft(MAX_ROLLS)
    setRolled(false)
    setRollKey(0)
  }

  const restart = () => {
    setSheet(emptyScoreSheet())
    setValues([1, 2, 3, 4, 5])
    setKept(FRESH)
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
    <div className="yd min-h-full">
      <div className="mx-auto w-full max-w-5xl px-4 pt-3 pb-6">
        {/* 헤더 */}
        <header className="flex items-center justify-between gap-3 mb-3">
          <button onClick={onExit} className="yd-ghost" aria-label="나가기">
            ‹ 나가기
          </button>
          <div className="text-center leading-none">
            <div className="text-lg font-black tracking-tight text-[var(--ink)]">요트 다이스</div>
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

      {/* ── 결과 ── */}
      {finished && (
        <div className="yd-overlay">
          <div className="yd-result">
            <div className="text-5xl">{grade(total).emoji}</div>
            <div className="label-mono text-[var(--gold)] mt-3 opacity-80">FINAL SCORE</div>
            <div className="text-6xl font-black tabular-nums text-[var(--ink)] leading-none mt-1">
              {total}
            </div>
            <div className="text-[var(--gold-2)] font-bold mt-2">{grade(total).title}</div>
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
