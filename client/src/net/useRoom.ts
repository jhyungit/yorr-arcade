import { useCallback, useEffect, useMemo, useState } from 'react'
import { socket } from './socket'
import type { CategoryId, JoinAck, ReactionType, RoomState } from './types'

/**
 * useRoom
 * -------------------------------------------------------------
 * 서버와 연결해서 방 상태를 구독하고, 방 관련 동작(만들기/참가/시작/점수)을
 * 함수로 노출하는 훅. 화면 컴포넌트는 이 훅만 쓰면 된다.
 */
export function useRoom() {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [youId, setYouId] = useState<string | null>(null)
  const [connected, setConnected] = useState(socket.connected)
  const [error, setError] = useState<string | null>(null)

  // 서버 이벤트 구독
  useEffect(() => {
    const onState = (s: RoomState) => setRoom(s)
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    socket.on('room:state', onState)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('room:state', onState)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  /** 방 만들기 → 성공하면 내 id 저장 */
  const createRoom = useCallback((nickname: string) => {
    setError(null)
    socket.emit('room:create', nickname, (ack: JoinAck) => {
      if (ack.ok && ack.youId) setYouId(ack.youId)
      else setError(ack.error ?? '방 생성 실패')
    })
  }, [])

  /** 입장코드로 참가 */
  const joinRoom = useCallback((code: string, nickname: string) => {
    setError(null)
    socket.emit('room:join', code, nickname, (ack: JoinAck) => {
      if (ack.ok && ack.youId) setYouId(ack.youId)
      else setError(ack.error ?? '참가 실패')
    })
  }, [])

  const startGame = useCallback(() => socket.emit('room:start'), [])
  const restart = useCallback(() => socket.emit('room:restart'), [])

  /** 로컬에서 굴린 주사위 결과를 서버에 공유(다른 사람이 실시간으로 봄) */
  const reportRoll = useCallback((dice: number[], rollsLeft: number) => {
    socket.emit('game:roll', { dice, rollsLeft })
  }, [])

  /** 점수 확정 */
  const scoreCategory = useCallback((categoryId: CategoryId, score: number) => {
    socket.emit('game:score', { categoryId, score })
  }, [])

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

  // 편의 파생값
  const you = useMemo(
    () => room?.players.find((p) => p.id === youId) ?? null,
    [room, youId],
  )
  const isHost = !!room && !!youId && room.hostId === youId
  const joined = !!room && !!you

  return {
    // 상태
    room,
    you,
    youId,
    isHost,
    joined,
    connected,
    error,
    setError,
    // 동작
    createRoom,
    joinRoom,
    startGame,
    restart,
    reportRoll,
    scoreCategory,
    sendReaction,
    subscribeReaction,
  }
}
