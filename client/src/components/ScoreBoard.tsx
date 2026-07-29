import {
  CATEGORIES,
  CategoryId,
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  totalScore,
  upperBonus,
  upperSum,
} from '../game/yacht'
import type { PlayerState } from '../net/types'
import { seatColor } from './PlayerStrip'

/**
 * ScoreBoard — 점수표 (모든 플레이어를 열로 비교)
 * -------------------------------------------------------------
 * 서버가 보낸 sheet 를 그대로 그린다 → 누가 기록하는 순간 모두의 화면이 같이 바뀐다.
 * 파생값(소계/보너스/총점)만 같은 규칙(game/yacht.ts)으로 다시 계산한다.
 *
 * 내 차례이고 주사위를 굴렸으면, 내 열의 빈 칸에 "지금 넣으면 몇 점"이 금색으로 뜨고
 * 탭하면 '선택'된다. 확정은 아래 큰 버튼 — 오탭으로 한 칸을 날리지 않게 2단계로 둔다.
 * 지금 차례인 사람의 열에는 위에 얇은 금색 막대가 붙는다.
 *
 * 배치: 윗줄(1~6) → **상단 보너스** → 아랫줄(족보) → 총점.
 * 보너스는 1~6 의 소계라 맨 아래에 있으면 무엇의 합인지 안 읽힌다. 식스와 초이스
 * 사이에 두면 그 자체가 윗줄/아랫줄을 나누는 구분선 역할까지 한다(tbody 3개로 나눔).
 */
interface ScoreBoardProps {
  players: PlayerState[]
  youId: string | null
  turnId: string | null
  /** 내 차례 + 굴린 뒤 + 구르는 중 아님 */
  canAssign: boolean
  previewScore: (id: CategoryId) => number
  selected: CategoryId | null
  onSelect: (id: CategoryId) => void
}

export default function ScoreBoard({
  players,
  youId,
  turnId,
  canAssign,
  previewScore,
  selected,
  onSelect,
}: ScoreBoardProps) {
  const upper = CATEGORIES.filter((c) => c.section === 'upper')
  const lower = CATEGORIES.filter((c) => c.section === 'lower')

  /** 족보 한 줄. last 면 아래 구분선을 그리지 않는다 (보너스 띠·총점 띠가 대신 긋는다) */
  const row = (c: (typeof CATEGORIES)[number], last: boolean) => (
    <tr key={c.id} className={last ? '' : 'border-b border-[var(--line)]'}>
      <td className="py-1.5 pr-2">
        <div className="text-[13px] font-medium text-[var(--ink)]">{c.label}</div>
        <div className="text-[10px] text-[var(--ink-3)]">{c.hint}</div>
      </td>
      {players.map((p) => {
        const filled = p.sheet[c.id] !== null
        const selectable = p.id === youId && !filled && canAssign
        const pv = selectable ? previewScore(c.id) : 0
        const isSel = selectable && selected === c.id
        return (
          <td key={p.id} className="px-1 py-1 text-right">
            {filled ? (
              <span className="font-bold tabular-nums text-[var(--ink)]">{p.sheet[c.id]}</span>
            ) : selectable ? (
              <button
                onClick={() => onSelect(c.id)}
                aria-label={`${c.label} ${pv}점 선택`}
                aria-pressed={isSel}
                data-sel={isSel ? 1 : 0}
                className={`yd-pick ${pv === 0 ? 'is-zero' : ''}`}
              >
                {pv}
              </button>
            ) : (
              <span className="text-[var(--ink-3)]">·</span>
            )}
          </td>
        )
      })}
    </tr>
  )

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--line)]">
            <th className="label-mono py-2 pr-2 text-left font-normal text-[var(--ink-3)]">
              CATEGORY
            </th>
            {players.map((p) => (
              <th key={p.id} className="px-1.5 py-2 text-right">
                <span
                  className="mx-auto mb-1 block h-0.5 w-full rounded-full"
                  style={{ background: p.id === turnId ? 'var(--gold)' : 'transparent' }}
                />
                <span
                  className="block max-w-[70px] truncate whitespace-nowrap text-right text-xs font-bold"
                  style={{
                    color: p.id === youId ? 'var(--gold-2)' : 'var(--ink-2)',
                    opacity: p.connected ? 1 : 0.5,
                  }}
                  title={p.nickname}
                >
                  <span
                    className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                    style={{ background: seatColor(p.id) }}
                  />
                  {p.nickname}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {/* ── 윗줄 1~6 ── */}
        <tbody>{upper.map((c, i) => row(c, i === upper.length - 1))}</tbody>

        {/* ── 상단 보너스 = 윗줄/아랫줄 구분선 ── */}
        <tbody className="yd-sb-bonus">
          <tr>
            <td className="py-2 pr-2">
              <div className="text-[13px] font-bold text-[var(--ink)]">상단 보너스</div>
              <div className="label-mono text-[var(--ink-3)]">
                1~6 소계 {UPPER_BONUS_THRESHOLD}+ → +{UPPER_BONUS_POINTS}
              </div>
            </td>
            {players.map((p) => {
              const sum = upperSum(p.sheet)
              const got = upperBonus(p.sheet) > 0
              return (
                <td key={p.id} className="px-1 py-2 text-right leading-tight">
                  <span
                    className="block text-[13px] font-bold tabular-nums"
                    style={{ color: got ? 'var(--pos)' : 'var(--ink-2)' }}
                  >
                    {sum}
                    <span className="text-[10px] font-normal text-[var(--ink-3)]">
                      /{UPPER_BONUS_THRESHOLD}
                    </span>
                  </span>
                  {got && (
                    <span className="label-mono block text-[var(--pos)]">
                      +{UPPER_BONUS_POINTS}
                    </span>
                  )}
                </td>
              )
            })}
          </tr>
        </tbody>

        {/* ── 아랫줄 족보 ── */}
        <tbody>{lower.map((c, i) => row(c, i === lower.length - 1))}</tbody>

        {/* ── 총점 ── */}
        <tbody className="yd-sb-total">
          <tr>
            <td className="label-mono py-2.5 pr-2 text-[var(--ink-3)]">TOTAL</td>
            {players.map((p) => (
              <td key={p.id} className="px-1 py-2.5 text-right">
                <span className="text-xl font-black tabular-nums text-[var(--gold-2)]">
                  {totalScore(p.sheet)}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
