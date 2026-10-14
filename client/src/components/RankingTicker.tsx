import { useEffect, useState } from 'react'

type Row = { nickname: string; score: number; rank: number }

/**
 * RankingTicker — 허브 상단 "이번 주 요트 랭킹" 띠
 * 60초 폴링, 탭이 안 보일 땐 쉬고 돌아오면 바로 한 번 읽는다.
 * 서버에 랭킹 저장소가 없으면 빈 배열 → 띠 자체를 숨긴다.
 */
export default function RankingTicker() {
  const [rows, setRows] = useState<Row[]>([])

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

  if (!rows.length) return null
  return (
    <div className="relative z-10 flex shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap border-b border-white/10 px-5 py-1.5 text-xs sm:px-8">
      <span className="flex items-center gap-1.5 font-bold text-white/80">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--ac)]" />
        이번 주 요트 랭킹
      </span>
      {rows.slice(0, 5).map((r) => (
        <span key={r.nickname} className="text-white/60">
          <span className="label-mono mr-1 text-white/40">{r.rank}</span>
          {r.nickname} <b className="text-white/85">{r.score}</b>
        </span>
      ))}
    </div>
  )
}
