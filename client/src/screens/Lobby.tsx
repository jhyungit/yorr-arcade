import { useEffect, useState } from 'react'
import ChatBox from '../components/ChatBox'
import QrCode from '../components/QrCode'
import SettingsGear from '../components/FeedbackSettings'
import { seatColor } from '../components/PlayerStrip'
import { isReachableFromPhone } from '../lib/device'
import type { RoomState } from '../net/types'
import type { Chat } from '../net/useChat'

/**
 * Lobby — 대기실
 * -------------------------------------------------------------
 * - 6자리 초대 코드를 크게 표시 (탭하면 복사) + 친구에게 보낼 링크.
 * - 좌석 6칸을 미리 그려 두고 들어온 사람으로 채운다 → 몇 명 더 올 수 있는지 한눈에.
 * - 방장에게만 [게임 시작].
 * - 채팅: 1200px 이상이면 오른쪽 칼럼(왼쪽 칼럼 높이에 맞춤), 그 미만이면 PLAYERS 아래 220px.
 *
 * (파티 모드용 QR 입장은 다음 단계 — 지금은 코드/링크만)
 */
interface LobbyProps {
  room: RoomState
  isHost: boolean
  youId: string | null
  onStart: () => void
  onLeave: () => void
  chat: Chat
}

const WIDE = '(min-width: 1200px)'

/** 채팅을 오른쪽 칼럼에 둘 만큼 넓은가 — DOM 위치가 달라서 CSS 만으로는 못 바꾼다 */
function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const m = window.matchMedia(WIDE)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

export default function Lobby({ room, isHost, youId, onStart, onLeave, chat }: LobbyProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const wide = useWide()

  // 대기실에선 채팅이 늘 보인다 → 안 읽은 수를 세지 않는다
  const { setVisible } = chat
  useEffect(() => {
    setVisible(true)
    return () => setVisible(false)
  }, [setVisible])

  // 친구가 눌러 바로 입장할 링크 (?room=코드)
  const joinUrl = `${window.location.origin}/?room=${room.code}`

  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? room.code : joinUrl)
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // 클립보드 권한이 없으면 무시 (사용자가 직접 복사)
    }
  }

  const empty = Math.max(0, room.maxPlayers - room.players.length)

  return (
    <div className="yd flex min-h-full flex-col">
      {/* 두 칼럼을 묶어서 가운데 정렬 (좁으면 왼쪽 칼럼 하나) */}
      <div className="m-auto flex w-full justify-center gap-6 px-5 py-6">
        <div className="w-full max-w-[420px]">
          <header className="mb-5 flex items-center justify-between">
            <button onClick={onLeave} className="yd-ghost" aria-label="방에서 나가기">
              ‹ 나가기
            </button>
            <div className="flex items-center gap-2">
              <span className="label-mono text-[var(--ink-3)]">WAITING ROOM · 대기실</span>
              <SettingsGear tone="theme" accent="var(--gold)" />
            </div>
          </header>

          {/* 초대 코드 — 탭하면 복사 */}
          <button
            onClick={() => copy('code')}
            className="w-full text-center"
            aria-label={`초대 코드 ${room.code} 복사`}
          >
            <span className="yd-sec justify-center">INVITE CODE · 초대 코드</span>
            <span className="mt-1 flex justify-center gap-1.5">
              {room.code.split('').map((ch, i) => (
                <span key={i} className="yd-code-cell is-big" data-on="0">
                  {ch}
                </span>
              ))}
            </span>
            <span className="mt-2 block text-[11px] text-[var(--ink-3)]">
              {copied === 'code' ? '복사됐어요!' : '탭하면 복사 · 친구에게 이 코드를 알려주세요'}
            </span>
          </button>

          {/* QR — 한 화면을 같이 보며 각자 폰으로 입장(파티 모드) */}
          {isReachableFromPhone() && (
            <div className="mt-4 flex items-center gap-3.5 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
              <QrCode value={joinUrl} size={104} />
              <div className="min-w-0 text-[12px] leading-relaxed text-[var(--ink-2)]">
                <b className="text-[var(--ink)]">QR 로 바로 입장</b>
                <br />
                옆 사람은 이걸 찍으면 코드를 안 넣어도 참가 화면으로 들어옵니다.
              </div>
            </div>
          )}

          {/* 공유 링크 */}
          <div className="mt-3 flex gap-2">
            <input
              readOnly
              value={joinUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--ink-2)] outline-none"
            />
            <button onClick={() => copy('link')} className="yd-ghost whitespace-nowrap">
              {copied === 'link' ? '복사됨!' : '링크 복사'}
            </button>
          </div>

          {/* 좌석 */}
          <div className="mt-6">
            <div className="yd-sec">
              <span>PLAYERS</span>
              <span className="tabular-nums">
                {room.players.length}/{room.maxPlayers}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {room.players.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5"
                  style={{
                    borderColor: p.id === youId ? 'var(--line-2)' : 'var(--line)',
                    background: p.id === youId ? 'var(--card-2)' : 'var(--card)',
                  }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ background: seatColor(p.id) }}
                  >
                    {p.nickname.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold text-[var(--ink)]">
                      {p.nickname}
                      {p.id === youId && <span className="text-[var(--pos)]"> ·나</span>}
                    </span>
                    <span className="label-mono text-[var(--ink-3)]">
                      {p.id === room.hostId ? '방장' : `${i + 1}번째`}
                    </span>
                  </span>
                </div>
              ))}
              {Array.from({ length: empty }, (_, i) => (
                <div
                  key={`empty-${i}`}
                  className="flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--line)] px-3 py-2.5 opacity-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--line-2)] text-xs text-[var(--ink-3)]">
                    +
                  </span>
                  <span className="text-[13px] text-[var(--ink-3)]">비어 있음</span>
                </div>
              ))}
            </div>
          </div>

          {!wide && <ChatBox chat={chat} youId={youId} className="mt-4 h-[220px]" />}

          {/* 규칙 요약 */}
          <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
            <div className="yd-sec">HOW TO PLAY</div>
            <ul className="mt-1 space-y-1 text-[12px] leading-relaxed text-[var(--ink-2)]">
              <li>· 순서대로 한 사람씩 굴린다 (한 차례에 최대 3번)</li>
              <li>· 남길 주사위를 탭해 고정하고 남은 것만 다시 굴린다</li>
              <li>· 점수판에서 칸을 고르고 아래 버튼으로 확정</li>
              <li>· 12라운드 × {room.players.length || 1}명 — 다 채우면 순위 발표</li>
            </ul>
          </div>

          <div className="mt-6">
            {isHost ? (
              <button onClick={onStart} className="yd-cta">
                게임 시작 · {room.players.length}명
              </button>
            ) : (
              <p className="py-4 text-center text-sm text-[var(--ink-2)]">
                방장이 시작하기를 기다리는 중…
              </p>
            )}
          </div>
        </div>

        {/* 채팅 칼럼 — 높이는 왼쪽 칼럼을 따른다 (absolute 라 칼럼 높이를 밀어 올리지 않는다) */}
        {wide && (
          <div className="relative w-[400px] shrink-0">
            {/* .yd-chat 이 position:relative 라 absolute 는 바깥 래퍼에 준다 */}
            <div className="absolute inset-0 flex flex-col">
              <ChatBox chat={chat} youId={youId} className="flex-1" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
