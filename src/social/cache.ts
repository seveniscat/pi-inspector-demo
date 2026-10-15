/**
 * 按请求内容缓存每一次查询。
 *
 * 两个用途：
 * 1. 幂等：进程被 kill 后恢复，模型重新发起同样的查询会直接命中缓存，不会重复调用外部服务（也不重复计费 / 占限流）。
 *    这就是 Pi Durable 说的"有副作用的步骤要幂等"在这里的具体做法。
 * 2. 回放：live 模式跑过一遍后，SOCIAL_MODE=replay 只读缓存，现场断网也能演示。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SocialProvider } from "./types.ts";

export interface CacheHit<T> {
  value: T;
  cached: boolean;
  ms: number;
}

export function stableKey(op: string, params: unknown): string {
  const norm = (v: any): any =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined && v[k] !== "")
              .map((k) => [k, norm(v[k])]),
          )
        : v;
  return crypto.createHash("sha1").update(op + ":" + JSON.stringify(norm(params))).digest("hex").slice(0, 16);
}

export class CachedProvider {
  private dir: string;
  private inner: SocialProvider | null;
  readonly mode: string;

  /** inner 为 null 表示 replay：只读缓存，未命中就报错 */
  constructor(dir: string, inner: SocialProvider | null, mode: string) {
    this.dir = dir;
    this.inner = inner;
    this.mode = mode;
    fs.mkdirSync(dir, { recursive: true });
  }

  async run<T>(op: "search" | "getPost" | "trend", params: unknown): Promise<CacheHit<T>> {
    const t0 = Date.now();
    const file = path.join(this.dir, `${op}-${stableKey(op, params)}.json`);
    if (fs.existsSync(file)) {
      return { value: JSON.parse(fs.readFileSync(file, "utf8")).value, cached: true, ms: Date.now() - t0 };
    }
    if (!this.inner) throw new Error(`replay 模式下没有这次查询的录制结果（${op} ${JSON.stringify(params)}）`);
    const value: any =
      op === "search"
        ? await this.inner.search(params as any)
        : op === "getPost"
          ? await this.inner.getPost((params as any).id)
          : await this.inner.trend(params as any);
    // 先写临时文件再 rename：kill 发生在写入中途也不会留下半个缓存文件
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ op, params, at: new Date().toISOString(), value }));
    fs.renameSync(tmp, file);
    return { value, cached: false, ms: Date.now() - t0 };
  }
}
