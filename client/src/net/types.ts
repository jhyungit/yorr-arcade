import type { CategoryId, ScoreSheet } from '../game/yacht'

/**
 * 서버(server/index.js)가 브로드캐스트하는 방 상태의 타입.
 * 서버의 roomState() 가 보내는 모양과 1:1로 맞춰야 한다.
 */

export type RoomStatus = 'lobby' | 'playing' | 'finished'

export interface PlayerState {
  id: string // 좌석 id (p1~p6). 소켓 id 가 아니라 재접속해도 그대로다
  nickname: string
  connected: boolean
  sheet: ScoreSheet
  dice: number[] // 판에 놓인 주사위 5개 (서버가 굴린 결과)
  kept: boolean[] // 남기기로 고정한 주사위
  rollsLeft: number
  rolled: boolean // 이번 차례에 한 번이라도 굴렸는가
  total: number
}

export interface RoomState {
  code: string
  hostId: string
  status: RoomStatus
  round: number
  totalRounds: number
  maxPlayers: number
  turnId: string | null // 지금 차례인 좌석 id (대기실/종료면 null)
  turnSeq: number // 차례가 넘어갈 때마다 +1 → 판을 새로 깐다
  rollSeq: number // 굴릴 때마다 +1 → 굴리기 연출을 재생한다
  deadline: number | null // 이번 차례 마감 시각(epoch ms)
  turnMs: number // 진행 바 계산용 총 길이
  players: PlayerState[]
}

/** 순위 (서버 room:finished 에 실려 온다. 동점은 같은 등수) */
export interface RankRow {
  id: string
  nickname: string
  total: number
  rank: number
}

/** 누가 어디에 몇 점을 넣었는지 (진행 로그) */
export interface RoomLog {
  seq: number
  playerId: string
  nickname: string
  categoryId: CategoryId
  score: number
  auto: boolean // 시간 초과로 서버가 대신 기록했는가
  round: number
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

// 방 만들기/참가/재접속 요청의 응답(ack) 형태
export interface JoinAck {
  ok: boolean
  code?: string
  youId?: string // 내 좌석 id
  token?: string // 재접속용 비밀 토큰 (나에게만 온다)
  error?: string
}

export type { CategoryId }
