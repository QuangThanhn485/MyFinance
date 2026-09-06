// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import {
  getDataSourceConfig,
  parseUpstashConfigInput,
  saveDataSourceConfig,
  setDataSourceMode,
} from "@/storage/dataSource"

describe("data source config", () => {
  beforeEach(() => {
    localStorage.clear()
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

  it("defaults to localStorage mode and round-trips the saved mode", () => {
    expect(getDataSourceConfig().mode).toBe("localStorage")
    saveDataSourceConfig({ mode: "upstash", upstash: { url: "https://x.upstash.io", token: "t" }, updatedAt: 1 })
    expect(getDataSourceConfig().mode).toBe("upstash")
    setDataSourceMode("localStorage")
    const config = getDataSourceConfig()
    expect(config.mode).toBe("localStorage")
    expect(config.upstash?.url).toBe("https://x.upstash.io")
  })
})
