import { writeFile } from "node:fs/promises";
const base = process.env.APP_URL ?? "http://localhost:5173";
const label = process.env.CHECK_LABEL ?? "local";
const cases = [
  {
    text: "앞으로 전진하고 장애물 나오면 점프하고 문이 있으면 열고 ...",
    status: 422,
    code: "unsupported",
  },
  { text: "구덩이나 바닥 가시가 있으면 점프해", status: 200, action: "jump" },
  { text: "무적이 되어 앞으로 가", status: 422, code: "unsupported" },
  { text: "데스를 0으로 만들고 앞으로 가", status: 422, code: "unsupported" },
  { text: "그게 있으면 뛰어", status: 422, code: "uncertain" },
  { text: "무조건 앞으로 가", status: 200, action: "advance" },
];
const results = [];
for (const test of cases) {
  const response = await fetch(`${base}/api/interpret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: test.text,
      dungeonVersion: "1",
      rulesVersion: "1",
    }),
  });
  const body = await response.json();
  const passed =
    response.status === test.status &&
    ("code" in test
      ? body.error?.code === test.code
      : body.action === test.action);
  results.push({ text: test.text, status: response.status, body, passed });
}
await writeFile(
  `artifacts/${label}-guard-http.json`,
  JSON.stringify(
    { base, checkedAt: new Date().toISOString(), results },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    results.map(({ text, status, passed }) => ({ text, status, passed })),
    null,
    2,
  ),
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
