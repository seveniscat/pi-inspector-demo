import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseCsv } from "../src/csv.ts";

test("parseCsv: 普通字段", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("parseCsv: 引号字段内可以有逗号", () => {
  assert.deepEqual(parseCsv('id,content\np1,"续航实测：一天，剩 18%"'), [
    ["id", "content"],
    ["p1", "续航实测：一天，剩 18%"],
  ]);
});

test('parseCsv: 引号字段内 "" 表示一个双引号', () => {
  assert.deepEqual(parseCsv('id,content\np7,"客服说""发热正常"""'), [
    ["id", "content"],
    ["p7", '客服说"发热正常"'],
  ]);
});
