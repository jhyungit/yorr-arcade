/**
 * stacks.ts — 무엇을 베는가 (YORR 실제 기술 스택 기반)
 * -------------------------------------------------------------
 * 각 스택에 분야(category)·브랜드색(color)·모노그램(mono)을 태깅.
 * 그림(캔버스 글리프)은 logos.ts 가 id 로 그린다. 여기엔 순수 데이터만.
 */
import type { Category, TrapId, BonusId } from './types'

export interface StackDef {
  id: string
  name: string
  category: Category
  color: string // 브랜드색 (글리프 + 결과 뱃지)
  mono: string // 결과 뱃지에 쓰는 짧은 모노그램
}

/** 4대 분야 (판정·결과 그리드 순서) */
export const CATEGORIES: Category[] = ['FE', 'BE', 'Infra', 'AI']

/** 14 스택 — FE / BE / Infra / AI */
export const STACKS: StackDef[] = [
  // FE
  { id: 'react', name: 'React', category: 'FE', color: '#61DAFB', mono: 'R' },
  { id: 'vue', name: 'Vue', category: 'FE', color: '#42B883', mono: 'V' },
  { id: 'typescript', name: 'TypeScript', category: 'FE', color: '#3178C6', mono: 'TS' },
  { id: 'vite', name: 'Vite', category: 'FE', color: '#BD34FE', mono: 'Vi' },
  // BE
  { id: 'spring', name: 'Spring', category: 'BE', color: '#6DB33F', mono: 'S' },
  { id: 'springboot', name: 'Spring Boot', category: 'BE', color: '#8CC84B', mono: 'SB' },
  { id: 'java', name: 'Java', category: 'BE', color: '#E76F00', mono: 'J' },
  { id: 'redis', name: 'Redis', category: 'BE', color: '#DC382D', mono: 'Re' },
  // Infra
  { id: 'docker', name: 'Docker', category: 'Infra', color: '#2496ED', mono: 'D' },
  { id: 'nginx', name: 'Nginx', category: 'Infra', color: '#009639', mono: 'N' },
  { id: 'gitlab', name: 'GitLab', category: 'Infra', color: '#FC6D26', mono: 'GL' },
  // AI
  { id: 'fastapi', name: 'FastAPI', category: 'AI', color: '#05998B', mono: 'F' },
  { id: 'pytorch', name: 'PyTorch', category: 'AI', color: '#EE4C2C', mono: 'P' },
  { id: 'langchain', name: 'LangChain', category: 'AI', color: '#1FA97D', mono: 'LC' },
]

export const STACK_BY_ID: Record<string, StackDef> = Object.fromEntries(
  STACKS.map((s) => [s.id, s]),
)

export const STACKS_BY_CATEGORY: Record<Category, StackDef[]> = {
  FE: STACKS.filter((s) => s.category === 'FE'),
  BE: STACKS.filter((s) => s.category === 'BE'),
  Infra: STACKS.filter((s) => s.category === 'Infra'),
  AI: STACKS.filter((s) => s.category === 'AI'),
}

// ── 함정 3종: 베면 감점 + 콤보 리셋 ──
export interface TrapDef {
  id: TrapId
  name: string
  color: string
}
export const TRAPS: TrapDef[] = [
  { id: 'bug', name: '버그', color: '#ef4444' },
  { id: 'bomb', name: '장애', color: '#94a3b8' },
  { id: 'burnout', name: '야근', color: '#8b5cf6' },
]
export const TRAP_BY_ID: Record<string, TrapDef> = Object.fromEntries(
  TRAPS.map((t) => [t.id, t]),
)

// ── 보너스 2종 ──
export interface BonusDef {
  id: BonusId
  name: string
  color: string
}
export const BONUSES: BonusDef[] = [
  { id: 'golden', name: '황금 스택', color: '#FFCB3D' }, // 무작위 스택의 금빛 버전 → ×3
  { id: 'coffee', name: '커피', color: '#C58C5A' }, // 피버 타임 발동
]
export const BONUS_BY_ID: Record<string, BonusDef> = Object.fromEntries(
  BONUSES.map((b) => [b.id, b]),
)
