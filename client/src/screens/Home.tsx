import { useState } from 'react'

/**
 * Home — 첫 화면
 * -------------------------------------------------------------
 * 닉네임을 입력하고 [방 만들기] 또는 [참가하기].
 * URL 에 ?room=CODE 가 있으면(친구가 보낸 링크로 들어온 경우) 참가쪽을 미리 열어둔다.
 */
interface HomeProps {
  connected: boolean
  error: string | null
  initialCode: string // URL ?room=CODE 로 들어온 경우 미리 채워질 코드
  onCreate: (nickname: string) => void
  onJoin: (code: string, nickname: string) => void
}

export default function Home({ connected, error, initialCode, onCreate, onJoin }: HomeProps) {
  // 닉네임은 다음에도 쓰도록 브라우저에 저장
  const [nickname, setNickname] = useState(() => localStorage.getItem('nickname') || '')
  const [code, setCode] = useState(initialCode)
  // 링크로 들어왔으면 참가 모드로 시작
  const [mode, setMode] = useState<'menu' | 'join'>(initialCode ? 'join' : 'menu')

  const saveNick = (v: string) => {
    setNickname(v)
    localStorage.setItem('nickname', v)
  }

  const nickOk = nickname.trim().length > 0

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center">
      <div className="text-7xl mb-4">🎲</div>
      <h1 className="text-3xl font-black mb-1">요트 다이스</h1>
      <p className="text-slate-400 mb-8 text-sm">흔들고 던져서 함께 굴리는 주사위 게임</p>

      {/* 닉네임 */}
      <input
        value={nickname}
        onChange={(e) => saveNick(e.target.value)}
        placeholder="닉네임을 입력하세요"
        maxLength={12}
        className="w-full px-4 py-3 mb-4 rounded-xl bg-slate-800 text-center text-lg outline-none focus:ring-2 ring-indigo-400"
      />

      {mode === 'menu' ? (
        <div className="w-full flex flex-col gap-3">
          <button
            disabled={!nickOk || !connected}
            onClick={() => onCreate(nickname.trim())}
            className="w-full py-4 rounded-2xl bg-[#b6f24a] active:brightness-95 disabled:bg-white/10 disabled:text-white/40 text-black text-lg font-bold shadow-lg"
          >
            방 만들기
          </button>
          <button
            disabled={!nickOk}
            onClick={() => setMode('join')}
            className="w-full py-4 rounded-2xl bg-slate-700 active:bg-slate-600 disabled:text-slate-500 text-white text-lg font-bold"
          >
            참가하기
          </button>
        </div>
      ) : (
        <div className="w-full flex flex-col gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="입장코드 4자리"
            maxLength={4}
            className="w-full px-4 py-3 rounded-xl bg-slate-800 text-center text-2xl tracking-[0.3em] font-bold outline-none focus:ring-2 ring-indigo-400"
          />
          <button
            disabled={!nickOk || code.trim().length < 4 || !connected}
            onClick={() => onJoin(code.trim(), nickname.trim())}
            className="w-full py-4 rounded-2xl bg-[#b6f24a] active:brightness-95 disabled:bg-white/10 disabled:text-white/40 text-black text-lg font-bold shadow-lg"
          >
            입장하기
          </button>
          <button onClick={() => setMode('menu')} className="text-sm text-slate-400 underline mt-1">
            ← 뒤로
          </button>
        </div>
      )}

      {/* 상태 / 에러 */}
      {!connected && <p className="text-amber-400 text-sm mt-4">서버 연결 중…</p>}
      {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
    </div>
  )
}
