import { totalScore } from '../game/yacht'
import type { PlayerState } from '../net/types'

/**
 * PlayerStrip — 방 인원(1~6) 가로 스크롤
 * -------------------------------------------------------------
 * 턴제라 "지금 누구 차례인가"가 제일 중요한 정보다.
 * 차례인 사람은 금색 링 + 자리 위에 ▶ 표시가 붙고, 나머지는 가라앉는다.
 * 접속이 끊긴 사람은 흐리게 + 표시를 달아 둔다(서버가 대신 플레이 중).
 */
interface PlayerStripProps {
  players: PlayerState[]
  youId: string | null
  turnId: string | null
  hostId?: string
}

// 좌석(p1~p6)별 고정 색 — 점수판·대기실·리액션에서 같은 색을 쓴다
const SEAT_COLORS = ['#5B8DEF', '#2FA98B', '#E0483A', '#F0A64E', '#9B7BE0', '#4FB0C6']

export function seatColor(seatId: string) {
  const n = Number(String(seatId).replace(/\D/g, '')) || 1
  return SEAT_COLORS[(n - 1) % SEAT_COLORS.length]
}

export default function PlayerStrip({ players, youId, turnId, hostId }: PlayerStripProps) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {players.map((p) => {
        const me = p.id === youId
        const isTurn = p.id === turnId
        const filled = Object.values(p.sheet).filter((v) => v !== null).length
        return (
          <div
            key={p.id}
            data-turn={isTurn ? 1 : 0}
            className="yd-seat"
            style={{ opacity: p.connected ? 1 : 0.5 }}
          >
            <div
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ background: seatColor(p.id) }}
            >
              {p.nickname.slice(0, 1).toUpperCase()}
              {isTurn && <span className="yd-seat-turn">▶</span>}
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1">
                <span className="max-w-[76px] truncate text-xs font-semibold text-[var(--ink)]">
                  {p.nickname}
                </span>
                {me && <span className="text-[10px] font-bold text-[var(--pos)]">나</span>}
                {p.id === hostId && <span className="text-[10px] text-[var(--gold)]">방장</span>}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-black tabular-nums text-[var(--ink)]">
                  {totalScore(p.sheet)}
                </span>
                <span className="label-mono text-[var(--ink-3)]">
                  {p.connected ? `${filled}/12` : '접속끊김'}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
