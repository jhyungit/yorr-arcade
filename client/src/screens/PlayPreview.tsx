import { useRef, useState } from 'react'
import PlayScreen from './PlayScreen'
import { emptyScoreSheet, type CategoryId } from '../game/yacht'
import type { PlayerState, ReactionType, RoomState } from '../net/types'

/**
 * PlayPreview — 스토어/서버 없이 mock 으로 PlayScreen 을 띄우는 프리뷰.
 * 접속: /?preview=play
 */
function mockPlayer(id: string, nickname: string, filled: Partial<Record<CategoryId, number>>): PlayerState {
  const sheet = emptyScoreSheet()
  for (const [k, v] of Object.entries(filled)) sheet[k as CategoryId] = v as number
  return {
    id,
    nickname,
    connected: true,
    sheet,
    dice: [1, 1, 1, 1, 1],
    rollsLeft: 3,
    rolledThisRound: false,
    done: id === 'bot',
    total: 0,
  }
}

export default function PlayPreview() {
  const reactionCb = useRef<((r: { playerId: string; type: ReactionType }) => void) | null>(null)

  const [room, setRoom] = useState<RoomState>(() => ({
    code: 'AB3K',
    hostId: 'me',
    status: 'playing',
    round: 3,
    totalRounds: 12,
    deadline: Date.now() + 22000,
    players: [
      mockPlayer('me', '이정현', { ones: 3, twos: 6, threes: 9 }),
      mockPlayer('bot', '상은', { ones: 2, fours: 12, yacht: 50 }),
    ],
  }))
  const you = room.players[0]

  return (
    <PlayScreen
      room={room}
      you={you}
      onRoll={() => {}}
      onScore={(cat, score) =>
        setRoom((r) => ({
          ...r,
          players: r.players.map((p) =>
            p.id === 'me' ? { ...p, sheet: { ...p.sheet, [cat]: score } } : p,
          ),
        }))
      }
      onReact={(type) => reactionCb.current?.({ playerId: 'me', type })}
      subscribeReaction={(cb) => {
        reactionCb.current = cb
        return () => {
          reactionCb.current = null
        }
      }}
    />
  )
}
