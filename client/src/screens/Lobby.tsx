import { useState } from 'react'
import type { RoomState } from '../net/types'

/**
 * Lobby — 대기실
 * -------------------------------------------------------------
 * - 입장코드를 크게 표시 + 친구에게 보낼 링크 복사.
 * - 접속한 플레이어 목록.
 * - 방장에게만 [게임 시작] 버튼.
 */
interface LobbyProps {
  room: RoomState
  isHost: boolean
  youId: string | null
  onStart: () => void
}

export default function Lobby({ room, isHost, youId, onStart }: LobbyProps) {
  const [copied, setCopied] = useState(false)

  // 친구가 눌러 바로 입장할 링크 (?room=코드)
  const joinUrl = `${window.location.origin}/?room=${room.code}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 클립보드 권한이 없으면 무시 (사용자가 직접 복사)
    }
  }

  return (
    <div className="flex-1 flex flex-col pt-6">
      <h2 className="text-center text-slate-400 text-sm">입장코드</h2>
      <p className="text-center text-5xl font-black tracking-[0.2em] text-[#b6f24a] my-2">
        {room.code}
      </p>

      {/* 공유 링크 */}
      <div className="mt-2 mb-6">
        <div className="flex gap-2">
          <input
            readOnly
            value={joinUrl}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-800 text-xs text-slate-300 outline-none"
          />
          <button
            onClick={copy}
            className="px-4 py-2 rounded-lg bg-[#b6f24a] text-black active:brightness-95 text-sm font-bold whitespace-nowrap"
          >
            {copied ? '복사됨!' : '링크 복사'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-2 text-center">
          이 링크나 코드를 친구에게 보내면 바로 입장할 수 있어요.
        </p>
      </div>

      {/* 플레이어 목록 */}
      <h3 className="text-sm text-slate-400 mb-2">
        플레이어 <span className="text-slate-200">{room.players.length}</span>명
      </h3>
      <div className="flex flex-col gap-2 mb-6">
        {room.players.map((p) => (
          <div
            key={p.id}
            className={`flex items-center justify-between px-4 py-3 rounded-xl ${
              p.id === youId ? 'bg-indigo-500/20' : 'bg-slate-800'
            }`}
          >
            <span className="font-semibold">
              {p.nickname}
              {p.id === youId && <span className="text-[#b6f24a] text-xs"> (나)</span>}
            </span>
            {p.id === room.hostId && (
              <span className="text-xs bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded-full">
                방장
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto pb-2">
        {isHost ? (
          <button
            onClick={onStart}
            className="w-full py-4 rounded-2xl bg-emerald-500 active:bg-emerald-600 text-white text-lg font-bold shadow-lg"
          >
            게임 시작 ({room.players.length}명)
          </button>
        ) : (
          <p className="text-center text-slate-400 py-4">방장이 시작하기를 기다리는 중…</p>
        )}
      </div>
    </div>
  )
}
