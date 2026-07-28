/**
 * gameCards.tsx — 허브 카드의 메타데이터 + 카드 아트
 * -------------------------------------------------------------
 * 카드마다 "그 게임의 플레이 화면"을 축소해 보여준다. 이모지 하나만 얹은
 * 그라디언트로는 무슨 게임인지 안 읽히기 때문.
 *
 * 아트는 전부 div/그라디언트/clip-path/SVG 로만 그린다 — 외부 이미지·폰트 금지
 * (CLAUDE.md). 색은 각 게임 실제 화면에서 그대로 가져왔다:
 *   요트   index.css .yd (딥그린 펠트 + 골드 #d8a24a)
 *   핑퐁   scene3d.ts (체육관 #070b12 · 상판 #1a7cc4 · P1 #2b8fe0 / P2 #e2513c)
 *   리듬   beatmap.ts LANE_COLORS + 배경 #060309
 *   퀵드로우 ReactionBattle.tsx (석양 앰버 #f59e0b · 배경 #0b0409)
 *   슬래셔  StackSlasher.tsx (BLADE_A #22d3ee · BLADE_B #e935c1 · 배경 #070a18)
 *
 * ── live 모드 ──
 * 허브 스테이지에 올라온 "지금 선택된 게임" 하나만 live 로 켠다. 켜지면 아트
 * 루트에 `ar-live` 가 붙고, index.css 의 키프레임이 그 게임의 플레이 장면을
 * 짧게 반복 재생한다 (주사위가 구르고, 공이 오가고, 노트가 떨어진다).
 * 5개를 동시에 돌리면 산만하고 무겁기도 해서 선택된 것만 움직인다.
 */

import { useId } from 'react'

export interface ArtProps {
  /** 스테이지에 올라온 카드만 true — 플레이 장면이 반복 재생된다 */
  live?: boolean
}

export interface GameCard {
  id: string
  title: string
  /** 한 줄 요약 */
  desc: string
  emoji: string
  /** 카드 테두리·버튼·스테이지 글로우에 쓰는 대표색 */
  accent: string
  /** 인원·조작·길이 등 한눈 정보 */
  tags: string[]
  Art: (p: ArtProps) => React.JSX.Element
}

/** live 일 때만 애니메이션 클래스를 붙인다 */
const liveCls = (live: boolean | undefined, cls: string) => (live ? `ar-live ${cls}` : cls)

/* ── 주사위 한 알 (3×3 격자에 핍을 찍는다) ── */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}
function Die({ n, cls, style }: { n: number; cls: string; style: React.CSSProperties }) {
  const on = new Set(PIPS[n])
  return (
    <div
      className={`ar-die ${cls} absolute rounded-[22%] bg-gradient-to-br from-[#fffdf7] to-[#e6ddc9]`}
      style={{ boxShadow: '0 6px 12px rgba(0,0,0,0.45)', ...style }}
    >
      <div className="grid h-full w-full grid-cols-3 grid-rows-3 gap-[6%] p-[12%]">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={on.has(i) ? 'rounded-full bg-[#1a1712]' : ''} />
        ))}
      </div>
    </div>
  )
}

/* ── 요트 다이스 — 딥그린 펠트 위 주사위, 위에서 조명 ── */
function YachtArt({ live }: ArtProps) {
  return (
    <div
      className={liveCls(live, 'absolute inset-0 overflow-hidden')}
      style={{ background: 'radial-gradient(120% 95% at 50% -12%, #3d8f6c, #1d5c46 46%, #0d2822 100%)' }}
    >
      {/* 펠트 결 */}
      <div
        className="absolute inset-0 opacity-[0.10]"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 6px)' }}
      />
      {/* 골드 스포트라이트 */}
      <div
        className="absolute left-1/2 top-[-30%] h-[70%] w-[70%] -translate-x-1/2 rounded-full blur-2xl"
        style={{ background: 'radial-gradient(closest-side,rgba(216,162,74,0.55),transparent)' }}
      />
      <Die n={5} cls="ar-die0" style={{ left: '14%', top: '38%', width: '23%', aspectRatio: '1', rotate: '-15deg' }} />
      <Die n={3} cls="ar-die1" style={{ left: '39%', top: '26%', width: '26%', aspectRatio: '1', rotate: '8deg' }} />
      <Die n={6} cls="ar-die2" style={{ left: '65%', top: '42%', width: '22%', aspectRatio: '1', rotate: '-6deg' }} />
      {/* 바닥 그림자 */}
      <div
        className="absolute inset-x-[10%] bottom-[10%] h-[14%] rounded-full blur-md"
        style={{ background: 'rgba(0,0,0,0.5)' }}
      />
    </div>
  )
}

/* ── 핑퐁 — 어두운 체육관, 원근 상판, 네트, 스매시 잔상 ──
   테이블 테두리·네트처럼 선이 중요한 그림은 SVG 로 그린다.
   div + clip-path 로는 "속 빈 테두리"를 못 만들고, viewBox 라 크기도 알아서 맞는다. */
function PingPongArt({ live }: ArtProps) {
  // 스테이지와 필름스트립이 같은 아트를 동시에 그린다 → id 가 겹치면 안 된다
  const uid = useId()
  const top = `pp-top${uid}`
  const spot = `pp-spot${uid}`
  return (
    <svg
      viewBox="0 0 160 90"
      className={liveCls(live, 'absolute inset-0 h-full w-full')}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={top} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1262a0" />
          <stop offset="0.55" stopColor="#1a7cc4" />
          <stop offset="1" stopColor="#10578e" />
        </linearGradient>
        <radialGradient id={spot} cx="0.5" cy="0.3" r="0.6">
          <stop offset="0" stopColor="#5a82b4" stopOpacity="0.32" />
          <stop offset="1" stopColor="#5a82b4" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="160" height="90" fill="#070b12" />
      <rect width="160" height="90" fill={`url(#${spot})`} />
      {/* 상판 — 사다리꼴(원근). 흰 테두리는 stroke 로. */}
      <polygon points="50,26 110,26 158,90 2,90" fill={`url(#${top})`} stroke="#f4f8fb" strokeWidth="1.4" />
      {/* 센터라인 (대칭 사다리꼴이라 수직) */}
      <line x1="80" y1="26" x2="80" y2="90" stroke="#f4f8fb" strokeWidth="0.7" opacity="0.55" />
      {/* 네트 — 코트 중간 깊이에 서 있고, 양옆으로 살짝 튀어나온다 */}
      <rect x="32" y="37" width="96" height="9" fill="#f0f6ff" opacity="0.22" />
      <rect x="32" y="37" width="96" height="2" fill="#f2f6fb" />
      {/* 진영색 라켓 — 가까운 쪽 파랑(P1), 먼 쪽 빨강(P2) */}
      <ellipse className="ar-pad-near" cx="30" cy="72" rx="9" ry="8" fill="#2b8fe0" />
      <ellipse className="ar-pad-far" cx="105" cy="30" rx="5.5" ry="5" fill="#e2513c" />
      {/* 공 + 스매시 잔상 — live 면 코트를 오간다 */}
      <g className="ar-ball">
        <circle cx="112" cy="34" r="2.2" fill="#ff8a5c" opacity="0.25" />
        <circle cx="104" cy="40" r="2.8" fill="#ff8a5c" opacity="0.45" />
        <circle cx="94" cy="48" r="4" fill="#fdfdf6" />
      </g>
    </svg>
  )
}

/* ── 리듬 탭 — 네온 4레인이 판정선으로 수렴 ── */
const LANES = ['#22d3ee', '#a855f7', '#ec4899', '#f59e0b']
function RhythmArt({ live }: ArtProps) {
  return (
    <div className={liveCls(live, 'absolute inset-0 overflow-hidden')} style={{ background: '#060309' }}>
      {LANES.map((c, i) => {
        // 위(먼 곳)는 좁게 모이고 아래(가까이)는 화면 폭으로 벌어진다
        const tl = 36 + i * 7
        const tr = 36 + (i + 1) * 7
        const bl = i * 25
        const br = (i + 1) * 25
        // 정지 상태의 노트 — 그 높이에서의 레인 폭을 따라야 원근이 맞는다
        const t = 0.3 + i * 0.15
        const nl = tl + (bl - tl) * t
        const nr = tr + (br - tr) * t
        const pad = (nr - nl) * 0.16
        return (
          <div key={c}>
            <div
              className="absolute inset-0"
              style={{
                clipPath: `polygon(${tl}% 0,${tr}% 0,${br}% 100%,${bl}% 100%)`,
                background: `linear-gradient(${c}00 30%, ${c}44 100%)`,
              }}
            />
            {/* 노트 — live 면 레인 원근을 따라 판정선으로 떨어진다 (ar-note{i} 키프레임) */}
            <div
              className={`ar-note ar-note${i} absolute rounded-full`}
              style={{
                left: `${nl + pad}%`,
                width: `${nr - nl - pad * 2}%`,
                top: `${t * 100}%`,
                height: '5%',
                background: c,
                boxShadow: `0 0 12px ${c}`,
              }}
            />
          </div>
        )
      })}
      {/* 판정선 */}
      <div
        className="ar-judge absolute inset-x-0 bottom-[13%] h-[3px]"
        style={{ background: '#fff', boxShadow: '0 0 16px #22d3ee, 0 0 32px #a855f7' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[13%]"
        style={{ background: 'linear-gradient(rgba(124,58,237,0.35), transparent)' }}
      />
    </div>
  )
}

/* ── 황야의 퀵드로우 — 석양, 지평선, 두 총잡이 실루엣 ──
   사람 실루엣은 부위가 많아 px 로 쌓으면 카드 크기에 안 맞는다 → SVG 좌표계로. */
function Gunman({ x, flip, cls }: { x: number; flip?: boolean; cls: string }) {
  return (
    <g className={cls} transform={`translate(${x} 0)${flip ? ' scale(-1 1)' : ''}`} fill="#120a08">
      {/* 모자 (크라운 + 챙) */}
      <rect x="-4" y="50" width="8" height="4" rx="1.4" />
      <rect x="-7.5" y="53.5" width="15" height="1.8" rx="0.9" />
      {/* 머리 · 몸통 */}
      <rect x="-2.6" y="55.5" width="5.2" height="4" rx="1.2" />
      <rect x="-4.6" y="59" width="9.2" height="11" rx="1.8" />
      {/* 총을 쥔 팔 (바깥쪽으로 뻗음) */}
      <rect x="4" y="62" width="5.5" height="1.9" rx="0.9" />
      {/* 다리 */}
      <rect x="-3.6" y="69.5" width="2.6" height="8.5" />
      <rect x="1" y="69.5" width="2.6" height="8.5" />
    </g>
  )
}
function ReactionArt({ live }: ArtProps) {
  const uid = useId()
  const sky = `qd-sky${uid}`
  const sun = `qd-sun${uid}`
  const ground = `qd-ground${uid}`
  return (
    <svg
      viewBox="0 0 160 90"
      className={liveCls(live, 'absolute inset-0 h-full w-full')}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d1230" />
          <stop offset="0.4" stopColor="#86302c" />
          <stop offset="0.7" stopColor="#cf5f2c" />
          <stop offset="1" stopColor="#f2a545" />
        </linearGradient>
        <radialGradient id={sun}>
          <stop offset="0" stopColor="#ffd89b" />
          <stop offset="0.7" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#e06a22" />
        </radialGradient>
        <linearGradient id={ground} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7a3f22" />
          <stop offset="0.55" stopColor="#2a1010" />
          <stop offset="1" stopColor="#0a0405" />
        </linearGradient>
      </defs>
      <rect width="160" height="90" fill={`url(#${sky})`} />
      <circle cx="80" cy="62" r="19" fill={`url(#${sun})`} />
      <rect y="62" width="160" height="28" fill={`url(#${ground})`} />
      <Gunman x={28} cls="ar-gun-l" />
      <Gunman x={132} flip cls="ar-gun-r" />
      {/* 총구 화염 — live 면 초록불 순간에 번쩍 */}
      <circle className="ar-muzzle ar-muzzle-l" cx="40" cy="63" r="4" fill="#ffd89b" opacity="0" />
      <circle className="ar-muzzle ar-muzzle-r" cx="120" cy="63" r="4" fill="#ffd89b" opacity="0" />
      {/* 신호등 — 매달려 있고, live 면 빨강→노랑→초록으로 돈다 */}
      <rect x="79.2" y="0" width="1.6" height="9" fill="#2a1a14" />
      <rect x="75" y="9" width="10" height="20" rx="2.5" fill="#1a1210" />
      <circle className="ar-lamp-r" cx="80" cy="13.5" r="2.2" fill="#7a1f14" />
      <circle className="ar-lamp-a" cx="80" cy="19" r="2.2" fill="#6b4a24" />
      <circle className="ar-lamp-g" cx="80" cy="24.5" r="2.6" fill="#4ade80" />
      <circle className="ar-lamp-glow" cx="80" cy="24.5" r="5" fill="#4ade80" opacity="0.28" />
    </svg>
  )
}

/* ── 기술스택 슬래셔 — 광선검 궤적 + 날아오는 로고 칩 ── */
function SlasherArt({ live }: ArtProps) {
  const chips = [
    { t: 'TS', x: '12%', y: '18%', r: -12 },
    { t: 'GO', x: '68%', y: '14%', r: 9 },
    { t: 'JS', x: '74%', y: '58%', r: -6 },
    { t: 'PY', x: '20%', y: '62%', r: 14 },
  ]
  return (
    <div className={liveCls(live, 'absolute inset-0 overflow-hidden')} style={{ background: '#070a18' }}>
      {/* 격자 */}
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(34,211,238,0.25) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,0.25) 1px,transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />
      {chips.map((c, i) => (
        <div
          key={c.t}
          className={`ar-chip ar-chip${i} absolute flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.07] text-[10px] font-black text-white/70`}
          style={{ left: c.x, top: c.y, width: 30, height: 30, rotate: `${c.r}deg` }}
        >
          {c.t}
        </div>
      ))}
      {/* 검격 궤적 — 굵은 글로우 + 흰 코어. live 면 화면을 가로지른다 */}
      <div className="ar-slash absolute inset-0">
        <div
          className="absolute left-[-10%] top-1/2 h-[26px] w-[120%] -translate-y-1/2 blur-md"
          style={{ background: 'linear-gradient(90deg,transparent,#22d3ee,#e935c1,transparent)', rotate: '-24deg' }}
        />
        <div
          className="absolute left-[-10%] top-1/2 h-[3px] w-[120%] -translate-y-1/2"
          style={{ background: 'linear-gradient(90deg,transparent,#fff 30%,#fff 70%,transparent)', rotate: '-24deg' }}
        />
      </div>
    </div>
  )
}

export const GAME_CARDS: GameCard[] = [
  {
    id: 'yacht',
    title: '요트 다이스',
    desc: '진짜로 굴러가는 3D 주사위 5개. 12라운드 동안 족보를 채워라.',
    emoji: '🎲',
    accent: '#d8a24a',
    tags: ['12라운드', '폰 흔들기', '온라인 방'],
    Art: YachtArt,
  },
  {
    id: 'pingpong',
    title: '핑퐁 스매시',
    desc: '3D 코트에서 타이밍 맞춰 받아치기. 정확한 순간에 스매시!',
    emoji: '🏓',
    accent: '#2b8fe0',
    tags: ['1–2인', '폰 스윙', '온라인 대전'],
    Art: PingPongArt,
  },
  {
    id: 'rhythm',
    title: '리듬 탭',
    desc: '내려오는 네온 노트를 Perfect·콤보로 이어 붙여라.',
    emoji: '🎵',
    accent: '#a855f7',
    tags: ['4레인', '폰 스윙', '콤보'],
    Art: RhythmArt,
  },
  {
    id: 'reaction',
    title: '황야의 퀵드로우',
    desc: '석양의 결투. 초록불이 켜지는 순간 먼저 뽑아라.',
    emoji: '🤠',
    accent: '#f59e0b',
    tags: ['2인 결투', '폰 2대', '반응속도'],
    Art: ReactionArt,
  },
  {
    id: 'slasher',
    title: '기술스택 슬래셔',
    desc: '날아오는 기술 로고를 광선검으로 베기. 개발자 유형 판정까지.',
    emoji: '🗡️',
    accent: '#22d3ee',
    tags: ['60초', '폰 조준', '유형 판정'],
    Art: SlasherArt,
  },
]
