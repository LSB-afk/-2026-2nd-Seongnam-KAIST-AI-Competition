import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Run } from "./types";

export class RunStore {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL, payload TEXT NOT NULL)",
    );
  }
  insert(run: Run, requestId: string): void {
    this.db
      .prepare(
        "INSERT INTO runs(id,request_id,updated_at,payload) VALUES(?,?,?,?)",
      )
      .run(run.id, requestId, run.updatedAt, JSON.stringify(run));
  }
  private decode(row: unknown): Run | undefined {
    return row
      ? (JSON.parse((row as { payload: string }).payload) as Run)
      : undefined;
  }
  findRequest(requestId: string): Run | undefined {
    return this.decode(
      this.db
        .prepare("SELECT payload FROM runs WHERE request_id=?")
        .get(requestId),
    );
  }
  get(id: string): Run | undefined {
    return this.decode(
      this.db.prepare("SELECT payload FROM runs WHERE id=?").get(id),
    );
  }
  list(): Run[] {
    return this.db
      .prepare("SELECT payload FROM runs ORDER BY updated_at DESC LIMIT 50")
      .all()
      .map((row) => this.decode(row)!);
  }
  save(run: Run): void {
    this.db
      .prepare("UPDATE runs SET updated_at=?,payload=? WHERE id=?")
      .run(run.updatedAt, JSON.stringify(run), run.id);
  }
  recoverInterrupted(): void {
    const rows = this.db.prepare("SELECT payload FROM runs").all();
    for (const row of rows) {
      const run = this.decode(row)!;
      if (run.status === "running" || run.status === "queued") {
        const activeElapsed = run.startedAt
          ? Math.max(0, Date.now() - Date.parse(run.startedAt))
          : 0;
        run.usage.elapsedMs = Math.min(
          run.limits.maxDurationMs,
          Math.max(
            run.usage.elapsedMs ?? 0,
            (run.attemptBaseElapsedMs ?? 0) + activeElapsed,
          ),
        );
        run.status = "needs_review";
        run.stopReason =
          "서버 재시작으로 실행이 중단되었습니다. 결과와 예산을 확인한 뒤 다시 검수하세요.";
        run.updatedAt = new Date().toISOString();
        run.events.push({
          id: randomUUID(),
          at: run.updatedAt,
          action: "error",
          message: run.stopReason,
          version: run.version,
        });
        this.save(run);
      }
    }
  }
  close(): void {
    this.db.close();
  }
}
