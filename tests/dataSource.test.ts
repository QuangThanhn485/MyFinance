// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  downloadUpstashToLocal,
  getRemoteManifest,
  parseUpstashConfigInput,
  uploadLocalToUpstash,
} from "@/storage/dataSource"

const redisMock = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failSetValue: null as string | null,
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
      if (value === redisMock.failSetValue) throw new Error("forced set failure")
      redisMock.store.set(key, typeof value === "string" ? value : JSON.stringify(value))
      return "OK"
    }

    async del(key: string) {
      return redisMock.store.delete(key) ? 1 : 0
    }
  },
}))

const TEST_UPSTASH = { url: "https://example.upstash.io", token: "token-value" }

describe("data source config parsing", () => {
  beforeEach(() => {
    localStorage.clear()
    redisMock.store.clear()
    redisMock.failSetValue = null
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

  it("does not move the Redis manifest to a partial upload when writing a later snapshot fails", async () => {
    localStorage.setItem("cttm_v1", "old-value")
    const firstManifest = await uploadLocalToUpstash(TEST_UPSTASH)

    localStorage.setItem("cttm_v1", "new-value")
    redisMock.failSetValue = "new-value"

    await expect(uploadLocalToUpstash(TEST_UPSTASH)).rejects.toThrow(/cttm_v1/)

    const remoteManifest = await getRemoteManifest(TEST_UPSTASH)
    expect(remoteManifest?.revision).toBe(firstManifest.revision)
    expect(redisMock.store.get(`${firstManifest.keyPrefix}cttm_v1`)).toBe("old-value")
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
