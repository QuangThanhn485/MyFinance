// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanupUpstashLegacyKeys,
  downloadUpstashToLocal,
  getRemoteManifest,
  parseUpstashConfigInput,
  uploadLocalToUpstash,
} from "@/storage/dataSource"

const redisMock = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failSetKey: null as string | null,
  failSetValue: null as string | null,
  delCalls: [] as string[][],
}))

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: class Redis {
    async ping() {
      return "PONG"
    }

    async get(key: string) {
      return redisMock.store.get(key) ?? null
    }

    async set(key: string, value: unknown) {
      if (key === redisMock.failSetKey) throw new Error("forced set failure")
      if (value === redisMock.failSetValue) throw new Error("forced set failure")
      redisMock.store.set(key, typeof value === "string" ? value : JSON.stringify(value))
      return "OK"
    }

    async del(...keys: string[]) {
      redisMock.delCalls.push(keys)
      let deleted = 0
      for (const key of keys) {
        if (redisMock.store.delete(key)) deleted += 1
      }
      return deleted
    }

    async scan(cursor: string, opts?: { match?: string }) {
      if (cursor !== "0") return ["0", []]
      const prefix = opts?.match?.endsWith("*") ? opts.match.slice(0, -1) : opts?.match
      const keys = [...redisMock.store.keys()].filter((key) => (prefix ? key.startsWith(prefix) : true))
      return ["0", keys]
    }
  },
}))

const TEST_UPSTASH = { url: "https://example.upstash.io", token: "token-value" }

describe("data source config parsing", () => {
  beforeEach(() => {
    localStorage.clear()
    redisMock.store.clear()
    redisMock.failSetKey = null
    redisMock.failSetValue = null
    redisMock.delCalls = []
  })

  it("keeps raw Upstash URL and token values", () => {
    expect(parseUpstashConfigInput("https://example.upstash.io/", "token-value")).toEqual({
      url: "https://example.upstash.io",
      token: "token-value",
    })
  })

  it("accepts .env style Upstash values", () => {
    expect(
      parseUpstashConfigInput(
        'UPSTASH_REDIS_REST_URL="https://example.upstash.io"',
        'UPSTASH_REDIS_REST_TOKEN="token-value"',
      ),
    ).toEqual({
      url: "https://example.upstash.io",
      token: "token-value",
    })
  })

  it("accepts both .env lines pasted into one field", () => {
    const pasted = [
      'UPSTASH_REDIS_REST_URL="https://example.upstash.io"',
      'UPSTASH_REDIS_REST_TOKEN="token-value"',
    ].join("\n")

    expect(parseUpstashConfigInput(pasted, "")).toEqual({
      url: "https://example.upstash.io",
      token: "token-value",
    })
  })

  it("stores the remote copy as a single snapshot key", async () => {
    localStorage.setItem("cttm_v1", "main-data")
    localStorage.setItem("cttm_backup_last_v1", "backup-data")

    const manifest = await uploadLocalToUpstash(TEST_UPSTASH)

    expect(manifest.keyCount).toBe(2)
    expect(redisMock.store.has("myfinance:storage:snapshot")).toBe(true)
    expect([...redisMock.store.keys()]).toEqual(["myfinance:storage:snapshot"])
  })

  it("cleans legacy versioned keys only when cleanup is explicitly requested", async () => {
    redisMock.store.set("myfinance:storage:manifest", "{}")
    redisMock.store.set("myfinance:storage:key:cttm_v1", "legacy-main")
    redisMock.store.set("myfinance:storage:version:123:key:cttm_v1", "legacy-version")
    localStorage.setItem("cttm_v1", "main-data")

    await uploadLocalToUpstash(TEST_UPSTASH)

    expect(redisMock.store.has("myfinance:storage:manifest")).toBe(true)
    expect(redisMock.store.has("myfinance:storage:key:cttm_v1")).toBe(true)
    expect(redisMock.store.has("myfinance:storage:version:123:key:cttm_v1")).toBe(true)

    await uploadLocalToUpstash(TEST_UPSTASH, { cleanupLegacy: true })

    expect([...redisMock.store.keys()]).toEqual(["myfinance:storage:snapshot"])
    expect(redisMock.delCalls).toHaveLength(1)
    expect(redisMock.delCalls[0]).toEqual(
      expect.arrayContaining([
        "myfinance:storage:manifest",
        "myfinance:storage:key:cttm_v1",
        "myfinance:storage:version:123:key:cttm_v1",
      ]),
    )
  })

  it("does not delete legacy Redis data when no valid snapshot exists yet", async () => {
    redisMock.store.set("myfinance:storage:manifest", "{}")
    redisMock.store.set("myfinance:storage:key:cttm_v1", "legacy-main")
    redisMock.store.set("myfinance:storage:version:123:key:cttm_v1", "legacy-version")

    await cleanupUpstashLegacyKeys(TEST_UPSTASH)

    expect([...redisMock.store.keys()].sort()).toEqual([
      "myfinance:storage:key:cttm_v1",
      "myfinance:storage:manifest",
      "myfinance:storage:version:123:key:cttm_v1",
    ])
    expect(redisMock.delCalls).toHaveLength(0)
  })

  it("does not replace the Redis snapshot when writing a later snapshot fails", async () => {
    localStorage.setItem("cttm_v1", "old-value")
    const firstManifest = await uploadLocalToUpstash(TEST_UPSTASH)
    const firstSnapshot = redisMock.store.get("myfinance:storage:snapshot")

    localStorage.setItem("cttm_v1", "new-value")
    redisMock.failSetKey = "myfinance:storage:snapshot"

    await expect(uploadLocalToUpstash(TEST_UPSTASH)).rejects.toThrow(/snapshot/)

    const remoteManifest = await getRemoteManifest(TEST_UPSTASH)
    expect(remoteManifest?.revision).toBe(firstManifest.revision)
    expect(redisMock.store.get("myfinance:storage:snapshot")).toBe(firstSnapshot)
    expect(redisMock.store.get("myfinance:storage:snapshot")).toContain("old-value")
  })

  it("does not modify localStorage when Redis values do not match the manifest checksum", async () => {
    localStorage.setItem("cttm_v1", "local-value")
    redisMock.store.set(
      "myfinance:storage:manifest",
      JSON.stringify({
        schemaVersion: 1,
        revision: 100,
        updatedAt: 100,
        keyCount: 1,
        keys: ["cttm_v1"],
        checksum: "not-the-real-checksum",
        keyPrefix: "myfinance:storage:version:100:key:",
      }),
    )
    redisMock.store.set("myfinance:storage:version:100:key:cttm_v1", "remote-value")

    await expect(downloadUpstashToLocal(TEST_UPSTASH)).rejects.toThrow(/không khớp manifest/i)

    expect(localStorage.getItem("cttm_v1")).toBe("local-value")
  })

})
