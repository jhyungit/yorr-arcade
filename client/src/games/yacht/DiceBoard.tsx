import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createScene, type DiceScene } from './dice3d'
import { feedbackDiceHit, feedbackDiceLand } from '../../lib/feedback'

/**
 * DiceBoard — 3D 보드를 React 에 붙이는 얇은 껍데기
 * -------------------------------------------------------------
 * 렌더 루프·물리는 전부 dice3d.ts 안에서 돌고, 여기서는
 *  (1) 캔버스 크기 맞추기 (2) rollKey/kept 변화를 씬에 전달 (3) 탭 → 고정
 * 세 가지만 한다. 게임 상태는 부모가 갖는다.
 *
 * onSettle(shown) 을 부모에게 되돌려 주는 이유: 씬이 "회전이 가장 적은 눈"을
 * 주사위마다 다시 배정하므로(dice3d.ts 참고), 어느 자리에 어느 눈이 놓였는지는
 * 굴러 멈춘 뒤에야 확정된다. 눈의 집합은 그대로라 점수에는 영향이 없다.
 */

interface DiceBoardProps {
  values: number[]
  kept: boolean[]
  rollKey: number // 굴릴 때마다 +1
  reducedMotion: boolean
  disabled: boolean // 구르는 중/기록 완료 — 탭 잠금
  onToggleKeep: (index: number) => void
  onSettle: (shown: number[]) => void
}

export default function DiceBoard({
  values,
  kept,
  rollKey,
  reducedMotion,
  disabled,
  onToggleKeep,
  onSettle,
}: DiceBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<DiceScene | null>(null)
  const [glFailed, setGlFailed] = useState(false)

  // 최신 값을 콜백/이펙트에서 읽기 위한 거울 (씬을 다시 만들지 않으려고)
  const valuesRef = useRef(values)
  const keptRef = useRef(kept)
  const disabledRef = useRef(disabled)
  const onSettleRef = useRef(onSettle)
  const onKeepRef = useRef(onToggleKeep)
  valuesRef.current = values
  keptRef.current = kept
  disabledRef.current = disabled
  onSettleRef.current = onSettle
  onKeepRef.current = onToggleKeep

  // 씬은 마운트 때 한 번만 만든다
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    let lastHit = 0
    let scene: DiceScene
    try {
      scene = createScene(canvas, {
        onSettle: (shown) => {
          feedbackDiceLand()
          onSettleRef.current(shown)
        },
        onImpact: (s) => {
          // 한 프레임에 여러 번 부딪혀도 소리는 솎아낸다 (안 그러면 지직거린다)
          const now = performance.now()
          if (now - lastHit < 45) return
          lastHit = now
          feedbackDiceHit(s)
        },
      })
    } catch (err) {
      // WebGL 을 못 쓰는 환경 — 게임을 죽이지 말고 숫자 주사위로 떨어뜨린다
      console.error('[yacht] WebGL 초기화 실패', err)
      setGlFailed(true)
      return
    }
    sceneRef.current = scene
    scene.place(valuesRef.current, keptRef.current)

    const fit = () => {
      const r = wrap.getBoundingClientRect()
      scene.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)

    let raf = 0
    let prev = performance.now()
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      const dt = t - prev
      prev = t
      scene.frame(dt)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  // rollKey: 0 = 새 라운드(판을 다시 깐다), 그 외 = 굴린다
  const lastRoll = useRef(rollKey)
  useEffect(() => {
    if (rollKey === lastRoll.current) return
    lastRoll.current = rollKey
    const scene = sceneRef.current
    if (!scene) {
      // 3D 를 못 쓰는 기기 — 굴러 멈춤을 알려 줄 씬이 없으니 여기서 바로 끝낸다
      if (rollKey !== 0) onSettleRef.current(values)
      return
    }
    if (rollKey === 0) {
      scene.place(values, kept)
    } else if (reducedMotion) {
      scene.place(values, kept)
      onSettleRef.current(values)
    } else {
      scene.roll(values, kept)
    }
    // values/kept 는 rollKey 와 함께 갱신되므로 의존성은 rollKey 하나로 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey])

  // 고정/해제 — 굴리는 중이 아닐 때의 kept 변화만 씬에 전달
  const keptSig = kept.map((k) => (k ? 1 : 0)).join('')
  const lastKept = useRef(keptSig)
  useEffect(() => {
    if (keptSig === lastKept.current) return
    lastKept.current = keptSig
    sceneRef.current?.setKept(kept)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptSig])

  const onDown = (e: ReactPointerEvent) => {
    if (disabledRef.current) return
    const i = sceneRef.current?.pick(e.clientX, e.clientY) ?? -1
    if (i >= 0) onKeepRef.current(i)
  }

  return (
    <div ref={wrapRef} className="yd-board" onPointerDown={onDown}>
      <canvas ref={canvasRef} className="block w-full h-full" />
      {glFailed && (
        // 3D 를 못 쓰는 기기 — 숫자 주사위로라도 계속 플레이할 수 있게
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <div className="flex gap-2">
            {values.map((v, i) => (
              <button
                key={i}
                onClick={() => !disabled && onToggleKeep(i)}
                className="yd-flat-die"
                data-kept={kept[i] ? 'on' : 'off'}
              >
                {v}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-[var(--ink-3)]">
            이 기기에서는 3D 주사위를 쓸 수 없어요 (WebGL 미지원)
          </span>
        </div>
      )}
    </div>
  )
}
