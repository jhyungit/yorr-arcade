import { useEffect, useState } from 'react'

/**
 * RoundTimer — 가는 진행 바
 * -------------------------------------------------------------
 * 남은 시간 = deadline(epoch ms) - now. (별도 tick 이벤트 사용 안 함)
 * 여유=pos(청록), ≤6s=coral, ≤3s=coral-lo 로 색 전환.
 */
interface RoundTimerProps {
  deadline: number | null // epoch ms
  totalMs?: number // 진행 바 채움 계산용 (라운드 총 길이)
}

export default function RoundTimer({ deadline, totalMs = 25000 }: RoundTimerProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!deadline) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [deadline])

  if (!deadline) {
    return <div className="h-1.5 rounded-full bg-[var(--line)]" />
  }

  const remainMs = Math.max(0, deadline - now)
  const remainSec = Math.ceil(remainMs / 1000)
  const pct = Math.max(0, Math.min(100, (remainMs / totalMs) * 100))

  const color =
    remainSec <= 3 ? 'var(--coral-lo)' : remainSec <= 6 ? 'var(--coral)' : 'var(--pos)'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-200 ease-linear"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span
        className="text-xs tabular-nums font-semibold w-8 text-right"
        style={{ color }}
        aria-label={`남은 시간 ${remainSec}초`}
      >
        {remainSec}s
      </span>
    </div>
  )
}
