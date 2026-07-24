/**
 * yacht.ts
 * -------------------------------------------------------------
 * 요트(Yacht) 주사위 게임의 "규칙"만 담은 순수 로직 파일.
 * (화면/센서와 무관 → 나중에 서버에서 재사용하거나 테스트하기 쉬움)
 *
 * 한국에서 흔히 하는 "요트 게임" 기준:
 *  - 주사위 5개
 *  - 총 12개 족보(카테고리)를 한 번씩 채우면 게임 종료
 *  - 윗줄(1~6) 합이 63점 이상이면 보너스 +35점
 */

// 점수판의 각 칸(족보) 종류
export type CategoryId =
  | 'ones'
  | 'twos'
  | 'threes'
  | 'fours'
  | 'fives'
  | 'sixes'
  | 'choice' // 초이스: 눈 상관없이 5개 합
  | 'fourKind' // 포카드: 같은 눈 4개 이상 → 5개 합
  | 'fullHouse' // 풀하우스: 3개 + 2개 → 5개 합
  | 'smallStraight' // 스몰 스트레이트: 4연속 → 15점
  | 'largeStraight' // 라지 스트레이트: 5연속 → 30점
  | 'yacht' // 요트: 5개 모두 같음 → 50점

export interface Category {
  id: CategoryId
  label: string // 화면에 보일 한글 이름
  section: 'upper' | 'lower' // 윗줄(1~6) / 아랫줄
  hint: string // 설명
}

// 점수판에 표시할 순서대로 정의
// 팀원 UI 시안의 명칭을 따름 (에이스/듀스/트레이/포/파이브/식스 …)
export const CATEGORIES: Category[] = [
  { id: 'ones', label: '에이스', section: 'upper', hint: '1의 합' },
  { id: 'twos', label: '듀스', section: 'upper', hint: '2의 합' },
  { id: 'threes', label: '트레이', section: 'upper', hint: '3의 합' },
  { id: 'fours', label: '포', section: 'upper', hint: '4의 합' },
  { id: 'fives', label: '파이브', section: 'upper', hint: '5의 합' },
  { id: 'sixes', label: '식스', section: 'upper', hint: '6의 합' },
  { id: 'choice', label: '초이스', section: 'lower', hint: '모든 주사위의 합' },
  { id: 'fourKind', label: '포커', section: 'lower', hint: '같은 눈 4개 이상' },
  { id: 'fullHouse', label: '풀하우스', section: 'lower', hint: '같은 눈 3개와 2개' },
  { id: 'smallStraight', label: '스몰 스트레이트', section: 'lower', hint: '연속된 눈 4개 (15점)' },
  { id: 'largeStraight', label: '라지 스트레이트', section: 'lower', hint: '연속된 눈 5개 (30점)' },
  { id: 'yacht', label: '요트', section: 'lower', hint: '5개 모두 같음 (50점)' },
]

// 윗줄 보너스 기준/점수
export const UPPER_BONUS_THRESHOLD = 63
export const UPPER_BONUS_POINTS = 35

/** 눈금별 개수를 센다. counts[n] = 값이 n(1~6)인 주사위 개수 */
function countByValue(values: number[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0] // 인덱스 0은 안 씀
  for (const v of values) counts[v]++
  return counts
}

/** 특정 족보에 대해, 주어진 주사위 눈들로 받을 점수를 계산 */
export function scoreFor(id: CategoryId, values: number[]): number {
  const counts = countByValue(values)
  const sum = values.reduce((a, b) => a + b, 0)

  switch (id) {
    // 윗줄: 해당 숫자의 합 (예: fours = 4 × (4가 나온 개수))
    case 'ones':
      return 1 * counts[1]
    case 'twos':
      return 2 * counts[2]
    case 'threes':
      return 3 * counts[3]
    case 'fours':
      return 4 * counts[4]
    case 'fives':
      return 5 * counts[5]
    case 'sixes':
      return 6 * counts[6]

    // 초이스: 무조건 5개 합
    case 'choice':
      return sum

    // 포카드: 같은 눈이 4개 이상이면 5개 합, 아니면 0
    case 'fourKind':
      return counts.some((c) => c >= 4) ? sum : 0

    // 풀하우스: 3개 + 2개 조합이면 5개 합, 아니면 0
    case 'fullHouse': {
      const hasThree = counts.some((c) => c === 3)
      const hasTwo = counts.some((c) => c === 2)
      return hasThree && hasTwo ? sum : 0
    }

    // 스몰 스트레이트: 1234 / 2345 / 3456 중 하나라도 있으면 15점
    case 'smallStraight': {
      const has = (arr: number[]) => arr.every((n) => counts[n] > 0)
      return has([1, 2, 3, 4]) || has([2, 3, 4, 5]) || has([3, 4, 5, 6]) ? 15 : 0
    }

    // 라지 스트레이트: 12345 / 23456 면 30점
    case 'largeStraight': {
      const has = (arr: number[]) => arr.every((n) => counts[n] > 0)
      return has([1, 2, 3, 4, 5]) || has([2, 3, 4, 5, 6]) ? 30 : 0
    }

    // 요트: 5개 모두 같으면 50점
    case 'yacht':
      return counts.some((c) => c === 5) ? 50 : 0
  }
}

// 점수판: 각 칸은 "아직 안 채움(null)" 또는 확정 점수(number)
export type ScoreSheet = Record<CategoryId, number | null>

/** 새 게임용 빈 점수판 */
export function emptyScoreSheet(): ScoreSheet {
  const sheet = {} as ScoreSheet
  for (const c of CATEGORIES) sheet[c.id] = null
  return sheet
}

/** 윗줄(1~6) 합계 */
export function upperSum(sheet: ScoreSheet): number {
  const upperIds: CategoryId[] = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']
  return upperIds.reduce((sum, id) => sum + (sheet[id] ?? 0), 0)
}

/** 윗줄 보너스 (63점 이상이면 35점) */
export function upperBonus(sheet: ScoreSheet): number {
  return upperSum(sheet) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_POINTS : 0
}

/** 총점 = 모든 칸 합 + 보너스 */
export function totalScore(sheet: ScoreSheet): number {
  const base = CATEGORIES.reduce((sum, c) => sum + (sheet[c.id] ?? 0), 0)
  return base + upperBonus(sheet)
}

/** 12칸을 모두 채웠는지 (게임 종료 여부) */
export function isGameOver(sheet: ScoreSheet): boolean {
  return CATEGORIES.every((c) => sheet[c.id] !== null)
}
