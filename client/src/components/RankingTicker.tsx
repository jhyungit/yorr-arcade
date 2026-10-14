import { useEffect, useRef, useState } from 'react'

type Row = { nickname: string; score: number; rank: number }

/**
 * RankingTicker — 허브 상단 "이번 주 요트 랭킹" 띠
 * - 가운데: TOP5 가 오른쪽에서 나와 왼쪽으로 흘러가는 무빙워크(무한 루프)
 * - 오른쪽: TOP10 버튼 → 아래로 펼쳐지는 패널
 * 60초 폴링, 탭이 안 보일 땐 쉬고 돌아오면 바로 한 번 읽는다.
 * 서버에 랭킹 저장소가 없거나 기록이 없으면 띠 자체를 숨긴다.
 */
export default function RankingTicker() {
  const [rows, setRows] = useState<Row[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = () => {
      if (document.hidden) return
      fetch('/api/ranking')
        .then((r) => (r.ok ? r.json() : []))
        .then(setRows)
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 60000)
    document.addEventListener('visibilitychange', load)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', load)
    }
  }, [])

  // 패널 밖을 누르거나 Esc → 닫기
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!rows.length) return null

  // 무빙워크: 한 바퀴가 화면보다 짧으면 빈틈이 생기므로 8칸 이상 되게 반복 → 두 벌 이어 붙여 -50% 이동
  const top5 = rows.slice(0, 5)
  const lap: Row[] = []
  while (lap.length < 8) lap.push(...top5)
  const belt = [...lap, ...lap]

  return (
    <div ref={boxRef} className="rk relative z-30 flex h-11 shrink-0 items-stretch">
      <div className="rk-title flex shrink-0 items-center gap-2 pl-5 pr-4 sm:pl-8">
        <span className="rk-dot" />
        <span className="font-display text-[13px] font-black tracking-tight">이번 주 요트 랭킹</span>
      </div>

      <div className="rk-window relative min-w-0 flex-1 overflow-hidden">
        <div className="rk-belt flex h-full w-max items-center" style={{ animationDuration: `${lap.length * 4}s` }}>
          {belt.map((r, i) => (
            <span key={i} className="flex items-center gap-2 px-6 text-sm" aria-hidden={i >= lap.length}>
              <Medal rank={r.rank} />
              <span className="font-bold text-white/85">{r.nickname}</span>
              <span className="label-mono text-[13px] text-white/45">{r.score}점</span>
            </span>
          ))}
        </div>
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rk-btn flex shrink-0 items-center gap-2 pl-4 pr-5 text-xs font-bold sm:pr-8"
      >
        <span className="label-mono">TOP 10</span>
        <span className={`rk-burger ${open ? 'is-open' : ''}`} aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </button>

      {open && (
        <div className="rk-panel absolute right-3 top-full mt-2 w-72 sm:right-8">
          <div className="label-mono px-4 pb-2 pt-3 text-[11px] text-white/40">WEEKLY TOP 10 · 매주 월 00시 초기화</div>
          <ol>
            {rows.slice(0, 10).map((r) => (
              <li key={r.nickname} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Medal rank={r.rank} />
                <span className="min-w-0 flex-1 truncate font-bold text-white/85">{r.nickname}</span>
                <span className="label-mono text-white/55">{r.score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function Medal({ rank }: { rank: number }) {
  return (
    <span className="rk-medal" data-rank={rank <= 3 ? rank : undefined}>
      {rank}
    </span>
  )
}
