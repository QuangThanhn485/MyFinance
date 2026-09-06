/**
 * Đồng hồ đơn điệu dùng cho mọi timestamp nghiệp vụ (updatedAt, createdAt...).
 *
 * - Không bao giờ lùi trên cùng một thiết bị, kể cả khi người dùng chỉnh giờ máy.
 * - Có thể hiệu chỉnh theo lệch giờ đo được từ server (Redis TIME) để tie-break
 *   giữa các thiết bị công bằng hơn.
 */

let lastIssuedMs = 0
let skewMs = 0

export function setClockSkewMs(ms: number) {
  if (!Number.isFinite(ms)) return
  // Giới hạn hiệu chỉnh trong ±1 ngày để một phép đo sai không phá thứ tự vĩnh viễn.
  skewMs = Math.max(-86_400_000, Math.min(86_400_000, Math.trunc(ms)))
}

export function getClockSkewMs() {
  return skewMs
}

export function seedLastIssuedMs(ms: number) {
  if (Number.isFinite(ms) && ms > lastIssuedMs) lastIssuedMs = Math.trunc(ms)
}

export function getLastIssuedMs() {
  return lastIssuedMs
}

export function monotonicNowMs() {
  const wall = Date.now() + skewMs
  // Nếu lastIssued đi trước quá 1 ngày (do một lần nhiễm giờ tương lai), bỏ neo cũ.
  if (lastIssuedMs > wall + 86_400_000) lastIssuedMs = wall
  const next = Math.max(wall, lastIssuedMs + 1)
  lastIssuedMs = next
  return next
}

export function monotonicIso() {
  return new Date(monotonicNowMs()).toISOString()
}
