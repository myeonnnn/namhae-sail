// OpenStreetMap의 자료를 조회하는 Overpass API에 질의를 보낸다.

// 공용 서버는 혼잡할 때 요청을 거절(429, 504)하므로, 순서대로 시도한다.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const RETRY_DELAY_MS = 15000;

/**
 * @param {string} query Overpass QL로 작성한 질의
 * @param {{ purpose: string, attempts?: number }} options purpose는 서버의 운영자가 요청의 용도를 알 수 있도록 User-Agent에 적는다.
 */
export async function queryOverpass(query, { purpose, attempts = 3 }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((done) => setTimeout(done, RETRY_DELAY_MS));
    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': `namhae-sail (${purpose})`,
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (response.ok) return await response.json();
        console.warn(`${endpoint}: HTTP ${response.status}`);
      } catch (error) {
        console.warn(`${endpoint}: ${error.message}`);
      }
    }
  }
  throw new Error('모든 Overpass 서버에서 요청이 실패했습니다. 잠시 후에 다시 실행하세요.');
}
