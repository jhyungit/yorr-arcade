import { useId } from 'react'

/**
 * Gunslinger — 총잡이 캐릭터 (인라인 SVG, 외부 에셋 0)
 * -------------------------------------------------------------
 * 석양을 등진 실루엣 + 따뜻한 림라이트로 그린다.
 * 기본 방향은 "오른쪽을 향해 서 있는" 모습이고, flip 으로 좌우를 뒤집는다.
 *
 * 포즈:
 *  - ready : 홀스터 위에 손을 얹고 노려보는 대기 자세
 *  - draw  : 뽑아서 겨눈 자세 (+ 총구 화염)
 *  - hit   : 총알을 맞고 뒤로 젖혀지는 자세
 *  - dead  : 뒤로 넘어가 쓰러진 자세 (모자가 벗겨져 굴러간다)
 *
 * 팔은 어깨/팔꿈치 두 관절을 각도로만 돌린다(rotate 속성).
 * 퀵드로우는 "한 프레임에 뽑히는" 게 맛이라 보간 없이 스냅으로 바꾸고,
 * 반동/넉백만 CSS 애니메이션으로 얹는다.
 */

export type Pose = 'ready' | 'draw' | 'hit' | 'dead'

/** 진영 색 — 스카프·모자띠·총구 화염에 쓰여 두 캐릭터를 구분한다 */
export interface Outfit {
  scarf: string // 스카프/모자띠 (진영 색)
  rim: string // 림라이트 (석양 반사)
}

export const OUTFIT_LEFT: Outfit = { scarf: '#e0483a', rim: '#ffb56b' }
export const OUTFIT_RIGHT: Outfit = { scarf: '#38bdf8', rim: '#ffd08a' }

/** 포즈별 팔 각도 — [어깨, 팔꿈치] (deg, SVG rotate) */
const ARM: Record<Pose, [number, number]> = {
  ready: [12, 8], // 아래로 내려 홀스터 위에 손
  draw: [-72, -22], // 앞으로 뻗어 수평 조준
  hit: [-138, 34], // 위로 튕겨 올라감
  dead: [-28, 18], // 늘어짐
}

interface GunslingerProps {
  pose: Pose
  outfit: Outfit
  flip?: boolean // true = 왼쪽을 향해 서기 (오른쪽 진영)
  /** 총을 쏜 라운드마다 바뀌는 키 — 반동/화염 애니메이션을 다시 재생시킨다 */
  fxKey?: number
  height?: number | string
}

export default function Gunslinger({
  pose,
  outfit,
  flip = false,
  fxKey = 0,
  height = '100%',
}: GunslingerProps) {
  const [ua, fa] = ARM[pose]
  const armed = pose === 'draw' // 총을 뽑아 든 상태
  const down = pose === 'dead'
  // 한 화면에 여러 총잡이가 있어도 그라디언트가 섞이지 않게 인스턴스별 id
  const gradId = `gs-body-${useId().replace(/:/g, '')}`

  return (
    <svg
      viewBox="0 0 120 180"
      height={height}
      style={{ transform: flip ? 'scaleX(-1)' : undefined, overflow: 'visible' }}
      aria-hidden
    >
      <defs>
        {/* 몸통: 앞쪽(석양 반대)이 살짝 밝고 뒤로 갈수록 새카맣게 */}
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0b0409" />
          <stop offset="60%" stopColor="#1c0e17" />
          <stop offset="100%" stopColor="#3a1c22" />
        </linearGradient>
      </defs>

      {/* 접지 그림자 — 석양이 낮아 길게 늘어진다 */}
      <ellipse cx="58" cy="176" rx={down ? 46 : 26} ry="5" fill="rgba(20,4,8,0.55)" />

      {/* 쓰러졌으면 몸 전체를 발끝 기준으로 뒤로 넘긴다 */}
      <g
        key={`body-${pose}-${fxKey}`}
        className={pose === 'hit' ? 'animate-gs-knockback' : down ? 'animate-gs-fall' : undefined}
        style={down ? { transform: 'rotate(-78deg)', transformOrigin: '58px 172px' } : undefined}
      >
        <Body outfit={outfit} gradId={gradId} hatless={down} />

        {/* 총 든 팔 (어깨 → 팔꿈치 → 손/리볼버) */}
        <g transform={`translate(54 64) rotate(${ua})`}>
          <path d="M -5.5 -5 L 5.5 -5 L 4 25 L -4 25 Z" fill="#150a11" />
          <g
            transform={`translate(0 25) rotate(${fa})`}
            className={armed ? 'animate-gs-recoil' : undefined}
          >
            <path d="M -4.2 0 L 4.2 0 L 3.2 21 L -3.2 21 Z" fill="#1c0e17" />
            {/* 손 */}
            <circle cx="0" cy="23" r="4.2" fill="#241118" />
            {armed ? <Revolver flash={outfit.rim} /> : null}
          </g>
        </g>

        {/* 대기 자세에서는 허리에 홀스터가 보인다 */}
        {pose === 'ready' && (
          <g>
            <path d="M 46 104 L 58 104 L 56 122 L 47 121 Z" fill="#2b1410" />
            <path d="M 48 100 L 57 100 L 56.5 106 L 48.5 106 Z" fill="#3d1d16" />
            <path d="M 42 98 L 62 98 L 62 103 L 42 103 Z" fill="#33170f" />
          </g>
        )}
      </g>

      {/* 쓰러질 때 벗겨져 굴러간 모자 */}
      {down && (
        <g className="animate-gs-hatoff">
          <ellipse cx="96" cy="171" rx="17" ry="4.5" fill="#150a11" />
          <path d="M 87 171 Q 96 158 105 171 Z" fill="#1e0f16" />
          <path d="M 87.5 168 Q 96 165 104.5 168 L 104 171 L 88 171 Z" fill={outfit.scarf} opacity="0.85" />
        </g>
      )}
    </svg>
  )
}

/** 몸통·다리·모자 — 넓게 벌린 결투 자세의 실루엣 */
function Body({
  outfit,
  gradId,
  hatless,
}: {
  outfit: Outfit
  gradId: string
  hatless: boolean
}) {
  return (
    <g>
      {/* 뒤로 날리는 더스터 코트 자락 */}
      <path
        className="animate-gs-coat"
        d="M 44 72 L 24 136 L 41 130 L 45 106 Z"
        fill="#100610"
        style={{ transformOrigin: '45px 74px' }}
      />

      {/* 다리 — 좌우로 벌린 스탠스 (뒷다리 먼저) */}
      <path d="M 50 100 L 63 100 L 53 168 L 38 168 Z" fill="#100710" />
      <path d="M 36 164 L 55 164 L 56 172 L 34 172 Z" fill="#0a0409" />
      <path d="M 61 100 L 74 100 L 89 168 L 74 168 Z" fill={`url(#${gradId})`} />
      <path d="M 72 164 L 91 164 L 92 172 L 70 172 Z" fill="#0a0409" />

      {/* 벨트 */}
      <path d="M 43 96 L 79 96 L 80 104 L 42 104 Z" fill="#0d0509" />
      <rect x="57" y="96" width="8" height="8" rx="1.5" fill={outfit.scarf} opacity="0.8" />

      {/* 상체 (어깨 살짝 둥글게) */}
      <path d="M 45 62 Q 60 52 76 62 L 80 98 L 42 98 Z" fill={`url(#${gradId})`} />

      {/* 스카프 */}
      <path d="M 50 58 L 72 58 L 62 76 Z" fill={outfit.scarf} />
      <path d="M 62 76 L 56 74 L 58 66 Z" fill={outfit.scarf} opacity="0.7" />

      {/* 목·머리 */}
      <rect x="55" y="48" width="12" height="10" fill="#150a11" />
      <circle cx="61" cy="45" r="10" fill="#1a0c13" />

      {!hatless && (
        <g>
          {/* 챙 — 이 게임에서 가장 알아보기 쉬운 실루엣이라 크게 */}
          <ellipse cx="59" cy="38" rx="37" ry="6.5" fill="#150a11" transform="rotate(-3 59 38)" />
          {/* 크라운 */}
          <path d="M 43 38 L 46 17 Q 60 9 75 17 L 78 38 Z" fill="#1c0e17" />
          {/* 모자띠 (진영 색) */}
          <path d="M 43.4 34 Q 60 30 77.6 34 L 78 38 L 43 38 Z" fill={outfit.scarf} opacity="0.9" />
          {/* 챙 앞쪽 림라이트 */}
          <path
            d="M 78 34 Q 92 36 96 38.5 Q 90 41 78 41.5 Z"
            fill={outfit.rim}
            opacity="0.35"
          />
        </g>
      )}

      {/* 앞쪽 윤곽 림라이트 — 석양이 몸의 앞선을 훑는다 */}
      <path
        d="M 76 62 L 80 98 L 80.5 104 L 74 100 L 74.5 64 Z"
        fill={outfit.rim}
        opacity="0.3"
      />
    </g>
  )
}

/** 리볼버 — 손 위치에서 팔 방향(+y)으로 뻗는다 */
function Revolver({ flash }: { flash: string }) {
  return (
    <g>
      {/* 손잡이 */}
      <path d="M -4.5 17 L 1.5 19 L 0.5 27 L -5.5 25 Z" fill="#2b1a14" />
      {/* 실린더·프레임 */}
      <rect x="-3" y="22" width="6.5" height="8" rx="1.8" fill="#3a3a44" />
      {/* 배럴 */}
      <rect x="-1.6" y="29" width="3.4" height="14" rx="1.2" fill="#4a4a56" />
      {/* 총구 화염 */}
      <g className="animate-gs-muzzle" style={{ transformOrigin: '0px 43px' }}>
        <path d="M 0 60 L -7 45 L -2.5 43.5 L 0 30 L 2.5 43.5 L 7 45 Z" fill={flash} />
        <circle cx="0" cy="44" r="6.5" fill="#fff3d0" opacity="0.9" />
        <circle cx="0" cy="46" r="12" fill={flash} opacity="0.28" />
      </g>
    </g>
  )
}
