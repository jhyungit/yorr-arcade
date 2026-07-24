import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * GameHub — 랜딩 (카드 캐러셀로 게임 선택)
 * -------------------------------------------------------------
 * 카드를 좌우로 넘기며(드래그/화살표/점) 게임을 고른다.
 * 가운데(활성) 카드의 "플레이" 버튼으로 시작.
 */
interface GameCard {
  id: string
  title: string
  desc: string
  emoji: string
  gradient: string
  playable: boolean
}

const CARDS: GameCard[] = [
  {
    id: 'pingpong',
    title: '핑퐁 스매시',
    desc: '날아오는 공을 타이밍 맞춰 받아치기. 스매시!',
    emoji: '🏓',
    gradient: 'linear-gradient(160deg, #2b8fe0, #1c86cf 55%, #12639e)',
    playable: true,
  },
  {
    id: 'rhythm',
    title: '리듬 탭',
    desc: '내려오는 네온 노트를 Perfect·콤보로 점수 쌓기!',
    emoji: '🎵',
    gradient: 'linear-gradient(160deg, #22d3ee 0%, #7c3aed 55%, #db2777 100%)',
    playable: true,
  },
  {
    id: 'reaction',
    title: '반응속도 배틀',
    desc: '신호에 맞춰 최대한 빨리! ms 단위 반응속도 측정. 혼자 기록 갱신 or 1:1 대결.',
    emoji: '⚡',
    gradient: 'linear-gradient(160deg, #f59e0b 0%, #ef4444 60%, #7f1d1d 100%)',
    playable: true,
  },
  {
    id: 'slasher',
    title: '기술스택 슬래셔',
    desc: '날아오는 기술 로고를 광선검으로 베기! 60초 타임어택 · 개발자 유형 판정.',
    emoji: '🗡️',
    gradient: 'linear-gradient(160deg, #0891b2 0%, #22d3ee 45%, #e935c1 100%)',
    playable: true,
  },
]

const STEP = 250 // 카드 간 이동 거리(px)
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

interface GameHubProps {
  onSelect: (id: string) => void
  onController: () => void
  pairCode: string | null // 허브에서 폰 연결용으로 발급된 코드
  phoneConnected: boolean // 폰 컨트롤러가 하나라도 붙었는가
  phoneCount: number // 연결된 폰 컨트롤러 수
  onConnectPhone: () => void // "폰 연결" 시작(코드 발급)
  initialGameId?: string | null // 방금 플레이한 게임 → 이 카드에서 시작(없으면 첫 카드)
}

export default function GameHub({
  onSelect,
  onController,
  pairCode,
  phoneConnected,
  phoneCount,
  onConnectPhone,
  initialGameId,
}: GameHubProps) {
  // 게임에서 나왔을 때 방금 한 게임 카드에 위치 (허브 재진입 시 마운트되며 반영)
  const [index, setIndex] = useState(() => {
    const i = CARDS.findIndex((c) => c.id === initialGameId)
    return i >= 0 ? i : 0
  })
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef<number | null>(null)
  const moved = useRef(false)

  // 주의: setPointerCapture 를 쓰면 카드 버튼의 click 이 삼켜져 "플레이"가 안 눌린다.
  // 그래서 캡처는 쓰지 않고, 포인터가 영역을 벗어나면 onUp 으로 정리한다.
  const onDown = (e: ReactPointerEvent) => {
    startX.current = e.clientX
    moved.current = false
    setDragging(true)
  }
  const onMove = (e: ReactPointerEvent) => {
    if (startX.current == null) return
    const dx = e.clientX - startX.current
    if (Math.abs(dx) > 6) moved.current = true
    setDrag(dx)
  }
  const onUp = () => {
    if (startX.current == null) return
    let ni = index
    if (drag > 55) ni -= 1
    else if (drag < -55) ni += 1
    setIndex(clamp(ni, 0, CARDS.length - 1))
    setDrag(0)
    setDragging(false)
    startX.current = null
  }

  const go = (d: number) => setIndex((i) => clamp(i + d, 0, CARDS.length - 1))

  const activate = (card: GameCard) => {
    if (moved.current) return // 드래그였으면 클릭으로 취급 안 함
    if (card.playable) onSelect(card.id)
  }

  return (
    <div className="min-h-full flex flex-col items-center px-4 py-8">
      {/* 헤더 */}
      <header className="text-center mb-2">
        <div className="label-mono text-[var(--ink-3)]">YORR · GAME</div>
        <h1 className="text-3xl font-black text-[var(--ink)] mt-1">게임 선택</h1>
        <p className="text-sm text-[var(--ink-2)] mt-1">다양한 게임을 즐겨보세요</p>
      </header>

      {/* 캐러셀 */}
      <div
        className="relative w-full max-w-md flex-1 flex items-center justify-center touch-none"
        style={{ perspective: '1100px' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
      >
        {CARDS.map((card, i) => {
          const p = i - index - drag / STEP // 활성=0
          const active = Math.abs(p) < 0.5
          const style: CSSProperties = {
            transform: `translateX(${p * STEP}px) scale(${clamp(1 - Math.abs(p) * 0.16, 0.78, 1)}) rotateY(${clamp(-p * 22, -30, 30)}deg)`,
            opacity: clamp(1 - Math.abs(p) * 0.4, 0.12, 1),
            zIndex: 100 - Math.round(Math.abs(p) * 10),
            pointerEvents: active ? 'auto' : 'none',
            // 드래그 중엔 손가락을 즉시 따라오도록 트랜지션 끔
            transition: dragging ? 'none' : undefined,
          }
          return (
            <button
              key={card.id}
              onClick={() => activate(card)}
              style={style}
              className="absolute w-[230px] h-[360px] rounded-3xl shadow-2xl transition-[transform,opacity] duration-300 ease-out text-left overflow-hidden"
            >
              <div className="w-full h-full flex flex-col p-6 text-white" style={{ background: card.gradient }}>
                <div className="text-6xl mb-4 drop-shadow">{card.emoji}</div>
                <h2 className="text-2xl font-black">{card.title}</h2>
                <p className="text-sm text-white/85 mt-2 leading-relaxed flex-1">{card.desc}</p>
                {card.playable ? (
                  <span className="mt-3 inline-flex items-center justify-center rounded-xl bg-white/95 text-[var(--ink)] font-bold py-2.5">
                    플레이 ▶
                  </span>
                ) : (
                  <span className="mt-3 inline-flex items-center justify-center rounded-xl bg-black/20 text-white/80 font-semibold py-2.5">
                    준비 중
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* 화살표 + 점 */}
      <div className="flex items-center gap-5 mt-6">
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="이전 게임"
          className="w-10 h-10 rounded-full bg-[var(--card)] border border-[var(--line)] text-[var(--ink)] disabled:opacity-30 shadow-sm"
        >
          ‹
        </button>
        <div className="flex gap-2">
          {CARDS.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setIndex(i)}
              aria-label={`${c.title}로 이동`}
              className="h-2 rounded-full transition-all"
              style={{
                width: i === index ? 22 : 8,
                background: i === index ? 'var(--coral)' : 'var(--line-2)',
              }}
            />
          ))}
        </div>
        <button
          onClick={() => go(1)}
          disabled={index === CARDS.length - 1}
          aria-label="다음 게임"
          className="w-10 h-10 rounded-full bg-[var(--card)] border border-[var(--line)] text-[var(--ink)] disabled:opacity-30 shadow-sm"
        >
          ›
        </button>
      </div>

      {/* 폰으로 같이 하기 — 코드는 항상 유지, 여러 대 연결 + 연결 수 표시 */}
      <div className="mt-6 w-full max-w-sm">
        {pairCode ? (
          // 코드 발급됨(이 기기=화면): 코드를 계속 보여주고, 붙은 폰 수를 실시간 표시
          <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-3 shadow-sm">
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-sm font-bold text-[var(--ink)]">📱 폰 컨트롤러 연동</span>
              <span
                className={`text-xs font-bold rounded-full px-2 py-0.5 ${
                  phoneCount > 0
                    ? 'bg-[var(--pos)]/15 text-[var(--pos)]'
                    : 'bg-[var(--line-2)] text-[var(--ink-3)]'
                }`}
              >
                🎮 {phoneCount}대 연결됨
              </span>
            </div>
            <div className="text-4xl font-black tracking-[0.3em] text-[var(--coral)] text-center my-1">
              {pairCode}
            </div>
            <div className="mt-2 pt-2 border-t border-[var(--line)] text-center text-xs">
              {phoneConnected ? (
                <span className="text-[var(--pos)] font-bold">
                  연결됨 — 게임에서 바로 사용 (반응속도는 2대면 폰 버저 대결!)
                </span>
              ) : (
                <span className="text-[var(--ink-3)]">컨트롤러를 연동하세요 — 위 코드를 폰에 입력</span>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-3 shadow-sm">
            <div className="text-xs font-bold text-[var(--ink-3)] text-center mb-2">
              📱 폰으로 즐기세요
            </div>
            <div className="grid grid-cols-2 gap-2">
              {/* 이 기기 = 화면 (호스트): 코드 발급/표시 */}
              <button
                onClick={onConnectPhone}
                className="flex flex-col items-center gap-0.5 rounded-xl bg-[var(--card-2)] border border-[var(--line)] py-3 active:scale-95 transition"
              >
                <span className="text-2xl leading-none">🖥️</span>
                <span className="text-xs font-bold text-[var(--ink)] mt-1">폰 연결 코드 발급</span>
                <span className="text-[10px] text-[var(--ink-3)]">화면에 폰 여러 대 페어링</span>
              </button>
              {/* 이 기기 = 조종기 (게스트): ?ctrl 화면으로 */}
              <button
                onClick={onController}
                className="flex flex-col items-center gap-0.5 rounded-xl bg-[var(--card-2)] border border-[var(--line)] py-3 active:scale-95 transition"
              >
                <span className="text-2xl leading-none">🎮</span>
                <span className="text-xs font-bold text-[var(--ink)] mt-1">폰 컨트롤러 연결</span>
                <span className="text-[10px] text-[var(--ink-3)]">휴대폰 조종</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
