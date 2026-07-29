import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { socket } from './socket'
import type { CategoryId, JoinAck, RankRow, ReactionType, RoomLog, RoomState } from './types'

/**
 * useRoom — 요트 다이스 턴제 방
 * -------------------------------------------------------------
 * 서버와 연결해서 방 상태를 구독하고, 방 관련 동작(만들기/참가/굴리기/기록)을
 * 함수로 노출하는 훅. 화면 컴포넌트는 이 훅만 쓰면 된다.
 *
 * 재접속: 폰이 잠기거나 신호가 끊기면 소켓 id 가 바뀌어 서버가 나를 못 알아본다.
 * 그래서 입장할 때 받은 token 을 sessionStorage 에 넣어 두고, 소켓이 다시
 * 붙을 때마다 room:rejoin 으로 원래 좌석을 되찾는다 (게임 중이어도 된다).
 * → 새로고침해도 판이 안 날아간다.
 */

const SESSION_KEY = 'yacht.session'

interface Session {
  code: string
  token: string
}

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    return s?.code && s?.token ? (s as Session) : null
  } catch {
    return null
  }
}

function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // 시크릿 모드 등 — 저장 못 해도 게임은 굴러간다
  }
}

/** 이전 판의 세션이 남아 있는가 (허브에서 "돌아가기" 안내를 띄우는 데 쓴다) */
export function savedRoomCode(): string | null {
  return loadSession()?.code ?? null
}

export function useRoom() {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [youId, setYouId] = useState<string | null>(null)
  const [connected, setConnected] = useState(socket.connected)
  const [error, setError] = useState<string | null>(null)
  const [finalRanking, setFinalRanking] = useState<RankRow[] | null>(null)
  const [rejoining, setRejoining] = useState(false)

  // 재접속에 쓸 값 — 렌더와 무관하므로 ref
  const session = useRef<Session | null>(loadSession())

  const remember = useCallback((ack: JoinAck) => {
    if (!ack.ok || !ack.youId || !ack.code || !ack.token) return false
    session.current = { code: ack.code, token: ack.token }
    saveSession(session.current)
    setYouId(ack.youId)
    setError(null)
    return true
  }, [])

  const forget = useCallback(() => {
    session.current = null
    saveSession(null)
    setYouId(null)
    setRoom(null)
    setFinalRanking(null)
  }, [])

  // 서버 이벤트 구독
  useEffect(() => {
    const onState = (s: RoomState) => {
      setRoom(s)
      // 대기실로 되돌아가면(다시 하기) 지난 순위는 지운다
      if (s.status === 'lobby') setFinalRanking(null)
    }
    const onFinished = ({ ranking }: { ranking: RankRow[] }) => setFinalRanking(ranking)
    const onDisconnect = () => setConnected(false)

    /** 소켓이 (다시) 붙었다 — 저장된 좌석이 있으면 되찾는다 */
    const onConnect = () => {
      setConnected(true)
      const s = session.current
      if (!s) return
      setRejoining(true)
      socket.emit('room:rejoin', s.code, s.token, (ack: JoinAck) => {
        setRejoining(false)
        if (ack.ok) remember(ack)
        else {
          // 방이 사라졌거나 자리가 없어졌다 — 조용히 처음 화면으로
          forget()
        }
      })
    }

    socket.on('room:state', onState)
    socket.on('room:finished', onFinished)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    // 이미 붙어 있는 상태로 마운트됐다면 (허브를 거쳐 들어온 경우) 지금 한 번
    if (socket.connected) onConnect()

    return () => {
      socket.off('room:state', onState)
      socket.off('room:finished', onFinished)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [remember, forget])

  /** 방 만들기 → 6자리 초대 코드 발급 + 바로 입장 */
  const createRoom = useCallback(
    (nickname: string) => {
      setError(null)
      socket.emit('room:create', nickname, (ack: JoinAck) => {
        if (!remember(ack)) setError(ack.error ?? '방을 만들지 못했어요.')
      })
    },
    [remember],
  )

  /** 초대 코드로 참가 */
  const joinRoom = useCallback(
    (code: string, nickname: string) => {
      setError(null)
      socket.emit('room:join', code.toUpperCase().trim(), nickname, (ack: JoinAck) => {
        if (!remember(ack)) setError(ack.error ?? '참가하지 못했어요.')
      })
    },
    [remember],
  )

  /** 방 나가기 (허브로) */
  const leaveRoom = useCallback(() => {
    socket.emit('room:leave')
    forget()
  }, [forget])

  const startGame = useCallback(() => socket.emit('room:start'), [])
  const restart = useCallback(() => socket.emit('room:restart'), [])

  /** 굴리기 요청 — 실제 주사위는 서버가 굴린다 */
  const rollDice = useCallback(() => socket.emit('game:roll'), [])

  /** 주사위 고정/해제 */
  const toggleKeep = useCallback((index: number) => socket.emit('game:keep', { index }), [])

  /** 점수 확정 (점수 계산도 서버가 한다 — 칸만 보낸다) */
  const scoreCategory = useCallback(
    (categoryId: CategoryId) => socket.emit('game:score', { categoryId }),
    [],
  )

  /** 리액션 보내기 */
  const sendReaction = useCallback((type: ReactionType) => {
    socket.emit('reaction:send', { type })
  }, [])

  /** 리액션 수신 구독 (해제 함수 반환) */
  const subscribeReaction = useCallback(
    (cb: (r: { playerId: string; type: ReactionType }) => void) => {
      socket.on('reaction:recv', cb)
      return () => socket.off('reaction:recv', cb)
    },
    [],
  )

  /** 진행 로그 구독 (누가 어디에 몇 점) */
  const subscribeLog = useCallback((cb: (log: RoomLog) => void) => {
    socket.on('room:log', cb)
    return () => socket.off('room:log', cb)
  }, [])

  // 편의 파생값
  const you = useMemo(() => room?.players.find((p) => p.id === youId) ?? null, [room, youId])
  const isHost = !!room && !!youId && room.hostId === youId
  const isMyTurn = !!room && !!youId && room.turnId === youId
  const joined = !!room && !!you

  return {
    // 상태
    room,
    you,
    youId,
    isHost,
    isMyTurn,
    joined,
    connected,
    rejoining,
    error,
    setError,
    finalRanking,
    // 동작
    createRoom,
    joinRoom,
    leaveRoom,
    startGame,
    restart,
    rollDice,
    toggleKeep,
    scoreCategory,
    sendReaction,
    subscribeReaction,
    subscribeLog,
  }
}
