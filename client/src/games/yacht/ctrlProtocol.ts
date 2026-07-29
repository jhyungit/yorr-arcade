import type { CategoryId } from '../../game/yacht'

/**
 * ctrlProtocol — 요트 폰 컨트롤러 규약 (노트북 ↔ 폰)
 * -------------------------------------------------------------
 * 다른 게임(탁구·퀵드로우)은 폰이 "휘둘렀다" 하나만 보내면 됐다. 요트는
 * 킵·점수 선택이 게임의 본체라, 폰만으로 한 턴을 끝낼 수 있어야 한다.
 * 그런데 폰 컨트롤러는 페어링 방(pair:)에 있어서 게임 방(room:)의 상태를
 * 전혀 모른다 → 노트북이 "지금 화면에 뭐가 있는지"를 폰에 보내 준다.
 *
 *   노트북 ──YACHT_VIEW(주사위·킵·점수판·차례)──▶ 폰   (폰이 UI 를 그린다)
 *   노트북 ◀──KEEP / SELECT / SCORE / REACT────── 폰   (조작)
 *
 * 조작은 폰이 직접 처리하지 않고 노트북에 "요청"만 한다. 노트북이 기존
 * 경로(멀티면 서버, 솔로면 로컬)로 반영하므로 규칙 판정이 한 곳에 남는다.
 * → 노트북 화면과 폰이 저절로 같은 상태가 된다.
 */

/* 이벤트 이름. 서버는 pair: 방으로 그대로 중계만 한다(내용을 모른다). */
export const YACHT_VIEW = 'disp:yacht' // 노트북 → 폰 (화면 상태)
export const YACHT_KEEP = 'ctrl:keep' // 폰 → 노트북 (주사위 고정/해제)
export const YACHT_SELECT = 'ctrl:select' // 폰 → 노트북 (점수 칸 고르기)
export const YACHT_SCORE = 'ctrl:score' // 폰 → 노트북 (고른 칸으로 확정)
export const YACHT_REACT = 'ctrl:react' // 폰 → 노트북 (리액션)

/** 점수판 한 칸 */
export interface YachtCell {
  id: CategoryId
  label: string
  /** 이미 기록된 점수 (null 이면 빈 칸) */
  score: number | null
  /** 지금 주사위로 기록하면 받을 점수 (고를 수 없는 상황이면 null) */
  preview: number | null
}

/**
 * 노트북이 폰에 보내는 화면 상태.
 * 폰은 이걸 그대로 그리기만 한다(자체 판단 없음) → 두 화면이 어긋나지 않는다.
 */
export interface YachtView {
  /** 지금 차례인 사람 이름 (솔로면 빈 문자열) */
  turn: string
  /** 내(이 컨트롤러를 든 사람) 차례인가 — false 면 폰도 조작을 잠근다 */
  mine: boolean
  round: number
  totalRounds: number
  dice: number[]
  kept: boolean[]
  rollsLeft: number
  /** 이번 차례에 한 번은 굴렸는가 (굴려야 킵·기록이 열린다) */
  rolled: boolean
  /** 구르는 중 — 조작 잠금 */
  tumbling: boolean
  /** 지금 고른 칸 (확정 전) */
  selected: CategoryId | null
  /** 내 총점 */
  total: number
  cells: YachtCell[]
  /** 이번 차례 마감 시각(epoch ms). 없으면 타이머 없음 */
  deadline: number | null
  /** 리액션을 보낼 수 있는가 (멀티만) */
  canReact: boolean
}
