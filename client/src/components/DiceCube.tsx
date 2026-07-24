import { forwardRef, type CSSProperties } from 'react'

/**
 * DiceCube — 진짜 3D CSS 큐브 주사위 (정적 면만 렌더)
 * -------------------------------------------------------------
 * 6면 값 고정: front=1, back=6, right=2, left=5, top=3, bottom=4 (마주보는 합=7).
 * 어떤 눈이 "앞"으로 보이는지는 DiceTray 가 이 .cube 엘리먼트를 회전시켜 정한다.
 * → 그래서 여기선 value 를 받지 않는다(모든 면이 항상 존재).
 */

// 3x3 격자에서 눈금별 점 위치 (1~9)
const PIP_LAYOUT: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}

function Face({ value, cls }: { value: number; cls: string }) {
  const pips = PIP_LAYOUT[value] ?? []
  return (
    <div className={`cube-face ${cls}`}>
      {Array.from({ length: 9 }, (_, i) => {
        const cell = i + 1
        const on = pips.includes(cell)
        // "1" 눈은 빨간색
        return on ? (
          <span key={cell} className={`pip ${value === 1 ? 'one' : ''}`} style={pipCell(cell)} />
        ) : (
          <span key={cell} style={pipCell(cell)} />
        )
      })}
    </div>
  )
}

// 격자 셀(1~9)을 3x3 위치로
function pipCell(cell: number) {
  const row = Math.ceil(cell / 3)
  const col = ((cell - 1) % 3) + 1
  return { gridRow: row, gridColumn: col } as const
}

const DiceCube = forwardRef<HTMLDivElement, { className?: string; style?: CSSProperties }>(
  function DiceCube({ className = '', style }, ref) {
    return (
      <div ref={ref} className={`cube ${className}`} style={style}>

        <Face value={1} cls="f-front" />
        <Face value={6} cls="f-back" />
        <Face value={2} cls="f-right" />
        <Face value={5} cls="f-left" />
        <Face value={3} cls="f-top" />
        <Face value={4} cls="f-bottom" />
      </div>
    )
  },
)

export default DiceCube

// 각 눈을 "앞면"으로 보이게 하는 큐브 회전값 [rotateX, rotateY] (deg)
export const FACE_ROTATION: Record<number, [number, number]> = {
  1: [0, 0],
  6: [0, 180],
  2: [0, -90],
  5: [0, 90],
  3: [-90, 0],
  4: [90, 0],
}
