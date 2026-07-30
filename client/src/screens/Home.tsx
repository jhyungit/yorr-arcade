import { useEffect, useRef, useState } from 'react'
import SettingsGear from '../components/FeedbackSettings'

/**
 * Home — 요트 다이스 입장 화면
 * -------------------------------------------------------------
 * 허브에서 요트 카드를 누르면 제일 먼저 나오는 화면.
 *   [방 만들기]  → 6자리 초대 코드를 발급받고 대기실로
 *   [게임 참여]  → 방장이 알려준 코드를 넣고 입장
 *   [혼자 하기]  → 서버 없이 도는 솔로 12라운드
 *
 * 코드 입력은 6칸 박스 위에 투명 input 을 겹쳐 둔다 (붙여넣기·모바일 키보드 다 됨).
 * 색은 요트 고유 톤(.yd — 펠트/월넛/골드)을 따른다.
 */

const CODE_LEN = 6

interface HomeProps {
  connected: boolean
  error: string | null
  initialCode: string // URL ?room=CODE 로 들어온 경우 미리 채워질 코드
  onCreate: (nickname: string) => void
  onJoin: (code: string, nickname: string) => void
  onSolo: () => void
  onExit: () => void
}

export default function Home({
  connected,
  error,
  initialCode,
  onCreate,
  onJoin,
  onSolo,
  onExit,
}: HomeProps) {
  // 닉네임은 다음에도 쓰도록 브라우저에 저장
  const [nickname, setNickname] = useState(() => localStorage.getItem('nickname') || '')
  const [code, setCode] = useState(initialCode.toUpperCase().slice(0, CODE_LEN))
  // 링크로 들어왔으면 참가 모드로 시작
  const [mode, setMode] = useState<'menu' | 'join'>(initialCode ? 'join' : 'menu')
  const codeRef = useRef<HTMLInputElement | null>(null)

  const saveNick = (v: string) => {
    setNickname(v)
    localStorage.setItem('nickname', v)
  }

  // 참가 모드로 들어오면 바로 코드 칸에 포커스
  useEffect(() => {
    if (mode === 'join') codeRef.current?.focus()
  }, [mode])

  const nick = nickname.trim()
  const nickOk = nick.length > 0
  const codeOk = code.length === CODE_LEN

  return (
    <div className="yd flex min-h-full flex-col">
      <div className="mx-auto my-auto w-full max-w-[420px] px-5 py-6">
        <header className="mb-6 flex items-center justify-between">
          <button onClick={onExit} className="yd-ghost" aria-label="허브로 나가기">
            ‹ 나가기
          </button>
          <div className="flex items-center gap-2">
            <span className="label-mono text-[var(--ink-3)]">
              {connected ? 'ONLINE' : 'CONNECTING…'}
            </span>
            <SettingsGear tone="theme" accent="var(--gold)" />
          </div>
        </header>

        {/* 타이틀 */}
        <div className="text-center">
          <div className="mb-2 text-6xl">🎲</div>
          <h1 className="font-display text-3xl font-black text-[var(--ink)]">요트 다이스</h1>
          <p className="label-mono mt-1 text-[var(--gold)] opacity-80">
            YACHT DICE · 최대 6인 턴제
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
            한 사람씩 돌아가며 굴린다.
            <br />
            남의 주사위도 실시간으로 같이 본다.
          </p>
        </div>

        {/* 닉네임 */}
        <label className="mt-7 block">
          <span className="yd-sec">NICKNAME · 닉네임</span>
          <input
            value={nickname}
            onChange={(e) => saveNick(e.target.value)}
            placeholder="점수판에 표시될 이름"
            maxLength={12}
            className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-center text-lg text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)] focus:border-[var(--line-2)]"
          />
        </label>

        {mode === 'menu' ? (
          <div className="mt-5 flex flex-col gap-2.5">
            <button disabled={!nickOk || !connected} onClick={() => onCreate(nick)} className="yd-cta">
              방 만들기
            </button>
            <button
              disabled={!nickOk}
              onClick={() => setMode('join')}
              className="yd-cta is-ghost"
            >
              게임 참여
            </button>
            <button onClick={onSolo} className="yd-link mt-1">
              혼자 하기 (서버 없이 12라운드)
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <span className="yd-sec">INVITE CODE · 초대 코드 {CODE_LEN}자리</span>

            {/* 6칸 박스 + 겹쳐 둔 투명 input */}
            <div className="relative mt-1">
              <input
                ref={codeRef}
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, CODE_LEN),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nickOk && codeOk && connected) onJoin(code, nick)
                }}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label={`초대 코드 ${CODE_LEN}자리`}
                /* text-[16px]: 이보다 작으면 iOS 사파리가 포커스 때 화면을 확대한다 */
                className="absolute inset-0 z-10 h-full w-full cursor-pointer bg-transparent text-[16px] text-transparent caret-transparent outline-none"
              />
              <div className="flex justify-between gap-1.5">
                {Array.from({ length: CODE_LEN }, (_, i) => (
                  <span
                    key={i}
                    data-on={i === code.length ? 1 : 0}
                    className="yd-code-cell"
                  >
                    {code[i] ?? ''}
                  </span>
                ))}
              </div>
            </div>

            <button
              disabled={!nickOk || !codeOk || !connected}
              onClick={() => onJoin(code, nick)}
              className="yd-cta mt-4"
            >
              입장하기
            </button>
            <button onClick={() => setMode('menu')} className="yd-link mt-2">
              ← 뒤로
            </button>
          </div>
        )}

        {/* 상태 / 에러 */}
        {!connected && (
          <p className="mt-4 text-center text-sm text-[var(--gold)]">서버에 연결하는 중…</p>
        )}
        {error && <p className="mt-4 text-center text-sm text-[#e0483a]">{error}</p>}
      </div>
    </div>
  )
}
