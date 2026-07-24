import type { CategoryId, ScoreSheet } from '../game/yacht'

/**
 * 서버(server/index.js)가 브로드캐스트하는 방 상태의 타입.
 * 서버의 roomState() 가 보내는 모양과 1:1로 맞춰야 한다.
 */

export type RoomStatus = 'lobby' | 'playing' | 'finished'

export interface PlayerState {
  id: string
  nickname: string
  connected: boolean
  sheet: ScoreSheet
  dice: number[] // 현재 보이는 주사위 5개
  rollsLeft: number
  rolledThisRound: boolean
  done: boolean // 이번 라운드 점수 확정 여부
  total: number
}

export interface RoomState {
  code: string
  hostId: string
  status: RoomStatus
  round: number
  totalRounds: number
  players: PlayerState[]
  deadline: number | null // 이번 라운드 마감 시각(epoch ms). 타이머는 이 값 - now 로 계산
}

// 리액션 (like/laugh/shock/clap/gg)
export type ReactionType = 'like' | 'laugh' | 'shock' | 'clap' | 'gg'
export const REACTION_EMOJI: Record<ReactionType, string> = {
  like: '👍',
  laugh: '😂',
  shock: '😮',
  clap: '👏',
  gg: '🎉',
}

// 서버에서 브로드캐스트된 리액션 (화면에 떠오르게)
export interface IncomingReaction {
  id: string // 화면 표시용 고유 키
  playerId: string
  type: ReactionType
}

// 방 만들기/참가 요청의 응답(ack) 형태
export interface JoinAck {
  ok: boolean
  code?: string
  youId?: string
  error?: string
}

export type { CategoryId }
