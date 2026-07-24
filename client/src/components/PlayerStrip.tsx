import { totalScore } from '../game/yacht'
import type { PlayerState } from '../net/types'

/**
 * PlayerStrip — 방 인원(2~6) 가로 스크롤
 * -------------------------------------------------------------
 * 아바타(이니셜) + 닉 + 총점 + 상태점(기록완료=pos / 굴리는중 / 대기).
 */
interface PlayerStripProps {
  players: PlayerState[]
  youId: string | null
}

// 이름 기반 아바타 색 (파스텔 블루 배경과 어울리는 조합)
const AVATAR_COLORS = ['#5B8DEF', '#2FA98B', '#E0483A', '#F0A64E', '#9B7BE0', '#4FB0C6']
function colorFor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export default function PlayerStrip({ players, youId }: PlayerStripProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {players.map((p) => {
        const me = p.id === youId
        const status = p.done ? 'done' : p.rolledThisRound ? 'rolling' : 'idle'
        return (
          <div
            key={p.id}
            className={`shrink-0 flex items-center gap-2 rounded-xl border px-3 py-2 ${
              me ? 'border-[var(--pos)] bg-[var(--card-2)]' : 'border-[var(--line)] bg-[var(--card)]'
            }`}
          >
            <div
              className="relative w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
              style={{ background: colorFor(p.nickname) }}
            >
              {p.nickname.slice(0, 1).toUpperCase()}
              {/* 상태점 */}
              <span
                className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--card)]"
                style={{
                  background:
                    status === 'done'
                      ? 'var(--pos)'
                      : status === 'rolling'
                        ? 'var(--coral)'
                        : 'var(--ink-3)',
                }}
              />
            </div>
            <div className="leading-tight">
              <div className="text-xs font-semibold text-[var(--ink)] max-w-[80px] truncate">
                {p.nickname}
                {me && <span className="text-[var(--pos)]"> ·나</span>}
              </div>
              <div className="text-sm font-black text-[var(--ink)] tabular-nums">
                {totalScore(p.sheet)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
