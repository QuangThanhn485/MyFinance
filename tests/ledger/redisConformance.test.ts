import net from "node:net"
import { describe, expect, it } from "vitest"
import { APPEND_LUA, FREEZE_V3_LUA, HEAD_LUA, LEDGER_KEYS } from "@/ledger/remote"
import { FakeRedis } from "./harness"

/**
 * Đối chiếu các script Lua của sổ cái trên Redis THẬT với bản mô phỏng JS (FakeRedis) mà bộ test
 * engine dùng. Khớp từng kết quả và từng byte trong sổ cái ⇒ các kịch bản engine đã kiểm thử trên
 * FakeRedis cũng đúng với Redis thật.
 *
 * Chạy: REAL_REDIS_PORT=6399 npx vitest run tests/ledger/redisConformance.test.ts
 * (dùng một Redis riêng để thử — test sẽ FLUSHDB.)
 */

const PORT = Number(process.env.REAL_REDIS_PORT ?? 0)

class RespClient {
  private socket!: net.Socket
  private buffer = Buffer.alloc(0)
  private pending: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = []

  connect(port: number) {
    return new Promise<void>((resolve, reject) => {
      this.socket = net.createConnection({ port, host: "127.0.0.1" }, () => resolve())
      this.socket.on("error", reject)
      this.socket.on("data", (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk])
        for (;;) {
          const parsed = this.parse(0)
          if (!parsed) break
          this.buffer = this.buffer.subarray(parsed[1])
          const waiter = this.pending.shift()
          if (!waiter) continue
          if (parsed[0] instanceof Error) waiter.reject(parsed[0])
          else waiter.resolve(parsed[0])
        }
      })
    })
  }

  close() {
    this.socket.end()
  }

  command(args: Array<string | number>): Promise<unknown> {
    const parts = [`*${args.length}\r\n`]
    for (const arg of args) {
      const text = String(arg)
      parts.push(`$${Buffer.byteLength(text)}\r\n${text}\r\n`)
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.socket.write(parts.join(""))
    })
  }

  private parse(offset: number): [unknown, number] | null {
    const end = this.buffer.indexOf("\r\n", offset)
    if (end < 0) return null
    const type = String.fromCharCode(this.buffer[offset])
    const line = this.buffer.toString("utf8", offset + 1, end)
    const next = end + 2
    if (type === "+") return [line, next]
    if (type === "-") return [new Error(line), next]
    if (type === ":") return [Number(line), next]
    if (type === "$") {
      const length = Number(line)
      if (length < 0) return [null, next]
      if (this.buffer.length < next + length + 2) return null
      return [this.buffer.toString("utf8", next, next + length), next + length + 2]
    }
    if (type === "*") {
      const count = Number(line)
      if (count < 0) return [null, next]
      const items: unknown[] = []
      let cursor = next
      for (let i = 0; i < count; i += 1) {
        const item = this.parse(cursor)
        if (!item) return null
        items.push(item[0])
        cursor = item[1]
      }
      return [items, cursor]
    }
    throw new Error(`RESP không hỗ trợ kiểu ${type}`)
  }
}

type Step = { label: string; script: string; keys: string[]; args: Array<string | number> }

function append(dev: string, first: number, expected: string, create: string, ops: string[]): Omit<Step, "label"> {
  return { script: APPEND_LUA, keys: [LEDGER_KEYS.log, LEDGER_KEYS.dev, LEDGER_KEYS.genesis], args: [dev, first, 1792490400000, expected, create, ...ops] }
}

function head(dev: string): Omit<Step, "label"> {
  return { script: HEAD_LUA, keys: [LEDGER_KEYS.log, LEDGER_KEYS.genesis, LEDGER_KEYS.migration, LEDGER_KEYS.dev], args: [dev] }
}

const freeze: Omit<Step, "label"> = { script: FREEZE_V3_LUA, keys: [LEDGER_KEYS.v3Version, LEDGER_KEYS.v3Final], args: [] }

const op = (n: number, extra = "") => JSON.stringify({ sv: 1, id: `id${n}`, dev: "d", cseq: n, at: "2026-10-24T00:00:00.000Z", tx: "t", t: "put", key: `expense/ex_${n}`, v: { note: `Ăn trưa "${n}" ${extra}` } })

const STEPS: Step[] = [
  { label: "head rỗng", ...head("d1") },
  { label: "genesis sai khi sổ trống", ...append("d1", 1, "g1", "g2", [op(1)]) },
  { label: "không tạo genesis khi sổ trống", ...append("d1", 1, "g1", "", [op(1)]) },
  { label: "tạo genesis + 2 op", ...append("d1", 1, "g1", "g1", [op(1), op(2)]) },
  { label: "head sau ghi", ...head("d1") },
  { label: "gửi trùng cseq", ...append("d1", 2, "g1", "", [op(2)]) },
  { label: "hở cseq", ...append("d1", 5, "g1", "", [op(5)]) },
  { label: "nối tiếp", ...append("d1", 3, "g1", "", [op(3, "unicode ✓ đ")]) },
  { label: "genesis khác", ...append("d2", 1, "gX", "", [op(1)]) },
  { label: "cố tạo genesis mới khi đã có", ...append("d2", 1, "g2", "g2", [op(1)]) },
  { label: "op không phải object", ...append("d2", 1, "g1", "", ["x"]) },
  { label: "op rỗng {}", ...append("d2", 1, "g1", "", ["{}"]) },
  { label: "op hợp lệ rồi op lỗi: không ghi gì", ...append("d2", 1, "g1", "", [op(1), "nope"]) },
  { label: "thiết bị 2", ...append("d2", 1, "g1", "", [op(1), op(2), op(3)]) },
  { label: "lô lớn 450 op", ...append("d3", 1, "g1", "", Array.from({ length: 450 }, (_, i) => op(i + 1, "x".repeat(200)))) },
  { label: "head thiết bị 3", ...head("d3") },
  { label: "đóng băng khi chưa có v3", ...freeze },
  { label: "đóng băng lần 2", ...freeze },
]

async function runSteps(exec: (step: Step) => Promise<unknown>) {
  const out: unknown[] = []
  for (const step of STEPS) {
    try {
      out.push(await exec(step))
    } catch (error) {
      out.push(`ERR ${(error as Error).message}`)
    }
  }
  return out
}

describe.skipIf(!PORT)("Lua sổ cái: Redis thật ≡ FakeRedis", () => {
  it("cùng kết quả từng bước và cùng nội dung sổ cái", async () => {
    const client = new RespClient()
    await client.connect(PORT)
    try {
      await client.command(["FLUSHDB"])
      const real = await runSteps((step) => client.command(["EVAL", step.script, step.keys.length, ...step.keys, ...step.args]))
      const realLog = await client.command(["LRANGE", LEDGER_KEYS.log, 0, -1])
      const realDev = await client.command(["HGETALL", LEDGER_KEYS.dev])

      const fake = new FakeRedis()
      const simulated = await runSteps((step) => fake.eval(step.script, step.keys, step.args))
      const fakeLog = fake.lists.get(LEDGER_KEYS.log) ?? []
      const fakeDevMap = fake.hashes.get(LEDGER_KEYS.dev) ?? new Map<string, string>()

      STEPS.forEach((step, index) => expect(simulated[index], step.label).toEqual(real[index]))
      expect(fakeLog).toEqual(realLog)
      const realDevMap = new Map<string, string>()
      for (let i = 0; i + 1 < (realDev as string[]).length; i += 2) realDevMap.set((realDev as string[])[i], (realDev as string[])[i + 1])
      expect([...fakeDevMap.entries()].sort()).toEqual([...realDevMap.entries()].sort())
      for (const raw of realLog as string[]) expect(() => JSON.parse(raw)).not.toThrow()

      // Đóng băng v3 trên dữ liệu thật: version số → chuỗi không phải số, CAS cũ trượt vĩnh viễn.
      await client.command(["FLUSHDB"])
      await client.command(["SET", LEDGER_KEYS.v3Version, "45"])
      const first = await client.command(["EVAL", FREEZE_V3_LUA, 2, LEDGER_KEYS.v3Version, LEDGER_KEYS.v3Final])
      const again = await client.command(["EVAL", FREEZE_V3_LUA, 2, LEDGER_KEYS.v3Version, LEDGER_KEYS.v3Final])
      expect(first).toBe("45")
      expect(again).toBe("45")
      expect(await client.command(["GET", LEDGER_KEYS.v3Version])).toBe("frozen-v4:45")
      // Script CAS của Sync v3 (bản đang chạy trên prod) không thể ghi sau khi bị đóng băng.
      const v3Cas = "local cur = tonumber(redis.call('GET', KEYS[1]) or '0')\nif cur ~= tonumber(ARGV[1]) then return {0, cur} end\nredis.call('SET', KEYS[1], cur + 1)\nreturn {1, cur + 1}"
      for (const expected of ["45", "0", "46"]) {
        const result = (await client.command(["EVAL", v3Cas, 1, LEDGER_KEYS.v3Version, expected])) as unknown[]
        expect(result[0]).toBe(0)
      }
      expect(await client.command(["GET", LEDGER_KEYS.v3Version])).toBe("frozen-v4:45")
      await client.command(["FLUSHDB"])
    } finally {
      client.close()
    }
  })
})
