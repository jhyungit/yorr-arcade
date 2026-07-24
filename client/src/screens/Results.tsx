import type { RoomState } from '../net/types'

/**
 * Results — 게임 종료 화면
 * -------------------------------------------------------------
 * 총점 순위 표시. 방장에게만 [다시 하기](대기실로) 버튼.
 */
interface ResultsProps {
  room: RoomState
  isHost: boolean
  youId: string | null
  onRestart: () => void
}

const MEDALS = ['🥇', '🥈', '🥉']

export default function Results({ room, isHost, youId, onRestart }: ResultsProps) {
  // 총점 내림차순 정렬
  const ranked = [...room.players].sort((a, b) => b.total - a.total)

  return (
    <div className="flex-1 flex flex-col pt-8">
      <div className="text-center mb-6">
        <div className="text-6xl mb-2">🏁</div>
        <h2 className="text-2xl font-black">게임 종료!</h2>
      </div>

      <div className="flex flex-col gap-2 mb-8">
        {ranked.map((p, i) => (
          <div
            key={p.id}
            className={`flex items-center justify-between px-4 py-3 rounded-xl ${
              i === 0 ? 'bg-amber-400/20' : p.id === youId ? 'bg-indigo-500/20' : 'bg-slate-800'
            }`}
          >
            <span className="font-semibold flex items-center gap-2">
              <span className="w-6 text-center">{MEDALS[i] ?? i + 1}</span>
              {p.nickname}
              {p.id === youId && <span className="text-[#b6f24a] text-xs">(나)</span>}
            </span>
            <span className="text-2xl font-black text-[#b6f24a]">{p.total}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto pb-2">
        {isHost ? (
          <button
            onClick={onRestart}
            className="w-full py-4 rounded-2xl bg-[#b6f24a] active:brightness-95 text-black text-lg font-bold shadow-lg"
          >
            다시 하기 (대기실로)
          </button>
        ) : (
          <p className="text-center text-slate-400 py-4">방장이 다시 시작하기를 기다리는 중…</p>
        )}
      </div>
    </div>
  )
}
