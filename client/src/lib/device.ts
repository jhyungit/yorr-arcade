/**
 * device.ts — 입력 장치 대략 감지
 * -------------------------------------------------------------
 * 이 기기가 "물리 키보드가 있을 법한" 노트북/PC 인지, 터치 위주 폰인지 구분한다.
 * 왜? 게임마다 조작이 달라서(리듬=D F J K, 반응=스페이스) 안내 문구/키 표시를
 *     "키보드가 있는 기기"에만 보여주려고. 폰에서 "스페이스"를 안내하면 헷갈린다.
 *
 * 판정 기준: 주 포인터가 정밀(fine)한가 → 마우스/트랙패드가 주 입력이면 노트북/PC로 본다.
 *  - 노트북/데스크톱: (pointer: fine) = true
 *  - 폰/태블릿:       (pointer: fine) = false (coarse=손가락)
 * (터치스크린 노트북도 주 포인터는 보통 트랙패드라 fine → 키보드 안내가 나온다: 의도한 동작)
 */
export const likelyKeyboard =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: fine)').matches
