/**
 * logos.ts — 기술 로고/함정/보너스를 캔버스에 "직접" 그린다 (외부 에셋 0)
 * -------------------------------------------------------------
 * 모든 글리프는 원점(0,0) 중심, 반경 r 원 안에 들어오도록 그린다.
 * 호출부(엔진 렌더)가 translate/rotate/clip 을 잡은 상태에서 부른다
 *  → 회전·슬라이스(반쪽 클립)에 그대로 재사용된다.
 * 브랜드색 + 알아볼 수 있는 실루엣이 목표(정밀한 로고 재현은 아님).
 */
import type { ObjectKind } from './types'
import { STACK_BY_ID, TRAP_BY_ID, BONUS_BY_ID } from './stacks'

/** 오브젝트의 대표색 (뒤 글로우 halo·스파크 파티클 색으로 재사용) */
export function objectColor(kind: ObjectKind, defId: string, goldenStackId?: string): string {
  if (kind === 'stack') return STACK_BY_ID[defId]?.color ?? '#94a3b8'
  if (kind === 'trap') return TRAP_BY_ID[defId]?.color ?? '#ef4444'
  if (defId === 'golden') return goldenStackId ? '#FFCB3D' : '#FFCB3D'
  return BONUS_BY_ID[defId]?.color ?? '#FFCB3D'
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rr: number) {
  const r = Math.min(rr, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
}

function centerText(ctx: CanvasRenderingContext2D, t: string, s: number, color: string, frac = 0.9) {
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `900 ${(s * frac * 2) / Math.max(1.1, t.length)}px system-ui, sans-serif`
  ctx.fillText(t, 0, s * 0.04)
}

// ── 스택 글리프들 (s = 그리기 반쪽 크기) ──────────────────────

function react(ctx: CanvasRenderingContext2D, s: number, c: string) {
  ctx.strokeStyle = c
  ctx.lineWidth = s * 0.12
  for (let k = 0; k < 3; k++) {
    ctx.save()
    ctx.rotate((k * Math.PI) / 3)
    ctx.beginPath()
    ctx.ellipse(0, 0, s * 0.98, s * 0.4, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2)
  ctx.fill()
}

function vue(ctx: CanvasRenderingContext2D, s: number) {
  const h = s * 0.86
  ctx.fillStyle = '#42B883'
  poly(ctx, [[-s, -h], [s, -h], [0, h]])
  ctx.fill()
  ctx.fillStyle = '#35495E'
  poly(ctx, [[-s * 0.6, -h], [s * 0.6, -h], [0, h * 0.28]])
  ctx.fill()
}

function tsLike(ctx: CanvasRenderingContext2D, s: number, c: string, label: string) {
  ctx.fillStyle = c
  roundRect(ctx, -s, -s, s * 2, s * 2, s * 0.28)
  ctx.fill()
  centerText(ctx, label, s, '#ffffff', 1.05)
}

function vite(ctx: CanvasRenderingContext2D, s: number) {
  // 번개 볼트 (보라 외곽 + 노란 코어)
  const bolt: [number, number][] = [
    [0.08, -1], [0.62, -1], [0.16, -0.12], [0.52, -0.12], [-0.2, 1], [-0.02, 0.05], [-0.42, 0.05],
  ]
  const scaled = (m: number): [number, number][] => bolt.map(([x, y]) => [x * s * m, y * s * m])
  ctx.fillStyle = '#BD34FE'
  poly(ctx, scaled(1))
  ctx.fill()
  ctx.fillStyle = '#FFC717'
  poly(ctx, scaled(0.62))
  ctx.fill()
}

function leaf(ctx: CanvasRenderingContext2D, s: number, c: string) {
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.moveTo(s * 0.05, -s)
  ctx.quadraticCurveTo(s * 1.05, -s * 0.1, s * 0.02, s * 0.95)
  ctx.quadraticCurveTo(-s * 0.85, s * 0.1, s * 0.05, -s)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = s * 0.09
  ctx.beginPath()
  ctx.moveTo(s * 0.05, -s * 0.75)
  ctx.quadraticCurveTo(-s * 0.15, s * 0.1, s * 0.02, s * 0.8)
  ctx.stroke()
}

function springboot(ctx: CanvasRenderingContext2D, s: number, c: string) {
  leaf(ctx, s * 0.72, c)
  // 부트 링 (끊긴 원)
  ctx.strokeStyle = c
  ctx.lineWidth = s * 0.14
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.95, Math.PI * 0.15, Math.PI * 1.75)
  ctx.stroke()
}

function javaCup(ctx: CanvasRenderingContext2D, s: number, c: string) {
  // 김 나는 커피잔
  ctx.strokeStyle = c
  ctx.lineWidth = s * 0.13
  ctx.lineCap = 'round'
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath()
    ctx.moveTo(i * s * 0.35, -s * 0.95)
    ctx.quadraticCurveTo(i * s * 0.35 + s * 0.22, -s * 0.6, i * s * 0.35, -s * 0.3)
    ctx.stroke()
  }
  ctx.fillStyle = c
  roundRect(ctx, -s * 0.72, -s * 0.1, s * 1.3, s * 0.85, s * 0.16)
  ctx.fill()
  // 손잡이
  ctx.strokeStyle = c
  ctx.lineWidth = s * 0.13
  ctx.beginPath()
  ctx.arc(s * 0.62, s * 0.3, s * 0.28, -Math.PI * 0.5, Math.PI * 0.5)
  ctx.stroke()
}

function shade(c: string, f: number) {
  // #RRGGBB 를 f(<1 어둡게 / >1 밝게)로 명암 조절
  const n = parseInt(c.slice(1), 16)
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const r = cl(((n >> 16) & 255) * f)
  const g = cl(((n >> 8) & 255) * f)
  const b = cl((n & 255) * f)
  return `rgb(${r},${g},${b})`
}

function cube(ctx: CanvasRenderingContext2D, s: number, c: string) {
  // 레디스: 살짝 3D 큐브 (윗면 밝음 → 오른쪽 면 어둡게)
  ctx.fillStyle = shade(c, 1.25) // top
  poly(ctx, [[0, -s], [s, -s * 0.45], [0, s * 0.1], [-s, -s * 0.45]])
  ctx.fill()
  ctx.fillStyle = c // left
  poly(ctx, [[-s, -s * 0.45], [0, s * 0.1], [0, s], [-s, s * 0.45]])
  ctx.fill()
  ctx.fillStyle = shade(c, 0.7) // right
  poly(ctx, [[s, -s * 0.45], [0, s * 0.1], [0, s], [s, s * 0.45]])
  ctx.fill()
}

function docker(ctx: CanvasRenderingContext2D, s: number, c: string) {
  // 고래 몸통 + 컨테이너 블록
  ctx.fillStyle = c
  roundRect(ctx, -s * 0.95, s * 0.15, s * 1.9, s * 0.5, s * 0.18) // body
  ctx.fill()
  // 스파우트
  ctx.strokeStyle = c
  ctx.lineWidth = s * 0.12
  ctx.beginPath()
  ctx.arc(-s * 0.95, s * 0.18, s * 0.16, Math.PI, Math.PI * 1.5)
  ctx.stroke()
  const bw = s * 0.34
  const gap = s * 0.06
  const drawBlock = (cx: number, cy: number) => {
    ctx.fillStyle = c
    roundRect(ctx, cx - bw / 2, cy - bw / 2, bw, bw, s * 0.05)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    roundRect(ctx, cx - bw / 2, cy - bw / 2, bw, bw * 0.4, s * 0.04)
    ctx.fill()
  }
  for (let i = 0; i < 3; i++) drawBlock(-s * 0.4 + i * (bw + gap), -s * 0.28)
  drawBlock(-s * 0.4 + (bw + gap), -s * 0.28 - (bw + gap))
}

function hexLetter(ctx: CanvasRenderingContext2D, s: number, c: string, label: string) {
  ctx.fillStyle = c
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    const x = Math.cos(a) * s
    const y = Math.sin(a) * s
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
  centerText(ctx, label, s, '#ffffff', 1.0)
}

function gitlab(ctx: CanvasRenderingContext2D, s: number) {
  // 여우(탄색) — 삼각형 팬으로 근사
  const tris: [string, [number, number][]][] = [
    ['#E24329', [[0, s], [-s * 0.32, -s * 0.05], [s * 0.32, -s * 0.05]]], // center down
    ['#FC6D26', [[0, s], [-s * 0.32, -s * 0.05], [-s, -s * 0.05]]], // left
    ['#FC6D26', [[0, s], [s * 0.32, -s * 0.05], [s, -s * 0.05]]], // right
    ['#FCA326', [[-s, -s * 0.05], [-s * 0.62, -s], [-s * 0.32, -s * 0.05]]], // left ear
    ['#FCA326', [[s, -s * 0.05], [s * 0.62, -s], [s * 0.32, -s * 0.05]]], // right ear
  ]
  for (const [col, pts] of tris) {
    ctx.fillStyle = col
    poly(ctx, pts)
    ctx.fill()
  }
}

function fastapi(ctx: CanvasRenderingContext2D, s: number, c: string) {
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.arc(0, 0, s, 0, Math.PI * 2)
  ctx.fill()
  // 흰 번개
  const bolt: [number, number][] = [
    [0.12, -0.62], [-0.34, 0.08], [0.02, 0.08], [-0.12, 0.62], [0.36, -0.1], [-0.02, -0.1],
  ]
  ctx.fillStyle = '#ffffff'
  poly(ctx, bolt.map(([x, y]) => [x * s, y * s]))
  ctx.fill()
}

function pytorch(ctx: CanvasRenderingContext2D, s: number, c: string) {
  // 불꽃 + 상단 점
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.55)
  ctx.bezierCurveTo(s * 0.9, s * 0.05, s * 0.55, s, 0, s)
  ctx.bezierCurveTo(-s * 0.55, s, -s * 0.9, s * 0.05, 0, -s * 0.55)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(s * 0.28, -s * 0.72, s * 0.15, 0, Math.PI * 2)
  ctx.fill()
}

function langchain(ctx: CanvasRenderingContext2D, s: number, c: string) {
  // 사슬 링크 두 개
  ctx.strokeStyle = c
  ctx.lineWidth = s * 0.2
  ctx.save()
  ctx.rotate(-Math.PI / 4)
  roundRect(ctx, -s * 0.85, -s * 0.4, s * 1.0, s * 0.8, s * 0.4)
  ctx.stroke()
  roundRect(ctx, -s * 0.15, -s * 0.4, s * 1.0, s * 0.8, s * 0.4)
  ctx.stroke()
  ctx.restore()
}

function drawStackGlyph(ctx: CanvasRenderingContext2D, id: string, s: number) {
  const c = STACK_BY_ID[id]?.color ?? '#94a3b8'
  switch (id) {
    case 'react': return react(ctx, s, c)
    case 'vue': return vue(ctx, s)
    case 'typescript': return tsLike(ctx, s, c, 'TS')
    case 'vite': return vite(ctx, s)
    case 'spring': return leaf(ctx, s, c)
    case 'springboot': return springboot(ctx, s, c)
    case 'java': return javaCup(ctx, s, c)
    case 'redis': return cube(ctx, s, c)
    case 'docker': return docker(ctx, s, c)
    case 'nginx': return hexLetter(ctx, s, c, 'N')
    case 'gitlab': return gitlab(ctx, s)
    case 'fastapi': return fastapi(ctx, s, c)
    case 'pytorch': return pytorch(ctx, s, c)
    case 'langchain': return langchain(ctx, s, c)
    default: return tsLike(ctx, s, c, STACK_BY_ID[id]?.mono ?? '?')
  }
}

// ── 함정 ────────────────────────────────────────────────────
function bug(ctx: CanvasRenderingContext2D, s: number) {
  ctx.strokeStyle = '#7f1d1d'
  ctx.lineWidth = s * 0.1
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const y = -s * 0.35 + i * s * 0.45
    ctx.beginPath()
    ctx.moveTo(-s * 0.5, y)
    ctx.lineTo(-s * 0.95, y - s * 0.18)
    ctx.moveTo(s * 0.5, y)
    ctx.lineTo(s * 0.95, y - s * 0.18)
    ctx.stroke()
  }
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.ellipse(0, s * 0.05, s * 0.6, s * 0.85, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#7f1d1d'
  ctx.beginPath()
  ctx.arc(0, -s * 0.7, s * 0.32, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = s * 0.08
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.3)
  ctx.lineTo(0, s * 0.85)
  ctx.stroke()
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.arc(-s * 0.28, s * 0.1, s * 0.12, 0, Math.PI * 2)
  ctx.arc(s * 0.28, s * 0.35, s * 0.1, 0, Math.PI * 2)
  ctx.fill()
}

function bomb(ctx: CanvasRenderingContext2D, s: number) {
  ctx.fillStyle = '#334155'
  ctx.beginPath()
  ctx.arc(0, s * 0.15, s * 0.78, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.beginPath()
  ctx.arc(-s * 0.28, -s * 0.12, s * 0.22, 0, Math.PI * 2)
  ctx.fill()
  // 심지
  ctx.strokeStyle = '#a16207'
  ctx.lineWidth = s * 0.1
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(s * 0.35, -s * 0.5)
  ctx.quadraticCurveTo(s * 0.75, -s * 0.75, s * 0.6, -s * 1.0)
  ctx.stroke()
  // 불꽃
  ctx.fillStyle = '#f59e0b'
  ctx.beginPath()
  ctx.arc(s * 0.6, -s * 1.05, s * 0.16, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fde047'
  ctx.beginPath()
  ctx.arc(s * 0.6, -s * 1.05, s * 0.08, 0, Math.PI * 2)
  ctx.fill()
}

function burnout(ctx: CanvasRenderingContext2D, s: number) {
  // 초승달 + Zzz (야근·번아웃)
  ctx.fillStyle = '#8b5cf6'
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2e1065'
  ctx.beginPath()
  ctx.arc(s * 0.3, -s * 0.1, s * 0.7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ddd6fe'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `900 ${s * 0.5}px system-ui, sans-serif`
  ctx.fillText('z', -s * 0.35, -s * 0.15)
  ctx.font = `900 ${s * 0.34}px system-ui, sans-serif`
  ctx.fillText('z', -s * 0.62, -s * 0.5)
}

function drawTrapGlyph(ctx: CanvasRenderingContext2D, id: string, s: number) {
  switch (id) {
    case 'bug': return bug(ctx, s)
    case 'bomb': return bomb(ctx, s)
    case 'burnout': return burnout(ctx, s)
  }
}

// ── 보너스 ──────────────────────────────────────────────────
function goldenCoin(ctx: CanvasRenderingContext2D, s: number, stackId?: string) {
  const grad = ctx.createLinearGradient(-s, -s, s, s)
  grad.addColorStop(0, '#FFE79A')
  grad.addColorStop(0.5, '#FFCB3D')
  grad.addColorStop(1, '#E5A100')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(0, 0, s, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = s * 0.08
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.82, 0, Math.PI * 2)
  ctx.stroke()
  const mono = stackId ? (STACK_BY_ID[stackId]?.mono ?? '★') : '★'
  centerText(ctx, mono, s, '#7c4a03', 1.0)
}

function coffee(ctx: CanvasRenderingContext2D, s: number) {
  // 김 나는 머그 (피버). 접시로 java 잔과 구분.
  ctx.strokeStyle = '#e2b48f'
  ctx.lineWidth = s * 0.12
  ctx.lineCap = 'round'
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath()
    ctx.moveTo(i * s * 0.32, -s * 0.9)
    ctx.quadraticCurveTo(i * s * 0.32 + s * 0.2, -s * 0.58, i * s * 0.32, -s * 0.28)
    ctx.stroke()
  }
  ctx.fillStyle = '#6f4a2f'
  roundRect(ctx, -s * 0.66, -s * 0.15, s * 1.2, s * 0.9, s * 0.14)
  ctx.fill()
  ctx.fillStyle = '#C58C5A'
  ctx.beginPath()
  ctx.ellipse(0, -s * 0.12, s * 0.6, s * 0.16, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#6f4a2f'
  ctx.lineWidth = s * 0.13
  ctx.beginPath()
  ctx.arc(s * 0.58, s * 0.3, s * 0.26, -Math.PI * 0.5, Math.PI * 0.5)
  ctx.stroke()
  // 접시
  ctx.fillStyle = '#8a5a38'
  roundRect(ctx, -s * 0.85, s * 0.78, s * 1.7, s * 0.2, s * 0.1)
  ctx.fill()
}

function drawBonusGlyph(ctx: CanvasRenderingContext2D, id: string, s: number, goldenStackId?: string) {
  if (id === 'golden') return goldenCoin(ctx, s, goldenStackId)
  return coffee(ctx, s)
}

/**
 * 오브젝트 글리프 하나를 원점 기준으로 그린다.
 * 호출부에서 translate/rotate(/clip) 을 이미 잡아둔 상태여야 한다.
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: ObjectKind,
  defId: string,
  r: number,
  goldenStackId?: string,
) {
  const s = r * 0.82
  ctx.save()
  ctx.lineJoin = 'round'
  if (kind === 'stack') drawStackGlyph(ctx, defId, s)
  else if (kind === 'trap') drawTrapGlyph(ctx, defId, s)
  else drawBonusGlyph(ctx, defId, s, goldenStackId)
  ctx.restore()
}
