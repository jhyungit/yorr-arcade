import {
  CATEGORIES,
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  totalScore,
  upperSum,
  type CategoryId,
  type ScoreSheet,
} from '../../game/yacht'

/**
 * ScoreCard — 혼자 하는 요트의 점수표
 * -------------------------------------------------------------
 * 상단(1~6) / 하단(족보) 두 칸으로 나눠 12줄을 한 화면에 담는다.
 * 빈 칸에는 "지금 주사위로 기록하면 몇 점인지"를 미리 보여 주고,
 * 탭하면 바로 확정하지 않고 '선택'만 한다 (확정은 아래 큰 버튼).
 *  → 모바일에서 잘못 눌러 한 칸을 날리는 사고를 막기 위함.
 */

interface ScoreCardProps {
  sheet: ScoreSheet
  /** 지금 주사위로 이 칸에 기록하면 받을 점수 (아직 안 굴렸으면 null) */
  preview: (id: CategoryId) => number | null
  selected: CategoryId | null
  onSelect: (id: CategoryId) => void
  /** 방금 기록된 칸 — 잠깐 반짝인다 */
  justScored: CategoryId | null
}

export default function ScoreCard({
  sheet,
  preview,
  selected,
  onSelect,
  justScored,
}: ScoreCardProps) {
  const upper = CATEGORIES.filter((c) => c.section === 'upper')
  const lower = CATEGORIES.filter((c) => c.section === 'lower')
  const sum = upperSum(sheet)
  const bonusGot = sum >= UPPER_BONUS_THRESHOLD

  const row = (id: CategoryId, label: string) => {
    const filled = sheet[id]
    const pv = filled === null ? preview(id) : null
    const isSel = selected === id
    const state = filled !== null ? 'filled' : isSel ? 'sel' : pv === null ? 'idle' : 'open'
    return (
      <button
        key={id}
        onClick={() => filled === null && pv !== null && onSelect(id)}
        disabled={filled !== null || pv === null}
        data-state={state}
        className={`yd-row ${pv === 0 ? 'is-zero' : ''} ${justScored === id ? 'yd-flash' : ''}`}
      >
        <span className="yd-row-label">{label}</span>
        <span className="yd-row-value">
          {filled !== null ? filled : pv === null ? '·' : pv}
        </span>
      </button>
    )
  }

  return (
    <div className="yd-card">
      <div className="grid grid-cols-2 gap-x-3 gap-y-0">
        <div>
          <div className="yd-sec">UPPER</div>
          {upper.map((c) => row(c.id, c.label))}
          {/* 상단 보너스 게이지 */}
          <div className="mt-2 px-2 pb-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-[var(--ink-3)]">보너스 +{UPPER_BONUS_POINTS}</span>
              <span
                className="text-[11px] tabular-nums font-bold"
                style={{ color: bonusGot ? 'var(--pos)' : 'var(--ink-2)' }}
              >
                {sum}/{UPPER_BONUS_THRESHOLD}
              </span>
            </div>
            <div className="yd-gauge mt-1">
              <div
                className="yd-gauge-fill"
                style={{
                  width: `${Math.min(100, (sum / UPPER_BONUS_THRESHOLD) * 100)}%`,
                  background: bonusGot ? 'var(--pos)' : 'var(--gold)',
                }}
              />
            </div>
          </div>
        </div>
        <div>
          <div className="yd-sec">LOWER</div>
          {lower.map((c) => row(c.id, c.label))}
        </div>
      </div>

      <div className="yd-total">
        <span className="label-mono text-[var(--ink-3)]">TOTAL</span>
        <span className="text-3xl font-black tabular-nums text-[var(--gold-2)]">
          {totalScore(sheet)}
        </span>
      </div>
    </div>
  )
}
