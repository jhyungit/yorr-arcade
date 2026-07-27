import type { ReactNode } from 'react'
import Gunslinger, { type Outfit, type Pose } from './Gunslinger'
import { BULLET_MS, isClean, msLabel, type Ms } from './duel'

/**
 * Arena — 황야의 결투 무대 (순수 표현 컴포넌트)
 * -------------------------------------------------------------
 * 석양의 황야, 머리 위에 매달린 신호등, 좌우로 마주 선 두 총잡이.
 * 규칙/네트워크는 전혀 모른다. 부모가 "지금 이 화면"만 넘겨주면 그린다.
 * (온라인에서 "나"를 항상 왼쪽에 두는 좌우 뒤집기도 부모 책임)
 *
 * 좌표 기준: 지평선 = 위에서 72%. 캐릭터는 지평선에 발을 딛는다(bottom: 28%).
 * 캐릭터 키는 --gs-h 하나로 관리하고, 총알 높이도 여기서 파생시킨다.
 */

export type ArenaPhase = 'waiting' | 'signal' | 'result'

export interface Fighter {
  name: string
  pose: Pose
  outfit: Outfit
  hp: number
  ms: Ms
  /** 쌓인 부정출발 경고 (이름표에 ⚠ 로 표시) */
  fouls: number
  /** 이름표 아래에 뭘 보여줄지 — hp=탄약 / rounds=라운드 점 / none=없음 */
  meter: 'hp' | 'rounds' | 'none'
}

interface ArenaProps {
  phase: ArenaPhase
  round: number
  maxHp: number
  /** 경고 한도 (이름표에 이 개수만큼 칸을 그린다). 0 이면 경고 표시 안 함 */
  maxFouls: number
  totalRounds: number
  left: Fighter
  right: Fighter
  /** 결과에서 상대를 쏜 쪽 — 뷰 기준(1=왼쪽 · 2=오른쪽 · 0=아무도) */
  winner: 0 | 1 | 2
  tie: boolean
  /** 부정출발한 쪽 — 뷰 기준. 0 이 아니면 파울 라운드 */
  foulSide: 0 | 1 | 2
  /** 경고가 차서 자기 발을 쏜 라운드인가 */
  selfShot: boolean
  /** 이번 라운드로 승부가 끝났는가 (K.O. 문구) */
  ko: boolean
  /** 온라인: 내 기록은 나왔고 상대를 기다리는 중 */
  pending: boolean
  /** 대기 중 조작 안내 */
  hint: string
  /** 신호 순간의 조작 라벨 (SPACE · 휘둘러! · TAP) */
  actLabel: string
  /** 라운드마다 증가 — 연출 애니메이션을 처음부터 다시 재생시킨다 */
  fxKey: number
  /** 결과 헤드라인을 직접 지정 (기록 도전 모드의 ms/등급 표시용) */
  headlineOverride?: { big: string; sub: string; color: string } | null
  /** 위에 겹칠 것들 (탭 존, 오버레이 등) */
  children?: ReactNode
}

/** 국면별 하늘 — 신호가 뜨면 황야 전체가 초록으로 뒤집힌다 */
function sky(phase: ArenaPhase): string {
  if (phase === 'signal')
    return 'linear-gradient(#02130d 0%, #0b3a25 32%, #17794a 60%, #35c06a 82%, #a7f3c4 100%)'
  if (phase === 'result')
    return 'linear-gradient(#14060f 0%, #33101f 34%, #6d2422 62%, #a94a26 84%, #cf8236 100%)'
  return 'linear-gradient(#1a0a18 0%, #431330 34%, #8d2f2c 62%, #d4622c 84%, #f5a944 100%)'
}

/** 국면별 땅 */
function ground(phase: ArenaPhase): string {
  if (phase === 'signal') return 'linear-gradient(#33955a 0%, #145030 26%, #071c13 70%, #030b08 100%)'
  if (phase === 'result') return 'linear-gradient(#8a4526 0%, #4a2016 26%, #1a0a0b 70%, #0a0405 100%)'
  return 'linear-gradient(#a35a2c 0%, #5d2a19 26%, #210d0d 70%, #0c0506 100%)'
}

/** 국면별 태양 */
function sun(phase: ArenaPhase): string {
  if (phase === 'signal')
    return 'radial-gradient(circle, #f0fff5 0%, #86efac 38%, #34d399 66%, rgba(16,185,129,0) 72%)'
  return 'radial-gradient(circle, #fff3cd 0%, #ffcf72 34%, #ff9a3c 60%, rgba(232,83,42,0) 72%)'
}

export default function Arena({
  phase,
  round,
  maxHp,
  maxFouls,
  totalRounds,
  left,
  right,
  winner,
  tie,
  foulSide,
  selfShot,
  ko,
  pending,
  hint,
  actLabel,
  fxKey,
  headlineOverride = null,
  children,
}: ArenaProps) {
  const green = phase === 'signal'
  const settled = phase === 'result' && !pending
  // 상대를 향해 총알이 날아가는 라운드 (파울 라운드는 상대에게 안 간다)
  const firing = settled && foulSide === 0 && (tie || winner !== 0)
  // 파울 라운드 — 총알은 자기 발밑으로 (경고면 땅, 경고 소진이면 자기 발)
  const foulShot = settled && foulSide !== 0

  return (
    <div
      key={`arena-${fxKey}`}
      className={`relative flex-1 w-full overflow-hidden ${firing || foulShot ? 'animate-qd-shake' : ''}`}
      style={{ ['--gs-h' as string]: 'clamp(112px, 25vh, 208px)' }}
    >
      {/* ── 하늘 ── */}
      <div className="absolute inset-x-0 top-0" style={{ height: '72%', background: sky(phase) }} />

      {/* 태양 후광 → 태양 (지평선에 반쯤 걸려 있다) */}
      <div
        className="absolute rounded-full"
        style={{
          left: '50%',
          top: '72%',
          width: '124vmin',
          aspectRatio: '1',
          transform: 'translate(-50%,-50%)',
          background: green
            ? 'radial-gradient(circle, rgba(52,211,153,0.36) 0%, rgba(52,211,153,0) 60%)'
            : 'radial-gradient(circle, rgba(255,138,60,0.34) 0%, rgba(255,90,40,0) 60%)',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          left: '50%',
          top: '72%',
          width: 'clamp(150px, 42vmin, 330px)',
          aspectRatio: '1',
          transform: 'translate(-50%,-50%)',
          background: sun(phase),
        }}
      />

      {/* 원경 메사(테이블 마운틴) 실루엣 */}
      <svg
        className="absolute inset-x-0"
        style={{ top: '43%', height: '29%' }}
        viewBox="0 0 400 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <polygon
          points="0,100 0,70 30,66 44,44 84,44 96,64 132,66 152,26 198,26 210,54 252,58 272,34 306,34 322,60 356,56 376,70 400,66 400,100"
          fill={green ? '#0c3f28' : '#40152a'}
          opacity="0.9"
        />
      </svg>
      {/* 근경 능선 */}
      <svg
        className="absolute inset-x-0"
        style={{ top: '62%', height: '10.5%' }}
        viewBox="0 0 400 40"
        preserveAspectRatio="none"
        aria-hidden
      >
        <polygon
          points="0,40 0,27 42,20 92,25 142,14 202,19 252,12 312,21 360,16 400,23 400,40"
          fill={green ? '#04251a' : '#26091a'}
        />
      </svg>

      {/* 지평선 열기 (모래 먼지가 빛을 먹는 느낌) */}
      <div
        className="absolute inset-x-0"
        style={{
          top: '69%',
          height: '7%',
          background: green
            ? 'linear-gradient(rgba(167,243,196,0), rgba(167,243,196,0.5), rgba(167,243,196,0))'
            : 'linear-gradient(rgba(255,196,120,0), rgba(255,196,120,0.55), rgba(255,196,120,0))',
          filter: 'blur(7px)',
        }}
      />

      {/* ── 땅 ── */}
      <div className="absolute inset-x-0 bottom-0" style={{ height: '28%', background: ground(phase) }} />
      {/* 모래 결 */}
      <div
        className="absolute inset-x-0 bottom-0 opacity-25"
        style={{
          height: '28%',
          background: 'repeating-linear-gradient(94deg, rgba(0,0,0,0.35) 0 2px, rgba(0,0,0,0) 2px 22px)',
        }}
      />

      {/* ── 배경 소품 ── */}
      <div className="absolute" style={{ left: '2%', bottom: '25%', height: 'calc(var(--gs-h) * 0.6)' }}>
        <Cactus green={green} />
      </div>
      <div className="absolute" style={{ right: '3%', bottom: '26.5%', height: 'calc(var(--gs-h) * 0.42)' }}>
        <Cactus green={green} />
      </div>
      <div className="absolute" style={{ left: '35%', bottom: '27.4%', height: 'calc(var(--gs-h) * 0.2)' }}>
        <Fence green={green} />
      </div>
      {phase === 'waiting' && (
        <div className="absolute animate-qd-tumble" style={{ bottom: '18%', height: 'calc(var(--gs-h) * 0.15)' }}>
          <Tumbleweed />
        </div>
      )}

      {/* 어둡게 조이는 비네트 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(120% 90% at 50% 52%, transparent 38%, rgba(6,2,4,0.74) 100%)' }}
      />

      {/* ── 신호등 ── */}
      <SignalLamp phase={phase} round={round} />

      {/* ── 이름표 + 체력 ── */}
      <div className="absolute" style={{ top: 50, left: 12 }}>
        <Plate f={left} maxHp={maxHp} maxFouls={maxFouls} totalRounds={totalRounds} round={round} align="left" />
      </div>
      <div className="absolute" style={{ top: 50, right: 12 }}>
        <Plate f={right} maxHp={maxHp} maxFouls={maxFouls} totalRounds={totalRounds} round={round} align="right" />
      </div>

      {/* ── 총잡이 두 명 ── */}
      <div
        className="absolute"
        style={{ left: '17%', bottom: '28%', transform: 'translateX(-50%)' }}
      >
        <Gunslinger pose={left.pose} outfit={left.outfit} fxKey={fxKey} height="var(--gs-h)" />
      </div>
      <div
        className="absolute"
        style={{ right: '17%', bottom: '28%', transform: 'translateX(50%)' }}
      >
        <Gunslinger pose={right.pose} outfit={right.outfit} flip fxKey={fxKey} height="var(--gs-h)" />
      </div>

      {/* ── 총알 (가슴 높이로 날아간다) ── */}
      {firing && (
        <div
          className="absolute pointer-events-none"
          style={{ left: '24%', right: '24%', bottom: 'calc(28% + var(--gs-h) * 0.5)', height: 0 }}
        >
          {tie ? (
            <>
              <Bullet dir="r" clash color={left.outfit.rim} />
              <Bullet dir="l" clash color={right.outfit.rim} />
              <Clash />
            </>
          ) : (
            <Bullet dir={winner === 1 ? 'r' : 'l'} color={(winner === 1 ? left : right).outfit.rim} />
          )}
        </div>
      )}

      {/* ── 파울: 총알이 자기 발밑으로 (상대에게 가지 않는다) ── */}
      {foulShot && (
        <div
          className="absolute pointer-events-none"
          style={{
            [foulSide === 1 ? 'left' : 'right']: '17%',
            bottom: '28%',
            transform: `translateX(${foulSide === 1 ? '-50%' : '50%'})`,
          }}
        >
          {/* 발밑 흙먼지 — 경고 소진(자기 발)이면 더 붉고 크게 */}
          <div
            className="absolute animate-qd-dust"
            style={{
              left: '50%',
              bottom: 0,
              width: selfShot ? 'calc(var(--gs-h) * 0.62)' : 'calc(var(--gs-h) * 0.44)',
              aspectRatio: '1',
              transform: 'translateX(-50%)',
              borderRadius: 999,
              animationDelay: `${BULLET_MS}ms`,
              background: selfShot
                ? 'radial-gradient(circle, #fff 0%, #ffd0a0 22%, rgba(239,68,68,0.8) 48%, rgba(120,53,15,0) 72%)'
                : 'radial-gradient(circle, #ffe9c2 0%, rgba(214,150,90,0.7) 34%, rgba(120,80,40,0) 70%)',
            }}
          />
        </div>
      )}

      {/* 피격 섬광 — 총알이 닿는 순간 맞은 쪽에서 터진다 */}
      {firing && !tie && (
        <div
          className="absolute pointer-events-none animate-qd-impact"
          style={{
            [winner === 1 ? 'right' : 'left']: '17%',
            bottom: 'calc(28% + var(--gs-h) * 0.4)',
            width: 'calc(var(--gs-h) * 0.52)',
            aspectRatio: '1',
            transform: `translateX(${winner === 1 ? '50%' : '-50%'})`,
            animationDelay: `${BULLET_MS}ms`,
            borderRadius: 999,
            background:
              'radial-gradient(circle, #fff 0%, #ffd9a0 26%, rgba(239,68,68,0.85) 52%, rgba(239,68,68,0) 72%)',
          }}
        />
      )}

      {/* ── 중앙 헤드라인 ── */}
      <Headline
        phase={phase}
        winner={winner}
        tie={tie}
        foulSide={foulSide}
        selfShot={selfShot}
        maxFouls={maxFouls}
        ko={ko}
        pending={pending}
        left={left}
        right={right}
        hint={hint}
        actLabel={actLabel}
        override={headlineOverride}
      />

      {/* ── 발밑 기록표 ── */}
      {phase === 'result' && (
        <>
          <TimeTag ms={left.ms} won={winner === 1} tie={tie} side="left" />
          <TimeTag ms={right.ms} won={winner === 2} tie={tie} side="right" />
        </>
      )}

      {children}
    </div>
  )
}

/* ============================================================
   신호등 — 빨강(대기) → 초록(뽑아!)
   ============================================================ */
function SignalLamp({ phase, round }: { phase: ArenaPhase; round: number }) {
  const green = phase === 'signal'
  const dim = phase === 'result'
  const glow = green ? '#4ade80' : dim ? '#5b2323' : '#ef4444'

  return (
    <div
      className={`absolute left-1/2 flex flex-col items-center pointer-events-none ${
        phase === 'waiting' ? 'animate-qd-sway' : ''
      }`}
      style={{
        top: 0,
        transform: 'translateX(-50%)',
        transformOrigin: '50% 0%',
      }}
    >
      {/* 매달린 줄 */}
      <div style={{ width: 3, height: 'clamp(12px, 3vh, 28px)', background: 'linear-gradient(#8a6a4a, #4b3524)' }} />
      {/* 고리 */}
      <div
        style={{
          width: 14,
          height: 8,
          borderRadius: 999,
          border: '2.5px solid #6b4f36',
          borderBottom: 'none',
          marginBottom: -2,
        }}
      />
      {/* 등 */}
      <div
        key={green ? 'g' : dim ? 'd' : 'r'}
        className={green ? 'animate-qd-lamp-pop' : ''}
        style={{
          position: 'relative',
          width: 'clamp(50px, 11vh, 76px)',
          aspectRatio: '1',
          borderRadius: 999,
          border: '3px solid #2a1a12',
          background: green
            ? 'radial-gradient(circle at 40% 34%, #ffffff 0%, #86efac 30%, #22c55e 62%, #14532d 100%)'
            : dim
              ? 'radial-gradient(circle at 40% 34%, #6b3030 0%, #3d1a1a 60%, #180a0a 100%)'
              : 'radial-gradient(circle at 40% 34%, #ffd0d0 0%, #ef4444 32%, #b91c1c 64%, #450a0a 100%)',
          boxShadow: `0 0 ${green ? 48 : 24}px ${glow}, inset 0 0 14px rgba(0,0,0,0.45)`,
        }}
      >
        {/* 철제 살 */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'linear-gradient(90deg, transparent 46%, rgba(20,10,8,0.7) 46%, rgba(20,10,8,0.7) 54%, transparent 54%)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'linear-gradient(0deg, transparent 46%, rgba(20,10,8,0.5) 46%, rgba(20,10,8,0.5) 54%, transparent 54%)',
          }}
        />
      </div>
      {/* 라운드 나무 간판 */}
      <div
        className="mt-1.5 px-3 py-0.5 rounded-[3px] label-mono"
        style={{
          background: 'linear-gradient(#6b4429, #472c1a)',
          border: '1px solid #2a1a10',
          color: '#f0d8b0',
          boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
          fontSize: 10,
        }}
      >
        ROUND {round}
      </div>
    </div>
  )
}

/* ============================================================
   이름표 + 체력(탄약)
   ============================================================ */
function Plate({
  f,
  maxHp,
  maxFouls,
  totalRounds,
  round,
  align,
}: {
  f: Fighter
  maxHp: number
  maxFouls: number
  totalRounds: number
  round: number
  align: 'left' | 'right'
}) {
  const dead = f.meter === 'hp' && f.hp <= 0
  return (
    <div className={`flex flex-col ${align === 'right' ? 'items-end' : 'items-start'} gap-1`}>
      <div
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
        style={{ background: 'rgba(12,4,8,0.6)', border: `1px solid ${f.outfit.scarf}66` }}
      >
        <span className="w-2 h-2 rounded-full" style={{ background: f.outfit.scarf, opacity: dead ? 0.3 : 1 }} />
        <span
          className="text-xs font-black tracking-wide whitespace-nowrap"
          style={{ color: dead ? 'rgba(255,255,255,0.35)' : '#f4e6d0' }}
        >
          {f.name}
        </span>
        {/* 부정출발 경고 — 차면 자기 발을 쏜다 */}
        {maxFouls > 0 && (
          <span className="flex gap-0.5 items-center">
            {Array.from({ length: maxFouls }).map((_, i) => (
              <Warn key={i} lit={i < f.fouls} />
            ))}
          </span>
        )}
      </div>

      {f.meter === 'hp' && (
        <div className={`flex gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          {Array.from({ length: maxHp }).map((_, i) => (
            <Shell key={i} live={i < f.hp} />
          ))}
        </div>
      )}
      {f.meter === 'rounds' && (
        <div className={`flex gap-1 items-center ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          {Array.from({ length: totalRounds }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 rounded-full"
              style={{
                width: i + 1 === round ? 14 : 6,
                background: i + 1 <= round ? f.outfit.scarf : 'rgba(255,255,255,0.22)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** 경고 한 칸 — 부정출발 누적 표시 (작은 삼각형) */
function Warn({ lit }: { lit: boolean }) {
  return (
    <span
      className="block"
      style={{
        width: 0,
        height: 0,
        borderLeft: '4.5px solid transparent',
        borderRight: '4.5px solid transparent',
        borderBottom: `8px solid ${lit ? '#fbbf24' : 'rgba(255,255,255,0.2)'}`,
        filter: lit ? 'drop-shadow(0 0 4px rgba(251,191,36,0.9))' : undefined,
      }}
    />
  )
}

/** 체력 한 칸 = 탄약 한 발 (맞으면 빈 탄피) */
function Shell({ live }: { live: boolean }) {
  return (
    <span
      className="block"
      style={{
        width: 8,
        height: 15,
        borderRadius: '2px 2px 3px 3px',
        background: live
          ? 'linear-gradient(#ffe9a8 0%, #d9a53c 34%, #8a5f18 100%)'
          : 'linear-gradient(rgba(255,255,255,0.1), rgba(255,255,255,0.04))',
        border: live ? '1px solid #6d4a11' : '1px solid rgba(255,255,255,0.18)',
        boxShadow: live ? '0 0 6px rgba(217,165,60,0.5)' : 'none',
      }}
    />
  )
}

/* ============================================================
   총알 / 충돌 스파크
   ============================================================ */
function Bullet({ dir, color, clash = false }: { dir: 'r' | 'l'; color: string; clash?: boolean }) {
  const cls = clash
    ? dir === 'r'
      ? 'animate-qd-bullet-cr'
      : 'animate-qd-bullet-cl'
    : dir === 'r'
      ? 'animate-qd-bullet-r'
      : 'animate-qd-bullet-l'
  return (
    <div className={`absolute ${cls}`} style={{ top: -2 }}>
      {/* 예광탄 꼬리 + 탄두 */}
      <div
        style={{
          width: 'clamp(30px, 7vw, 52px)',
          height: 4,
          borderRadius: 999,
          transform: dir === 'r' ? 'translateX(-100%)' : 'none',
          background:
            dir === 'r'
              ? `linear-gradient(90deg, rgba(255,255,255,0) 0%, ${color}99 60%, #fff 100%)`
              : `linear-gradient(90deg, #fff 0%, ${color}99 40%, rgba(255,255,255,0) 100%)`,
          boxShadow: `0 0 10px ${color}, 0 0 20px ${color}66`,
        }}
      />
    </div>
  )
}

/** Tie — 총알이 공중에서 부딪혀 튄다 */
function Clash() {
  return (
    <div
      className="absolute animate-qd-clash"
      style={{
        left: '50%',
        top: 0,
        width: 'clamp(52px, 13vw, 96px)',
        aspectRatio: '1',
        borderRadius: 999,
        background:
          'radial-gradient(circle, #ffffff 0%, #fff1b8 24%, rgba(251,191,36,0.8) 46%, rgba(251,191,36,0) 70%)',
      }}
    />
  )
}

/* ============================================================
   중앙 헤드라인
   ============================================================ */
function Headline({
  phase,
  winner,
  tie,
  foulSide,
  selfShot,
  maxFouls,
  ko,
  pending,
  left,
  right,
  hint,
  actLabel,
  override,
}: {
  phase: ArenaPhase
  winner: 0 | 1 | 2
  tie: boolean
  foulSide: 0 | 1 | 2
  selfShot: boolean
  maxFouls: number
  ko: boolean
  pending: boolean
  left: Fighter
  right: Fighter
  hint: string
  actLabel: string
  override: { big: string; sub: string; color: string } | null
}) {
  const wrap = 'absolute inset-x-0 flex flex-col items-center pointer-events-none px-4 text-center'

  if (phase === 'waiting') {
    return (
      <div key="w" className={wrap} style={{ top: '31%' }}>
        <div className="label-mono animate-pulse" style={{ color: '#ffb98a', letterSpacing: '0.34em' }}>
          H O L D
        </div>
        <div className="mt-1.5 text-sm font-bold" style={{ color: 'rgba(255,226,196,0.72)' }}>
          {hint}
        </div>
      </div>
    )
  }

  if (phase === 'signal') {
    return (
      <div key="s" className={wrap} style={{ top: '25%' }}>
        <div
          className="font-black animate-signal-pop"
          style={{
            fontSize: 'clamp(48px, 15vw, 104px)',
            lineHeight: 0.92,
            color: '#f0fff5',
            letterSpacing: '-0.02em',
            textShadow: '0 0 34px rgba(74,222,128,0.95), 0 4px 0 #14532d',
          }}
        >
          DRAW!
        </div>
        <div
          className="mt-1 font-black tracking-[0.3em]"
          style={{ color: '#dcfce7', fontSize: 'clamp(13px, 3.4vw, 18px)' }}
        >
          {actLabel}
        </div>
      </div>
    )
  }

  // ── result ──
  if (pending) {
    return (
      <div key="p" className={wrap} style={{ top: '28%' }}>
        <div className="text-4xl font-black tabular-nums" style={{ color: '#ffe9c2' }}>
          {msLabel(left.ms)}
        </div>
        <div className="mt-2 text-sm animate-pulse" style={{ color: 'rgba(255,220,190,0.72)' }}>
          상대가 뽑는 걸 기다린다…
        </div>
      </div>
    )
  }

  // ── 부정출발 ──
  if (foulSide !== 0) {
    const who = foulSide === 1 ? left : right
    const big = selfShot ? '자기 발을 쐈다!' : 'FOUL!'
    const color = selfShot ? '#fca5a5' : '#fbbf24'
    return (
      <div key="f" className={wrap} style={{ top: '24%' }}>
        <div
          className="font-black animate-qd-slam"
          style={{
            fontSize: selfShot ? 'clamp(28px, 8.5vw, 60px)' : 'clamp(40px, 12vw, 84px)',
            lineHeight: 0.95,
            color,
            animationDelay: `${BULLET_MS}ms`,
            textShadow: `0 0 30px ${color}aa, 0 4px 0 rgba(0,0,0,0.55)`,
          }}
        >
          {big}
        </div>
        <div
          className="mt-1.5 text-sm font-bold animate-qd-slam"
          style={{ color: 'rgba(255,232,205,0.9)', animationDelay: `${BULLET_MS + 90}ms` }}
        >
          {selfShot
            ? `${who.name} — 경고 ${maxFouls}/${maxFouls} · 1발 잃는다`
            : `${who.name} — 신호 전에 뽑았다 · 경고 ${who.fouls}/${maxFouls}`}
        </div>
        <div
          className="mt-1 label-mono animate-qd-slam"
          style={{ color: 'rgba(255,220,190,0.6)', animationDelay: `${BULLET_MS + 150}ms` }}
        >
          {selfShot ? '경고 리셋' : '라운드 무효 · 상대 무피해'}
        </div>
      </div>
    )
  }

  if (override) {
    return (
      <div key="o" className={wrap} style={{ top: '25%' }}>
        <div
          className="font-black tabular-nums animate-qd-slam"
          style={{
            fontSize: 'clamp(38px, 12vw, 82px)',
            lineHeight: 0.95,
            color: override.color,
            animationDelay: `${BULLET_MS}ms`,
            textShadow: `0 0 30px ${override.color}88, 0 4px 0 rgba(0,0,0,0.5)`,
          }}
        >
          {override.big}
        </div>
        <div
          className="mt-1.5 text-base font-black animate-qd-slam"
          style={{ color: override.color, animationDelay: `${BULLET_MS + 90}ms` }}
        >
          {override.sub}
        </div>
      </div>
    )
  }

  if (tie) {
    return (
      <div key="t" className={wrap} style={{ top: '25%' }}>
        <div
          className="font-black animate-qd-slam"
          style={{
            fontSize: 'clamp(44px, 13vw, 92px)',
            lineHeight: 0.95,
            color: '#fde68a',
            animationDelay: `${BULLET_MS}ms`,
            textShadow: '0 0 30px rgba(251,191,36,0.85), 0 4px 0 #78350f',
          }}
        >
          TIE
        </div>
        <div
          className="mt-1 text-sm font-bold animate-qd-slam"
          style={{ color: 'rgba(253,230,138,0.85)', animationDelay: `${BULLET_MS + 90}ms` }}
        >
          {isClean(left.ms) && isClean(right.ms)
            ? `1ms 까지 똑같다 — 둘 다 ${left.ms}ms`
            : '둘 다 놓쳤다 — 다시 간다'}
        </div>
      </div>
    )
  }

  if (winner === 0) return null

  // 정상 승부 — 부정출발은 위에서 이미 처리했다
  const shooter = winner === 1 ? left : right

  return (
    <div key="r" className={wrap} style={{ top: '24%' }}>
      <div
        className="font-black animate-qd-slam"
        style={{
          fontSize: ko ? 'clamp(44px, 13vw, 92px)' : 'clamp(34px, 10vw, 70px)',
          lineHeight: 0.95,
          color: ko ? '#fca5a5' : '#fff1d6',
          animationDelay: `${BULLET_MS}ms`,
          textShadow: `0 0 30px ${shooter.outfit.scarf}, 0 4px 0 rgba(0,0,0,0.5)`,
        }}
      >
        {ko ? 'K.O.' : 'HIT!'}
      </div>
      <div
        className="mt-1.5 text-sm font-bold animate-qd-slam"
        style={{ color: 'rgba(255,232,205,0.88)', animationDelay: `${BULLET_MS + 90}ms` }}
      >
        {shooter.name} — 먼저 뽑았다
      </div>
    </div>
  )
}

/** 발밑 기록표 */
function TimeTag({ ms, won, tie, side }: { ms: Ms; won: boolean; tie: boolean; side: 'left' | 'right' }) {
  if (ms == null) return null
  const good = isClean(ms)
  const color = tie ? '#fde68a' : won ? '#86efac' : good ? '#fca5a5' : '#f87171'
  return (
    <div
      className="absolute animate-qd-slam pointer-events-none"
      style={{
        [side]: '17%',
        bottom: 'calc(28% - 30px)',
        transform: `translateX(${side === 'left' ? '-50%' : '50%'})`,
        animationDelay: `${BULLET_MS}ms`,
      }}
    >
      <span
        className="rounded-md px-2 py-0.5 text-xs font-black tabular-nums whitespace-nowrap"
        style={{ background: 'rgba(8,3,5,0.72)', color, border: `1px solid ${color}55` }}
      >
        {msLabel(ms)}
      </span>
    </div>
  )
}

/* ============================================================
   배경 소품
   ============================================================ */
function Cactus({ green }: { green: boolean }) {
  const c = green ? '#04251a' : '#22071a'
  return (
    <svg viewBox="0 0 40 80" height="100%" aria-hidden>
      <g stroke={c} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 79 L20 10" strokeWidth="10" />
        <path d="M20 42 L11 42 L11 24" strokeWidth="7" />
        <path d="M20 54 L30 54 L30 34" strokeWidth="7" />
      </g>
    </svg>
  )
}

function Fence({ green }: { green: boolean }) {
  const c = green ? '#04251a' : '#1e0616'
  return (
    <svg viewBox="0 0 90 40" height="100%" aria-hidden>
      <g fill={c}>
        <rect x="4" y="4" width="6" height="36" />
        <rect x="42" y="0" width="6" height="40" />
        <rect x="80" y="6" width="6" height="34" />
      </g>
      <g stroke={c} strokeWidth="2.5" fill="none">
        <path d="M6 14 L45 10 L83 16" />
        <path d="M6 26 L45 22 L83 28" />
      </g>
    </svg>
  )
}

function Tumbleweed() {
  return (
    <svg viewBox="0 0 40 40" height="100%" className="animate-qd-roll" aria-hidden>
      <g stroke="#2a0d18" strokeWidth="2.5" fill="none" strokeLinecap="round">
        <circle cx="20" cy="20" r="16" />
        <path d="M6 12 L34 26 M6 28 L34 14 M20 4 L20 36 M4 20 L36 20" />
      </g>
    </svg>
  )
}
