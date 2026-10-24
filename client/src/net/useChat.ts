import { useCallback, useEffect, useRef, useState } from 'react'
import { socket } from './socket'
import type { ChatMessage } from './types'

/**
 * useChat — 요트 방 채팅
 * -------------------------------------------------------------
 * YachtRoom 에서 한 번 부른다 → 대기실 → 게임 화면으로 바뀌어도 목록·안 읽은 수가 유지된다.
 * 기록은 서버가 입장·재접속 때 chat:history 로 통째로 내려준다(그대로 교체).
 *
 * 안 읽은 수: 채팅이 화면에 안 보일 때(setVisible(false)) 남이 보낸 메시지만 센다.
 * 대기실은 늘 보이고, 게임 화면은 패널을 열었을 때만 보인다.
 */

const MAX_KEEP = 50 // 서버 보관 수와 같게
const NOTICE_MS = 2500

export function useChat(youId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [unread, setUnread] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  const visible = useRef(false)
  const youRef = useRef(youId)
  youRef.current = youId
  const noticeTimer = useRef<number | null>(null)

  useEffect(() => {
    const onHistory = (list: ChatMessage[]) => {
      setMessages(list)
      setUnread(0)
    }
    const onMsg = (m: ChatMessage) => {
      setMessages((l) => [...l, m].slice(-MAX_KEEP))
      if (!visible.current && !m.system && m.playerId !== youRef.current) setUnread((n) => n + 1)
    }
    const onNotice = (text: string) => {
      setNotice(text)
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
      noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
    }
    socket.on('chat:history', onHistory)
    socket.on('chat:msg', onMsg)
    socket.on('chat:notice', onNotice)
    return () => {
      socket.off('chat:history', onHistory)
      socket.off('chat:msg', onMsg)
      socket.off('chat:notice', onNotice)
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    }
  }, [])

  const send = useCallback((text: string) => {
    socket.emit('chat:send', text)
  }, [])

  /** 채팅이 지금 화면에 보이는가 — 보이면 안 읽은 수를 0으로 */
  const setVisible = useCallback((v: boolean) => {
    visible.current = v
    if (v) setUnread(0)
  }, [])

  /** 새 메시지 구독 (게임 화면 말풍선용, 해제 함수 반환) */
  const subscribe = useCallback((cb: (m: ChatMessage) => void) => {
    socket.on('chat:msg', cb)
    return () => {
      socket.off('chat:msg', cb)
    }
  }, [])

  return { messages, unread, notice, send, setVisible, subscribe }
}

export type Chat = ReturnType<typeof useChat>
