import { CATEGORIES, totalScore, upperBonus } from '../game/yacht'
import { seatColor } from '../components/PlayerStrip'
import SettingsGear from '../components/FeedbackSettings'
import type { RankRow, RoomState } from '../net/types'

/**
 * Results — 게임 종료 화면 (순위)
 * -------------------------------------------------------------
 * 12라운드 × 인원을 다 채우면 서버가 room:finished 로 순위를 보낸다.
 * 그 순위를 못 받았을 때(늦게 들어온 관전자 등)는 방 상태로 직접 계산한다.
 *
 * 1등은 금색 카드로 크게. 각 줄에는 총점 말고도 "제일 크게 먹은 칸"과
 * 보너스 획득 여부를 같이 보여 준다 — 판을 되짚어 보는 재미.
 * 방장에게만 [다시 하기](대기실로).
 */
interface ResultsProps {
  room: RoomState
  ranking: RankRow[] | null
  isHost: boolean
  youId: string | null
  onRestart: () => void
  onLeave: () => void
}

const MEDALS = ['🥇', '🥈', '🥉']

export default function Results({
  room,
  ranking,
  isHost,
  youId,
  onRestart,
  onLeave,
}: ResultsProps) {
  // 서버 순위가 있으면 그걸 쓰고, 없으면 총점으로 직접 매긴다
  const rows: RankRow[] =
    ranking ??
    [...room.players]
      .map((p) => ({ id: p.id, nickname: p.nickname, total: totalScore(p.sheet), rank: 0 }))
      .sort((a, b) => b.total - a.total)
      .map((r, i, arr) => ({
        ...r,
        rank: i > 0 && arr[i - 1].total === r.total ? arr[i - 1].rank : i + 1,
      }))

  const winner = rows[0]
  const me = rows.find((r) => r.id === youId)

  /** 그 사람이 제일 크게 먹은 칸 */
  const bestCell = (id: string) => {
    const p = room.players.find((pl) => pl.id === id)
    if (!p) return null
    let best: { label: string; score: number } | null = null
    for (const c of CATEGORIES) {
      const s = p.sheet[c.id]
      if (s === null) continue
      if (!best || s > best.score) best = { label: c.label, score: s }
    }
    return best && best.score > 0 ? best : null
  }

  return (
    <div className="yd relative flex min-h-full flex-col">
      {/* 헤더가 없는 화면이라 톱니바퀴만 모서리에 띄운다 (다른 화면과 같은 자리) */}
      <SettingsGear className="absolute right-4 top-4" tone="theme" accent="var(--gold)" />
      <div className="mx-auto my-auto w-full max-w-[460px] px-5 py-6">
        <div className="mb-5 text-center">
          <div className="mb-1 text-5xl">🏁</div>
          <h2 className="font-display text-2xl font-black text-[var(--ink)]">게임 종료!</h2>
          <p className="label-mono mt-1 text-[var(--gold)] opacity-80">
            FINAL RANKING · {room.totalRounds}라운드 완주
          </p>
          {me && (
            <p className="mt-2 text-sm text-[var(--ink-2)]">
              나는 <b className="text-[var(--gold-2)]">{me.rank}등</b> ·{' '}
              <b className="tabular-nums text-[var(--ink)]">{me.total}점</b>
              {me.id === winner?.id && rows.length > 1 && ' — 우승! 🎉'}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const best = bestCell(r.id)
            const p = room.players.find((pl) => pl.id === r.id)
            const gotBonus = p ? upperBonus(p.sheet) > 0 : false
            const first = r.rank === 1
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                style={{
                  borderColor: first ? 'var(--line-2)' : 'var(--line)',
                  background: first
                    ? 'linear-gradient(180deg, rgba(240,201,131,0.16), rgba(216,162,74,0.06))'
                    : r.id === youId
                      ? 'var(--card-2)'
                      : 'var(--card)',
                }}
              >
                <span className="w-7 shrink-0 text-center text-xl">
                  {MEDALS[r.rank - 1] ?? (
                    <span className="text-sm font-bold text-[var(--ink-3)]">{r.rank}</span>
                  )}
                </span>
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: seatColor(r.id) }}
                >
                  {r.nickname.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-[var(--ink)]">
                    {r.nickname}
                    {r.id === youId && <span className="text-xs text-[var(--pos)]"> ·나</span>}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--ink-3)]">
                    {best ? `최고 ${best.label} ${best.score}점` : '기록 없음'}
                    {gotBonus && ' · 보너스 +35'}
                  </span>
                </span>
                <span
                  className="shrink-0 text-2xl font-black tabular-nums"
                  style={{ color: first ? 'var(--gold-2)' : 'var(--ink)' }}
                >
                  {r.total}
                </span>
              </div>
            )
          })}
        </div>

        <div className="mt-7 flex gap-2">
          {isHost ? (
            <button onClick={onRestart} className="yd-cta flex-1">
              다시 하기 (대기실로)
            </button>
          ) : (
            <p className="flex-1 py-4 text-center text-sm text-[var(--ink-2)]">
              방장이 다시 시작하기를 기다리는 중…
            </p>
          )}
          <button onClick={onLeave} className="yd-ghost px-5">
            나가기
          </button>
        </div>
      </div>
    </div>
  )
}
