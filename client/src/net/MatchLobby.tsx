import { useEffect, useRef, useState } from 'react'
import { socket } from './socket'

/**
 * MatchLobby — 온라인 1:1 방 만들기/참가 (게임 공용)
 * -------------------------------------------------------------
 * 핑퐁의 OnlineLobby 와 흐름은 같지만, 소켓 이벤트 접두어(prefix)를 받아
 * 어떤 게임에서도 재사용할 수 있게 일반화했다.
 *   - 리듬 탭:      prefix="rt"  → rt:create / rt:join / rt:opponent_joined
 *   - 퀵드로우:      prefix="rx"  → rx:create / rx:join / rx:opponent_joined
 *
 * A: [방 만들기] → 코드 생성 → 상대 입장 대기 → 매칭되면 host.
 * B: [코드로 참가] → 코드 입력 → 매칭되면 guest.
 */
interface MatchLobbyProps {
  prefix: string
  title: string
  accent: string // 강조색 (게임 정체성에 맞춤)
  onMatched: (role: 'host' | 'guest') => void
  onCancel: () => void
}

export default function MatchLobby({ prefix, title, accent, onMatched, onCancel }: MatchLobbyProps) {
  const [stage, setStage] = useState<'menu' | 'waiting' | 'joining'>('menu')
  const [code, setCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const matched = useRef(false)

  // 호스트: 상대 입장 알림 대기
  useEffect(() => {
    const onOpp = () => {
      if (matched.current) return
      matched.current = true
      onMatched('host')
    }
    socket.on(`${prefix}:opponent_joined`, onOpp)
    return () => {
      socket.off(`${prefix}:opponent_joined`, onOpp)
    }
  }, [prefix, onMatched])

  const create = () => {
    setError(null)
    socket.emit(`${prefix}:create`, (ack: { code: string }) => {
      setCode(ack.code)
      setStage('waiting')
    })
  }
  const join = () => {
    setError(null)
    socket.emit(`${prefix}:join`, joinCode, (ack: { ok: boolean; error?: string }) => {
      if (ack.ok) {
        matched.current = true
        onMatched('guest')
      } else {
        setError(ack.error ?? '참가에 실패했어요')
      }
    })
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/95 px-6 text-white">
      <button onClick={onCancel} className="absolute top-3 left-4 text-sm text-white/60">
        ‹ 뒤로
      </button>
      <div className="label-mono mb-1" style={{ color: accent }}>
        ONLINE 1 : 1
      </div>
      <h2 className="text-2xl font-black mb-6">{title}</h2>

      {stage === 'menu' && (
        <div className="w-full max-w-xs flex flex-col gap-3">
          <button
            onClick={create}
            className="py-4 rounded-2xl font-bold text-lg active:brightness-110"
            style={{ background: accent, color: '#0a0a0a' }}
          >
            방 만들기
          </button>
          <button
            onClick={() => setStage('joining')}
            className="py-4 rounded-2xl bg-white/10 active:bg-white/20 font-bold text-lg"
          >
            코드로 참가
          </button>
        </div>
      )}

      {stage === 'waiting' && (
        <div className="w-full max-w-xs flex flex-col items-center">
          <p className="text-white/60 text-sm mb-2">친구에게 이 코드를 알려주세요</p>
          <div className="text-5xl font-black tracking-[0.3em] my-2" style={{ color: accent }}>
            {code}
          </div>
          <p className="text-white/50 text-sm mt-4 animate-pulse">상대 입장을 기다리는 중…</p>
          <button onClick={onCancel} className="mt-6 text-sm text-white/50 underline">
            취소
          </button>
        </div>
      )}

      {stage === 'joining' && (
        <div className="w-full max-w-xs flex flex-col items-center">
          <p className="text-white/60 text-sm mb-3">상대가 만든 4자리 코드를 입력하세요</p>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="코드"
            className="w-full px-4 py-3 rounded-xl bg-white/10 text-center text-3xl tracking-[0.4em] font-black outline-none focus:ring-2"
            style={{ ['--tw-ring-color' as string]: accent }}
          />
          <button
            onClick={join}
            disabled={joinCode.length < 4}
            className="w-full mt-4 py-4 rounded-2xl font-bold text-lg disabled:bg-white/10 disabled:text-white/40 active:brightness-110"
            style={joinCode.length < 4 ? {} : { background: accent, color: '#0a0a0a' }}
          >
            참가하기
          </button>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          <button onClick={() => setStage('menu')} className="mt-4 text-sm text-white/50 underline">
            ← 뒤로
          </button>
        </div>
      )}
    </div>
  )
}
