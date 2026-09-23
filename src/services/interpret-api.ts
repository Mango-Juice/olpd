interface ApiErrorEnvelope {
  error?: { message?: unknown };
  message?: unknown;
}

function messageFrom(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const envelope = value as ApiErrorEnvelope;
  if (typeof envelope.error?.message === "string" && envelope.error.message.trim()) return envelope.error.message;
  if (typeof envelope.message === "string" && envelope.message.trim()) return envelope.message;
  return fallback;
}

/** Shared browser transport; each interpreter still validates its own response contract. */
export async function postInterpretJson(
  endpoint: string,
  body: unknown,
  signal: AbortSignal,
  fallback = "뜻을 확인하지 못했어요. 작성 기회는 그대로예요.",
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("해석 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  if (response.status === 429) throw new Error("요청이 잠시 몰렸어요. 1분 뒤 다시 시도해 주세요.");
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("해석 서버의 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  if (!response.ok) throw new Error(messageFrom(value, fallback));
  return value;
}
