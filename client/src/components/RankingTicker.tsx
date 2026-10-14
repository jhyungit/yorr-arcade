import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Row = { nickname: string; score: number; rank: number }

/**
 * RankingTicker — 허브 상단 "이번 주 요트 랭킹" 띠
 * - 가운데: TOP5 한 벌이 오른쪽 끝에서 나와 왼쪽으로 다 들어가면, 1초 쉬고 다시 나온다
 * - 오른쪽: TOP10 버튼 → 아래로 펼쳐지는 패널
 * 60초 폴링, 탭이 안 보일 땐 쉬고 돌아오면 바로 한 번 읽는다.
 * 서버에 랭킹 저장소가 없거나 기록이 없으면 띠 자체를 숨긴다.
 */
export default function RankingTicker() {
  const [rows, setRows] = useState<Row[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const winRef = useRef<HTMLDivElement>(null)
  const beltRef = useRef<HTMLDivElement>(null)
  // lap 이 바뀌면 띠를 새로 마운트 → 애니메이션이 처음(오른쪽 밖)부터 다시
  const [lap, setLap] = useState(0)
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    // ?rankdemo — 실제 랭킹 대신 더미 10명(동점 포함)으로 화면만 확인
    if (new URLSearchParams(location.search).has('rankdemo')) {
      const demo = [['요트왕', 287], ['주사위장인', 262], ['정현', 262], ['상은', 241], ['민서', 233],
        ['개발자', 187], ['럭키세븐', 175], ['풀하우스', 168], ['초보', 142], ['익명', 120]] as const
      setRows(demo.map(([nickname, score], i) => ({ nickname, score, rank: score === 262 ? 2 : i + 1 })))
      return
    }
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

  const top5 = rows.slice(0, 5)

  // 화면 폭 + 띠 길이를 일정한 속도(초당 90px)로 지나가게 → 사람이 많든 적든 속도가 같다
  useLayoutEffect(() => {
    const w = (winRef.current?.offsetWidth ?? 0) + (beltRef.current?.offsetWidth ?? 0)
    setSecs(w / 90)
  }, [lap, rows])

  if (!rows.length) return null

  return (
    <div ref={boxRef} className="rk relative z-30 flex h-11 shrink-0 items-stretch">
      <div className="rk-title flex shrink-0 items-center gap-2 pl-5 pr-4 sm:pl-8">
        <span className="rk-dot" />
        <span className="font-display text-[13px] font-black tracking-tight">이번 주 요트 랭킹</span>
      </div>

      <div ref={winRef} className="rk-window relative min-w-0 flex-1 overflow-hidden">
        <div
          key={lap}
          ref={beltRef}
          className="rk-belt absolute inset-y-0 flex w-max items-center"
          style={{ animationDuration: `${secs}s`, animationPlayState: secs ? 'running' : 'paused' }}
          onAnimationEnd={() => setTimeout(() => setLap((n) => n + 1), 1000)}
        >
          {top5.map((r) => (
            <span key={r.nickname} className="flex items-center gap-2 px-6 text-sm">
              <Medal rank={r.rank} />
              <span className="font-bold text-white/85">{r.nickname}</span>
              <span className="label-mono text-[15px] font-bold text-white/70">{r.score}점</span>
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
          <div className="label-mono px-4 pb-2 pt-3 text-[11px] text-white/40">WEEKLY TOP 10</div>
          <ol>
            {rows.slice(0, 10).map((r) => (
              <li key={r.nickname} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Medal rank={r.rank} />
                <span className="min-w-0 flex-1 truncate font-bold text-white/85">{r.nickname}</span>
                <span className="label-mono text-[15px] font-bold text-white/75">{r.score}</span>
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
