import { useState } from 'react'
import Home from './Home'
import Lobby from './Lobby'
import PlayScreen from './PlayScreen'
import Results from './Results'
import YachtDice from '../games/yacht/YachtDice'
import { useRoom } from '../net/useRoom'

/**
 * YachtRoom — 요트 다이스의 화면 흐름
 * -------------------------------------------------------------
 *   Home(입장)  ─ 방 만들기 ─▶ Lobby(대기실) ─ 시작 ─▶ PlayScreen(턴제) ─▶ Results(순위)
 *      │                            ▲                                        │
 *      ├─ 게임 참여 ────────────────┘                          다시 하기 ────┘
 *      └─ 혼자 하기 ─▶ YachtDice (서버 없이)
 *
 * 방 상태(status)가 단일 소스다 — lobby/playing/finished 에 따라 화면을 고른다.
 * 서버 상태를 받기 전이나 재접속 중에는 잠깐 대기 화면을 띄운다.
 */
export default function YachtRoom({
  onExit,
  initialCode = '',
  phoneConnected = false,
}: {
  onExit: () => void
  initialCode?: string
  /** 허브에서 페어링한 폰이 붙어 있는가 — "흔들어서 굴리기" 안내에 쓴다 */
  phoneConnected?: boolean
}) {
  const [solo, setSolo] = useState(false)
  const {
    room,
    you,
    youId,
    isHost,
    isMyTurn,
    joined,
    connected,
    rejoining,
    error,
    finalRanking,
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
  } = useRoom()

  if (solo) return <YachtDice onExit={() => setSolo(false)} phoneConnected={phoneConnected} />

  /** 허브로 나가기 — 방에 있었으면 자리를 비운다 */
  const exit = () => {
    if (joined) leaveRoom()
    onExit()
  }

  // 아직 방에 못 들어갔다 → 입장 화면
  if (!joined || !room || !you) {
    // 저장된 좌석을 되찾는 중 (폰 잠금 해제·새로고침 직후)
    if (rejoining) {
      return (
        <div className="yd flex min-h-full items-center justify-center">
          <div className="text-center">
            <div className="mb-3 animate-pulse text-5xl">🎲</div>
            <p className="text-sm text-[var(--ink-2)]">자리를 되찾는 중…</p>
          </div>
        </div>
      )
    }
    return (
      <Home
        connected={connected}
        error={error}
        initialCode={initialCode}
        onCreate={createRoom}
        onJoin={joinRoom}
        onSolo={() => setSolo(true)}
        onExit={onExit}
      />
    )
  }

  if (room.status === 'lobby') {
    return (
      <Lobby room={room} isHost={isHost} youId={youId} onStart={startGame} onLeave={exit} />
    )
  }

  if (room.status === 'finished') {
    return (
      <Results
        room={room}
        ranking={finalRanking}
        isHost={isHost}
        youId={youId}
        onRestart={restart}
        onLeave={exit}
      />
    )
  }

  return (
    <PlayScreen
      room={room}
      you={you}
      isMyTurn={isMyTurn}
      phoneConnected={phoneConnected}
      onRoll={rollDice}
      onToggleKeep={toggleKeep}
      onScore={scoreCategory}
      onReact={sendReaction}
      onLeave={exit}
      subscribeReaction={subscribeReaction}
      subscribeLog={subscribeLog}
    />
  )
}
