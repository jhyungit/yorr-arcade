/**
 * beatmap.ts — 리듬 탭의 "순수 로직" (음악 파일 없이 코드로 채보 생성)
 * -------------------------------------------------------------
 * 왜 코드로 만드나?
 *  - 프로젝트에 음원/채보 파일이 없다. 그래서 BPM 과 시드(seed)만 있으면
 *    "언제 어느 레인에 노트가 떨어질지"를 규칙적으로 계산해 낸다.
 *  - 시드가 같으면 항상 똑같은 채보가 나온다 → 온라인 대결에서 두 사람이
 *    "완전히 같은 곡"을 플레이할 수 있다(공정한 점수 대결).
 *  - 여기엔 그림/사운드가 전혀 없어서 눈 없이도(헤드리스) 테스트 가능하다.
 */

/** 레인(세로 줄) 개수 — 손가락 4개로 치기 좋게 4개 */
export const LANES = 4

/** 레인별 네온 색 (신스웨이브 팔레트: 시안·바이올렛·핑크·앰버) */
export const LANE_COLORS = ['#22d3ee', '#a855f7', '#ec4899', '#f59e0b'] as const

/** 키보드로도 칠 수 있게 (PC 테스트용): D · F · J · K */
export const LANE_KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'] as const

// ── 판정 창(윈도우). 노트의 "정확한 시각"과 내 탭 시각의 차이(ms)로 판정 ──
export const PERFECT_MS = 45 // |오차| ≤ 45ms → PERFECT
export const GOOD_MS = 110 //  |오차| ≤ 110ms → GOOD
export const MISS_MS = 160 //  정확 시각을 이만큼 지나도 안 치면 MISS 처리

/** 노트가 화면 맨 위에서 판정선까지 내려오는 데 걸리는 시간(ms). 클수록 여유롭다. */
export const LEAD_MS = 1500

/** 노트 하나 = "언제(time, ms)" "어느 레인(lane)"에 떨어지는가 */
export interface Note {
  id: number
  time: number // 곡 시작(0ms) 기준 판정 시각
  lane: number
  judged?: boolean // 이미 판정됨(맞춤 또는 놓침)
  hit?: boolean // 맞췄는가(판정 연출용)
}

export interface Beatmap {
  bpm: number
  beatMs: number // 한 박의 길이(ms)
  notes: Note[]
  durationMs: number // 곡 전체 길이(마지막 노트 이후 여유 포함)
  seed: number
}

/** 난이도 옵션 (컴포넌트에서 골라 넘긴다) */
export interface MapOptions {
  bpm: number
  beats: number // 총 박 수(곡 길이) — 4/4 기준 beats/4 마디
  density: number // 0~1, 엇박·더블노트가 얼마나 자주 나오나
}

/**
 * mulberry32 — 아주 작은 "시드 기반 난수 생성기".
 * 같은 seed 를 넣으면 항상 같은 난수 수열이 나온다(재현 가능).
 * (Math.random 은 매번 달라서 온라인에서 같은 곡을 못 만든다)
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 채보 생성.
 *  - 8분음표 격자(반 박마다)를 훑으며 노트를 놓을지 규칙+난수로 결정한다.
 *  - 인트로는 강박(매 박)만 → 서서히 엇박/더블노트가 늘어 후반이 빽빽해진다.
 *  - 같은 레인이 연속으로 나오지 않게 조정(치기 자연스럽게).
 */
export function generateBeatmap(seed: number, opts: MapOptions): Beatmap {
  const { bpm, beats, density } = opts
  const rng = mulberry32(seed)
  const beatMs = 60000 / bpm
  const stepMs = beatMs / 2 // 8분음표(반 박)
  const totalSteps = beats * 2

  const notes: Note[] = []
  let id = 0
  let prevLane = -1

  for (let i = 0; i < totalSteps; i++) {
    const t = i * stepMs
    const progress = i / totalSteps // 0(시작)→1(끝): 뒤로 갈수록 어렵게
    const onBeat = i % 2 === 0 // 정박(매 반 박 중 박 위치)
    const strong = i % 4 === 0 // 강박(매 박)
    const intro = i < 16 // 처음 8박은 살살

    let spawn: boolean
    if (intro) spawn = strong // 인트로: 강박에만
    else if (onBeat) spawn = true // 정박은 항상
    else spawn = rng() < (0.18 + progress * 0.5) * density // 엇박은 난이도·진행도에 비례

    if (!spawn) continue

    // 레인 고르기: 직전 레인과 겹치지 않게
    let lane = Math.floor(rng() * LANES)
    if (lane === prevLane) lane = (lane + 1 + Math.floor(rng() * (LANES - 1))) % LANES
    prevLane = lane
    notes.push({ id: id++, time: Math.round(t), lane })

    // 후반 강박에서 가끔 "더블 노트"(두 레인 동시) — 손맛 포인트
    if (!intro && strong && progress > 0.35 && rng() < (0.12 + progress * 0.28) * density) {
      let lane2 = Math.floor(rng() * LANES)
      if (lane2 === lane) lane2 = (lane2 + 1) % LANES
      notes.push({ id: id++, time: Math.round(t), lane: lane2 })
    }
  }

  const durationMs = beats * beatMs + 1500
  return { bpm, beatMs, notes, durationMs, seed }
}

/** 점수/정확도로 최종 등급 매기기 */
export function grade(accuracy: number): { letter: string; color: string } {
  if (accuracy >= 0.95) return { letter: 'S', color: '#22d3ee' }
  if (accuracy >= 0.9) return { letter: 'A', color: '#a3e635' }
  if (accuracy >= 0.8) return { letter: 'B', color: '#facc15' }
  if (accuracy >= 0.65) return { letter: 'C', color: '#fb923c' }
  return { letter: 'D', color: '#f87171' }
}
