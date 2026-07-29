import { useEffect, useState } from 'react'

/**
 * QrCode — 인라인 SVG QR 코드
 * -------------------------------------------------------------
 * 외부 이미지를 안 쓴다는 이 프로젝트 원칙에 맞춰, QR 도 이미지 파일이나
 * 외부 API 없이 **모듈 격자를 직접 SVG path 로 그린다.**
 * qrcode 의 create() 로 격자만 얻고(인코딩은 검증된 구현에 맡긴다),
 * 그리는 건 우리가 한다 → dangerouslySetInnerHTML 없이 크기도 자유롭다.
 *
 * 라이브러리는 **동적 import** 한다. QR 은 폰 연결 패널을 열 때만 필요한데
 * 그것 때문에 게임 첫 로딩이 무거워질 이유가 없다.
 *
 * 만든 QR 이 실제로 읽히는지는 눈으로 알 수 없어서(잘못돼도 그럴싸한 격자가
 * 보인다) test/qr.test.mjs 에서 다시 디코드해 같은 문자열이 나오는지 확인한다.
 */
interface QrCodeProps {
  /** 인코딩할 문자열 (보통 접속 URL) */
  value: string
  /** 한 변 픽셀 (정사각형) */
  size?: number
  /** 어두운 모듈 색 — 밝은 배경 위에 놓는 게 인식률이 좋다 */
  dark?: string
  light?: string
  className?: string
}

export default function QrCode({
  value,
  size = 200,
  dark = '#0a0e16',
  light = '#ffffff',
  className,
}: QrCodeProps) {
  // [모듈 수, path] — 로딩 중엔 null
  const [grid, setGrid] = useState<{ n: number; d: string } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    import('qrcode')
      .then(({ default: QR }) => {
        // 오류정정 M: 살짝 가려도 읽힌다. 폰 카메라로 찍는 용도에 적당하다.
        const m = QR.create(value, { errorCorrectionLevel: 'M' }).modules
        const n = m.size
        let d = ''
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            // 1 = 검은 모듈. 1×1 사각형을 이어 붙여 하나의 path 로 만든다.
            if (m.data[y * n + x]) d += `M${x} ${y}h1v1h-1z`
          }
        }
        if (alive) setGrid({ n, d })
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [value])

  if (failed) return null // QR 을 못 만들면 코드/링크로 대체 (부모가 함께 보여 준다)

  return (
    <div
      className={className}
      style={{ width: size, height: size, background: light, borderRadius: 12, padding: 8 }}
      aria-label="QR 코드"
    >
      {grid && (
        // shapeRendering: 모듈 경계가 흐려지면 인식률이 떨어진다 → 픽셀 스냅
        <svg
          viewBox={`0 0 ${grid.n} ${grid.n}`}
          width="100%"
          height="100%"
          shapeRendering="crispEdges"
        >
          <path d={grid.d} fill={dark} />
        </svg>
      )}
    </div>
  )
}
