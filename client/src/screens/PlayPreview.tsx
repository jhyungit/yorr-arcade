import { useRef, useState } from 'react'
import PlayScreen from './PlayScreen'
import { emptyScoreSheet, scoreFor, totalScore, type CategoryId } from '../game/yacht'
import type { PlayerState, ReactionType, RoomLog, RoomState } from '../net/types'

/**
 * PlayPreview — 서버 없이 mock 으로 PlayScreen(턴제)을 띄우는 프리뷰.
 * 접속: /?preview=play
 *
 * 서버가 하는 일(주사위 굴리기·점수 계산·차례 넘기기)을 여기서 흉내만 낸다.
 * 디자인/레이아웃을 손볼 때 방을 만들지 않고 바로 확인하려고 남겨 둔 화면.
 */
function mockPlayer(
  id: string,
  nickname: string,
  filled: Partial<Record<CategoryId, number>>,
): PlayerState {
  const sheet = emptyScoreSheet()
  for (const [k, v] of Object.entries(filled)) sheet[k as CategoryId] = v as number
  return {
    id,
    nickname,
    connected: true,
    sheet,
    dice: [1, 2, 3, 4, 5],
    kept: [false, false, false, false, false],
    rollsLeft: 3,
    rolled: false,
    total: totalScore(sheet),
  }
}

const TURN_MS = 45000

export default function PlayPreview() {
  const reactionCb = useRef<((r: { playerId: string; type: ReactionType }) => void) | null>(null)
  const logCb = useRef<((log: RoomLog) => void) | null>(null)

  const [room, setRoom] = useState<RoomState>(() => ({
    code: 'AB3K7M',
    hostId: 'p1',
    status: 'playing',
    round: 3,
    totalRounds: 12,
    maxPlayers: 6,
    turnId: 'p1',
    turnSeq: 1,
    rollSeq: 0,
    deadline: Date.now() + TURN_MS,
    turnMs: TURN_MS,
    players: [
      mockPlayer('p1', '이정현', { ones: 3, twos: 6 }),
      mockPlayer('p2', '상은', { ones: 2, fours: 12 }),
      mockPlayer('p3', '민서', { threes: 9, yacht: 50 }),
    ],
  }))
  const you = room.players[0]

  /** 굴리기 — 서버 대신 여기서 눈을 뽑는다 */
  const roll = () =>
    setRoom((r) => ({
      ...r,
      rollSeq: r.rollSeq + 1,
      deadline: Date.now() + TURN_MS,
      players: r.players.map((p) =>
        p.id === r.turnId
          ? {
              ...p,
              dice: p.dice.map((v, i) => (p.kept[i] ? v : 1 + Math.floor(Math.random() * 6))),
              rollsLeft: Math.max(0, p.rollsLeft - 1),
              rolled: true,
            }
          : p,
      ),
    }))

  const toggleKeep = (index: number) =>
    setRoom((r) => ({
      ...r,
      players: r.players.map((p) =>
        p.id === r.turnId
          ? { ...p, kept: p.kept.map((k, i) => (i === index ? !k : k)) }
          : p,
      ),
    }))

  /** 기록 → 다음 차례 (프리뷰라 한 바퀴만 돌린다) */
  const score = (categoryId: CategoryId) =>
    setRoom((r) => {
      const cur = r.players.find((p) => p.id === r.turnId)!
      const gained = scoreFor(categoryId, cur.dice)
      logCb.current?.({
        seq: r.rollSeq * 100 + r.turnSeq,
        playerId: cur.id,
        nickname: cur.nickname,
        categoryId,
        score: gained,
        auto: false,
        round: r.round,
      })
      const at = r.players.findIndex((p) => p.id === r.turnId)
      const next = r.players[(at + 1) % r.players.length]
      return {
        ...r,
        turnId: next.id,
        turnSeq: r.turnSeq + 1,
        deadline: Date.now() + TURN_MS,
        players: r.players.map((p) => {
          const sheet = p.id === cur.id ? { ...p.sheet, [categoryId]: gained } : p.sheet
          return {
            ...p,
            sheet,
            total: totalScore(sheet),
            dice: [1, 2, 3, 4, 5],
            kept: [false, false, false, false, false],
            rollsLeft: 3,
            rolled: false,
          }
        }),
      }
    })

  return (
    <PlayScreen
      room={room}
      you={you}
      isMyTurn={room.turnId === you.id}
      onRoll={roll}
      onToggleKeep={toggleKeep}
      onScore={score}
      onReact={(type) => reactionCb.current?.({ playerId: you.id, type })}
      onLeave={() => {
        window.location.search = ''
      }}
      subscribeReaction={(cb) => {
        reactionCb.current = cb
        return () => {
          reactionCb.current = null
        }
      }}
      subscribeLog={(cb) => {
        logCb.current = cb
        return () => {
          logCb.current = null
        }
      }}
    />
  )
}
