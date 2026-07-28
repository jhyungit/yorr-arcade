import {
  CATEGORIES,
  CategoryId,
  UPPER_BONUS_THRESHOLD,
  totalScore,
  upperBonus,
  upperSum,
} from '../game/yacht'
import type { PlayerState } from '../net/types'

/**
 * ScoreBoard — 점수표 (모든 플레이어를 열로 비교)
 * -------------------------------------------------------------
 * 파생값(소계/보너스/총점)은 서버 점수판을 표시하는 게 원칙(여기선 sheet 기준 재계산 = 동일 규칙).
 * 내 열의 미기입 칸: "지금 주사위로 기록 시 점수"를 금색 칩으로 보여 주고, 탭하면 기록(round.submit).
 * 라운드 제한시간이 있는 온라인 판이라 솔로와 달리 탭 = 즉시 확정이다.
 * (팀 확정 규칙: smallStraight=15, largeStraight=30, fourOfAKind·fullHouse=5개합, yacht=50, 보너스 63→35)
 */
interface ScoreBoardProps {
  players: PlayerState[]
  youId: string | null
  canAssign: boolean
  previewScore: (id: CategoryId) => number
  onAssign: (id: CategoryId) => void
}

export default function ScoreBoard({
  players,
  youId,
  canAssign,
  previewScore,
  onAssign,
}: ScoreBoardProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--line)]">
            <th className="text-left py-2 pr-2 label-mono text-[var(--ink-3)] font-normal">
              CATEGORY
            </th>
            {players.map((p) => (
              <th
                key={p.id}
                className={`py-2 px-2 text-right font-bold whitespace-nowrap ${
                  p.id === youId ? 'text-[var(--gold-2)]' : 'text-[var(--ink-2)]'
                }`}
              >
                {p.nickname}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c) => (
            <tr key={c.id} className="border-b border-[var(--line)]">
              <td className="py-1.5 pr-2">
                <div className="font-medium text-[var(--ink)]">{c.label}</div>
                <div className="text-[10px] text-[var(--ink-3)]">{c.hint}</div>
              </td>
              {players.map((p) => {
                const filled = p.sheet[c.id] !== null
                const selectable = p.id === youId && !filled && canAssign
                const pv = selectable ? previewScore(c.id) : 0
                return (
                  <td key={p.id} className="py-1 px-1 text-right">
                    {filled ? (
                      <span className="font-bold text-[var(--ink)] tabular-nums">
                        {p.sheet[c.id]}
                      </span>
                    ) : selectable ? (
                      <button
                        onClick={() => onAssign(c.id)}
                        aria-label={`${c.label} ${pv}점 기록`}
                        className={`min-w-9 px-2 py-1 rounded-lg font-bold tabular-nums transition-transform active:scale-95 ${
                          pv === 0 ? 'opacity-45' : ''
                        }`}
                        style={{
                          background: 'linear-gradient(180deg, #f0c983, #d8a24a)',
                          color: '#17120a',
                        }}
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
          ))}

          {/* 상단 보너스 */}
          <tr className="border-b border-[var(--line)]" style={{ background: 'var(--card-2)' }}>
            <td className="py-2 pr-2">
              <div className="font-medium text-[var(--ink)]">상단 보너스</div>
              <div className="text-[10px] text-[var(--ink-3)]">
                1~6 소계 {UPPER_BONUS_THRESHOLD}점 이상 +35
              </div>
            </td>
            {players.map((p) => (
              <td key={p.id} className="py-2 px-1 text-right text-[var(--ink-2)] tabular-nums">
                <span className={upperBonus(p.sheet) > 0 ? 'text-[var(--pos)] font-bold' : ''}>
                  {upperSum(p.sheet)}/{UPPER_BONUS_THRESHOLD}
                </span>
              </td>
            ))}
          </tr>

          {/* 총점 */}
          <tr>
            <td className="py-3 pr-2 font-bold text-[var(--ink)]">총점</td>
            {players.map((p) => (
              <td key={p.id} className="py-3 px-1 text-right">
                <span className="text-xl font-black text-[var(--gold-2)] tabular-nums">
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
