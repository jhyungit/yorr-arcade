import assert from 'node:assert/strict'
import { rankRows, weekKey } from '../server/ranking.js'

// 주 경계: KST 월 00:00 = UTC 일 15:00
assert.equal(weekKey(Date.parse('2026-10-11T14:59:59Z')), 'weekly:2026-10-05') // KST 일 23:59
assert.equal(weekKey(Date.parse('2026-10-11T15:00:00Z')), 'weekly:2026-10-12') // KST 월 00:00
assert.equal(weekKey(Date.parse('2026-10-18T14:00:00Z')), 'weekly:2026-10-12') // KST 일 23:00

// 동점은 같은 등수, 다음은 건너뜀
assert.deepEqual(
  rankRows(['a', '300', 'b', '250', 'c', '250', 'd', '100']).map((r) => r.rank),
  [1, 2, 2, 4],
)
console.log('ranking ok')
