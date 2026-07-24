/**
 * verdict.ts — 개발자 유형 판정 (결정적, 랜덤 없음)
 * -------------------------------------------------------------
 * 입력: 벤 스택의 분야 분포 + 총점 + 함정 절단 수.
 * 규칙은 위→아래 우선순위로 "가장 먼저 맞는 것"을 채택한다.
 */
import type { Category } from './types'
import { CATEGORIES, STACK_BY_ID } from './stacks'

export interface Verdict {
  key: string
  title: string
  emoji: string
  color: string
  desc: string
}

/** "풀스택 각성" 을 부르는 총점 문턱 (튜닝값) */
export const FULLSTACK_SCORE = 2200
/** 함정을 이만큼 베면 "버그 유발자" */
export const BUG_MAKER_TRAPS = 5
/** 한 분야가 이 비율 이상이면 그 분야 스페셜리스트 */
export const DOMINANT_SHARE = 0.5

/** 벤 스택들을 분야별 개수로 집계 */
export function categoryCounts(collected: Record<string, number>): Record<Category, number> {
  const counts: Record<Category, number> = { FE: 0, BE: 0, Infra: 0, AI: 0 }
  for (const [id, n] of Object.entries(collected)) {
    const def = STACK_BY_ID[id]
    if (def) counts[def.category] += n
  }
  return counts
}

const SPECIALIST: Record<Category, Verdict> = {
  BE: { key: 'be', title: '백엔드 장인', emoji: '⚙️', color: '#f59e0b', desc: '서버는 내 손안에. 견고함의 미학.' },
  FE: { key: 'fe', title: '프론트엔드 스페셜리스트', emoji: '🎨', color: '#22d3ee', desc: '픽셀 하나까지, 사용자 경험의 장인.' },
  Infra: { key: 'infra', title: '데브옵스 마이스터', emoji: '🚀', color: '#38bdf8', desc: '배포는 예술이다. 컨테이너를 지휘하는 자.' },
  AI: { key: 'ai', title: 'AI 엔지니어', emoji: '🤖', color: '#a855f7', desc: '모델을 길들이는 사람. 미래를 학습시킨다.' },
}

export function decideVerdict(input: {
  collected: Record<string, number>
  score: number
  trapsSliced: number
}): Verdict {
  const { collected, score, trapsSliced } = input
  const counts = categoryCounts(collected)
  const total = counts.FE + counts.BE + counts.Infra + counts.AI

  // 1) 4개 분야 각각 1개 이상 + 총점 상위 → 풀스택 각성
  const allFour = CATEGORIES.every((c) => counts[c] >= 1)
  if (allFour && score >= FULLSTACK_SCORE) {
    return {
      key: 'fullstack',
      title: '풀스택 각성 개발자',
      emoji: '🏆',
      color: '#FFCB3D',
      desc: 'FE·BE·Infra·AI 를 모두 베어냈다. 경계를 넘나드는 자.',
    }
  }

  // 2) 함정 5개 이상 → 버그 유발자 (재미 요소)
  if (trapsSliced >= BUG_MAKER_TRAPS) {
    return {
      key: 'bugmaker',
      title: '버그 유발자',
      emoji: '🐛',
      color: '#84cc16',
      desc: `함정만 ${trapsSliced}개… 프로덕션은 오늘도 불탄다.`,
    }
  }

  // 3~6) 한 분야가 50% 이상 → 그 분야 스페셜리스트 (BE→FE→Infra→AI 우선순위)
  if (total > 0) {
    for (const c of ['BE', 'FE', 'Infra', 'AI'] as Category[]) {
      if (counts[c] / total >= DOMINANT_SHARE) return SPECIALIST[c]
    }
  }

  // 7) 그 외 → 성장하는 주니어
  return {
    key: 'junior',
    title: '성장하는 주니어',
    emoji: '🌱',
    color: '#4ade80',
    desc: '골고루 조금씩. 가능성은 무한하다 — 다시 도전!',
  }
}
