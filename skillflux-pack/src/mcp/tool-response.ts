export type ToolErrorCode =
  | "AUTH_REQUIRED"
  | "PAYMENT_REQUIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "NOT_INSTALLED"
  | "INTERNAL";

export interface ToolSuccess<T = unknown> {
  ok: true;
  status?: string;
  message: string;
  data: T;
}

export interface ToolFailure {
  ok: false;
  code: ToolErrorCode;
  message: string;
  nextAction?: { tool: string };
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

export class SkillFluxError extends Error {
  constructor(
    public code: ToolErrorCode,
    message: string,
    public nextAction?: { tool: string },
  ) {
    super(message);
    this.name = "SkillFluxError";
  }
}

export function okResult<T>(
  data: T,
  message: string,
  status?: string,
): ToolSuccess<T> {
  return { ok: true, status, message, data };
}

export function errResult(
  code: ToolErrorCode,
  message: string,
  nextAction?: { tool: string },
): ToolFailure {
  return { ok: false, code, message, nextAction };
}

export function authError(status: string, message: string): SkillFluxError {
  if (status === "needs_payment") {
    return new SkillFluxError(
      "PAYMENT_REQUIRED",
      message,
      { tool: "billing.checkout" },
    );
  }
  return new SkillFluxError("AUTH_REQUIRED", message, { tool: "auth.start" });
}
