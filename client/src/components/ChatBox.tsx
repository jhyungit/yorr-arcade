import { useLayoutEffect, useRef, useState } from 'react'
import type { Chat } from '../net/useChat'

/**
 * ChatBox — 방 채팅 카드 (대기실 칼럼 · 게임 화면 패널 공용)
 * -------------------------------------------------------------
 * - 메시지 영역만 스크롤, 입력창은 아래 고정 (부모가 높이를 정해 준다)
 * - 맨 아래를 보고 있을 때만 자동 스크롤. 위로 올려 읽는 중이면 "새 메시지 ↓"
 * - 텍스트는 React 텍스트 노드로만 넣는다 (innerHTML 없음 → 이스케이프 자동)
 * - Enter 전송. 한글 조합 중 Enter(isComposing / keyCode 229)는 무시
 */
interface ChatBoxProps {
  chat: Chat
  youId: string | null
  className?: string
  /** 입력창 포커스 — 게임 화면이 굴리기 입력을 잠그는 데 쓴다 */
  onFocusChange?: (focused: boolean) => void
  /** 있으면 헤더에 닫기 버튼 (게임 화면 패널) */
  onClose?: () => void
  autoFocus?: boolean
}

// 바닥에서 이만큼 안쪽이면 "맨 아래를 보는 중"으로 친다
const STICK_PX = 32

export default function ChatBox({ chat, youId, className = '', onFocusChange, onClose, autoFocus }: ChatBoxProps) {
  const { messages, notice, send } = chat
  const [draft, setDraft] = useState('')
  const [hasNew, setHasNew] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  const toBottom = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setHasNew(false)
  }

  // 새 메시지: 바닥을 보고 있었거나 내가 보낸 거면 따라 내려가고, 아니면 버튼만
  useLayoutEffect(() => {
    const last = messages[messages.length - 1]
    if (atBottom.current || (last && last.playerId === youId)) toBottom()
    else if (last) setHasNew(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
    if (atBottom.current) setHasNew(false)
  }

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    send(text)
    setDraft('')
  }

  return (
    <div className={`yd-card yd-chat ${className}`}>
      <div className="yd-sec">
        <span>CHAT · 채팅</span>
        {onClose && (
          <button onClick={onClose} className="yd-chat-close" aria-label="채팅 닫기">
            ✕
          </button>
        )}
      </div>

      <div ref={listRef} onScroll={onScroll} className="yd-chat-list" aria-live="polite">
        {messages.length === 0 && <div className="yd-chat-sys">아직 대화가 없어요. 먼저 인사해 보세요!</div>}
        {messages.map((m) => {
          if (m.system) {
            return (
              <div key={m.id} className="yd-chat-sys">
                {m.text}
              </div>
            )
          }
          const mine = m.playerId === youId
          return (
            <div key={m.id} className="yd-chat-row" data-mine={mine ? 1 : 0}>
              {!mine && (
                <span className="yd-chat-avatar" style={{ background: m.color }}>
                  {(m.name ?? '?').slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                {!mine && (
                  <div className="yd-chat-name" style={{ color: m.color }}>
                    {m.name}
                  </div>
                )}
                <div className="yd-chat-bubble">{m.text}</div>
              </div>
            </div>
          )
        })}
      </div>

      {hasNew && (
        <button onClick={toBottom} className="yd-chat-new">
          새 메시지 ↓
        </button>
      )}
      {notice && <div className="yd-chat-notice">{notice}</div>}

      <div className="yd-chat-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
            e.preventDefault()
            submit()
          }}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          maxLength={100}
          placeholder="메시지 입력 (Enter)"
          aria-label="채팅 메시지"
          enterKeyHint="send"
          autoFocus={autoFocus}
        />
        {/* mousedown 기본동작을 막아 입력창 포커스 유지 → 모바일 키보드가 내려가지 않는다 */}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="보내기"
        >
          ↑
        </button>
      </div>
    </div>
  )
}
