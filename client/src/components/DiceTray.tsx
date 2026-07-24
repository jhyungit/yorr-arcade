import { useLayoutEffect, useMemo, useRef } from 'react'
import DiceCube, { FACE_ROTATION } from './DiceCube'

/**
 * DiceTray — 핵심 연출
 * -------------------------------------------------------------
 * "손에 든 주사위 5개를 보드에 던져 굴리다 멈추는" 물리감.
 *  - 원목 테두리 + 청록 펠트 + 상단 "고정 선반".
 *  - 굴리기(rollKey 증가) 시: 고정 안 된 주사위가 Web Animations API로
 *    포물선 궤적(던짐)+큐브 회전(여러 바퀴→목표 눈으로 감속)으로 굴러
 *    무작위 위치·각도에 안착 (매번 배치가 다름). 슬롯머신 릴 스핀 아님.
 *  - 주사위 탭 → 위 선반으로 고정(체크 배지). 고정된 건 리롤에서 제외.
 *  - prefers-reduced-motion 이면 애니메이션 없이 즉시 최종 상태.
 */

const rand = (a: number, b: number) => a + Math.random() * (b - a)

interface DiceTrayProps {
  values: number[] // 5개 최종 눈
  kept: boolean[]
  rollKey: number // 굴릴 때마다 +1
  rolled: boolean // 이번 라운드에 한 번이라도 굴렸나
  reducedMotion: boolean
  disabled: boolean // 상호작용 잠금(구르는 중/기록완료)
  onToggleKeep: (index: number) => void
}

// 각 주사위의 이번 굴리기 랜덤 파라미터
interface RollParam {
  left: number // 펠트 내 최종 x(%)
  top: number // 펠트 내 최종 y(px)
  jx: number
  jy: number
  jz: number // 착지 미세 기울기
  fromX: number
  fromY: number // 굴러 나오기 시작하는(판 안) 위치 오프셋
  midX: number
  midY: number // 판 위를 굴러다니는 중간 경유점
  spinX: number
  spinY: number // 굴러가는 회전량(여러 바퀴)
  dur: number
}

export default function DiceTray({
  values,
  kept,
  rollKey,
  rolled,
  reducedMotion,
  disabled,
  onToggleKeep,
}: DiceTrayProps) {
  const wrapRefs = useRef<(HTMLDivElement | null)[]>([])
  const cubeRefs = useRef<(HTMLDivElement | null)[]>([])

  // 굴릴 때마다(rollKey) 주사위별 랜덤 파라미터를 새로 뽑는다 → 매번 다른 배치
  const params = useMemo<RollParam[]>(() => {
    return values.map((_, i) => ({
      // 5칸으로 가로 분산(겹침 방지) — 세로는 가운데 대역으로 모아 깔끔하게
      left: 10 + i * 15 + rand(-3, 3),
      top: rand(70, 165),
      jx: rand(-10, 10),
      jy: rand(-10, 10),
      jz: rand(-12, 12),
      // "판 위를 굴러다니는" 경로: 판 안의 다른 지점에서 출발 → 경유 → 제자리
      // (판 밖으로 튀어 잘리지 않게 이동폭은 적당히)
      fromX: rand(-58, 58),
      fromY: rand(-52, 52),
      midX: rand(-34, 34),
      midY: rand(-28, 28),
      spinX: (Math.random() < 0.5 ? -1 : 1) * rand(1.5, 2.5) * 360,
      spinY: (Math.random() < 0.5 ? -1 : 1) * rand(1.5, 2.5) * 360,
      dur: rand(1400, 1550),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey])

  // 큐브가 특정 눈을 보이도록 하는 최종(정지) 회전값 문자열
  const restTransform = (i: number) => {
    const [rx, ry] = FACE_ROTATION[values[i]] ?? [0, 0]
    const p = params[i]
    return `rotateX(${rx + p.jx}deg) rotateY(${ry + p.jy}deg) rotateZ(${p.jz}deg)`
  }

  // 굴리기 애니메이션 (rollKey 변화 시)
  useLayoutEffect(() => {
    if (!rolled) return
    // 고정 안 된 주사위만, 순서대로 살짝 시차를 두고
    const order = values.map((_, i) => i).filter((i) => !kept[i])
    order.forEach((i, k) => {
      const wrap = wrapRefs.current[i]
      const cube = cubeRefs.current[i]
      const p = params[i]
      if (!wrap || !cube) return
      if (reducedMotion) return // 즉시 최종 상태(인라인 transform이 이미 최종)

      const delay = k * 60
      const [rx, ry] = FACE_ROTATION[values[i]] ?? [0, 0]

      // 판 위를 굴러다니는 이동 경로 (판 밖에서 떨어지지 않음. 출발→경유→제자리)
      wrap.animate(
        [
          { transform: `translate(${p.fromX}px, ${p.fromY}px)`, offset: 0 },
          { transform: `translate(${p.midX}px, ${p.midY}px)`, offset: 0.5 },
          { transform: `translate(0px, 0px)`, offset: 1 },
        ],
        { duration: p.dur, delay, easing: 'cubic-bezier(0.22,0.68,0.24,1)', fill: 'none' },
      )
      // 큐브 회전: 여러 축으로 구르다(숫자 바뀜) 목표 눈으로 천천히 감속 정착
      cube.animate(
        [
          { transform: `rotateX(${rx + p.spinX}deg) rotateY(${ry + p.spinY}deg) rotateZ(0deg)`, offset: 0 },
          {
            transform: `rotateX(${rx + p.spinX * 0.42}deg) rotateY(${ry + p.spinY * 0.5}deg) rotateZ(22deg)`,
            offset: 0.5,
          },
          { transform: restTransform(i), offset: 1 },
        ],
        // 뒤로 갈수록 급격히 느려지는 감속 커브 (실제 주사위가 힘 빠지며 멈추는 느낌)
        { duration: p.dur, delay, easing: 'cubic-bezier(0.1,0.75,0.2,1)', fill: 'none' },
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey])

  const keptIdx = values.map((_, i) => i).filter((i) => kept[i])
  const trayIdx = values.map((_, i) => i).filter((i) => !kept[i])

  return (
    <div className="tray-scene">
      {/* 검정 트레이 프레임 (제품처럼 층이 진 베젤) */}
      <div
        className="rounded-[26px] p-2.5"
        style={{
          background: 'linear-gradient(180deg, var(--wood-hi), var(--wood) 42%, var(--wood-lo))',
          boxShadow:
            '0 18px 34px rgba(15,25,40,0.28), inset 0 1px 1px rgba(255,255,255,0.14), inset 0 -2px 3px rgba(0,0,0,0.5)',
        }}
      >
        {/* 안쪽 리브(한 단 더 들어간 테두리) */}
        <div
          className="rounded-[20px] p-2"
          style={{
            background: 'linear-gradient(180deg, var(--wood-lo), var(--wood))',
            boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.6)',
          }}
        >
        {/* 펠트 */}
        <div
          className="rounded-[14px] overflow-hidden"
          style={{
            background:
              'radial-gradient(130% 100% at 50% -10%, var(--felt), var(--felt-2) 65%, var(--felt-lo))',
            boxShadow: 'inset 0 10px 26px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(0,0,0,0.25)',
          }}
        >
          {/* 고정 선반 (제품의 어두운 다이스 선반 느낌 — 세로 홈) */}
          <div
            className="px-3 pt-2.5 pb-2.5"
            style={{
              background: `repeating-linear-gradient(90deg, var(--shelf) 0 22px, #23242a 22px 24px)`,
              boxShadow: 'inset 0 -6px 10px rgba(0,0,0,0.45)',
            }}
          >
            <div className="label-mono text-white/60 mb-1.5">KEEP · 고정</div>
            <div className="flex gap-2 min-h-[46px] items-center">
              {keptIdx.length === 0 && (
                <span className="text-white/45 text-xs">주사위를 탭해 여기에 고정</span>
              )}
              {keptIdx.map((i) => (
                <button
                  key={`keep-${i}`}
                  onClick={() => !disabled && onToggleKeep(i)}
                  aria-label={`고정 해제: ${values[i]}눈`}
                  className="relative animate-keep-slide"
                  style={{ ['--die' as string]: '38px' }}
                >
                  <DiceCube style={{ transform: cubeCss(values[i]) }} />
                  {/* 체크 배지 */}
                  <span
                    className="absolute -right-1.5 -top-1.5 w-4 h-4 rounded-full text-[9px] flex items-center justify-center text-white"
                    style={{ background: 'var(--pos)' }}
                  >
                    ✓
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 펠트 바닥(주사위가 굴러 안착) */}
          <div className="tray-felt relative h-[290px]">
            {!rolled ? (
              <div className="absolute inset-0 flex items-center justify-center text-white/55 text-sm text-center px-6">
                굴리기 버튼을 누르면
                <br />
                주사위가 트레이 위로 굴러 떨어집니다
              </div>
            ) : (
              trayIdx.map((i) => (
                <div
                  key={`tray-${i}`}
                  ref={(el) => {
                    wrapRefs.current[i] = el
                  }}
                  className="absolute"
                  style={{ left: `${params[i].left}%`, top: `${params[i].top}px` }}
                >
                  <button
                    onClick={() => !disabled && onToggleKeep(i)}
                    aria-label={`주사위 ${values[i]}눈 고정`}
                    className="relative block"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                    {/* 인라인 transform = 정지 시 최종 회전. WAAPI가 그 위로 굴리는 연출을 얹고
                        끝나면 다시 이 값으로 안착(reduced-motion/재렌더에도 올바른 눈 유지) */}
                    <DiceCube
                      ref={(el) => {
                        cubeRefs.current[i] = el
                      }}
                      style={{ transform: restTransform(i) }}
                    />
                    <span className="die-shadow" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

// 인라인 style 로 큐브 최종 회전을 주기 위한 헬퍼 (선반용: 지터 없이 정면)
function cubeCss(value: number) {
  const [rx, ry] = FACE_ROTATION[value] ?? [0, 0]
  return `rotateX(${rx}deg) rotateY(${ry}deg)`
}
