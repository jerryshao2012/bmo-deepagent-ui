export type ClarificationQuestionType = "single_select" | "multi_select";

export interface ClarificationOptionV1 {
  id: string;
  label: string;
  description?: string;
}

export interface ClarificationQuestionV1 {
  id: string;
  prompt: string;
  type: ClarificationQuestionType;
  required: boolean;
  options: ClarificationOptionV1[];
  allow_other: boolean;
}

export interface RequirementClarificationInterruptV1 {
  kind: "requirement_clarification";
  version: 1;
  request_id: string;
  questions: ClarificationQuestionV1[];
}

export interface RequirementClarificationAnswerV1 {
  question_id: string;
  selected_option_ids: string[];
  other_text: string | null;
}

export interface RequirementClarificationResponseV1 {
  kind: "requirement_clarification_response";
  version: 1;
  request_id: string;
  skipped: boolean;
  answers: RequirementClarificationAnswerV1[];
}

export interface ActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

export type HitlDecisionType = "approve" | "reject" | "edit" | "respond";

export type HitlDecision =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | {
      type: "edit";
      edited_action: {
        name: string;
        args: Record<string, unknown>;
      };
    }
  | { type: "respond"; message: string };

export interface ReviewConfig {
  actionName: string;
  allowedDecisions?: HitlDecisionType[];
}

export type HitlResumeValue =
  | RequirementClarificationResponseV1
  | { decisions: HitlDecision[] };

export interface ResumeInterruptInput {
  threadId: string;
  value: HitlResumeValue;
}

export type ParsedInterrupt =
  | {
      kind: "requirement_clarification";
      request: { threadId: string | null };
      payload: RequirementClarificationInterruptV1;
    }
  | {
      kind: "action_review";
      request: { threadId: string | null };
      actions: Array<{
        index: number;
        request: ActionRequest;
        config?: ReviewConfig;
      }>;
    }
  | {
      kind: "unsupported";
      request: { threadId: string | null };
      reason: string;
      value: unknown;
    };

export interface ClarificationDraftAnswer {
  selectedOptionIds: string[];
  otherText?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every(isString)) return null;
  return value;
}

function normalizeActionRequest(value: unknown): ActionRequest | null {
  if (!isRecord(value) || !isString(value.name) || !isRecord(value.args)) {
    return null;
  }
  return {
    name: value.name,
    args: value.args,
    ...(isString(value.description) ? { description: value.description } : {}),
  };
}

function normalizeReviewConfig(value: unknown): ReviewConfig | null {
  if (!isRecord(value)) return null;
  const rawActionName = value.actionName ?? value.action_name;
  if (!isString(rawActionName)) return null;
  const rawAllowed = value.allowedDecisions ?? value.allowed_decisions;
  const allowedDecisions = toStringArray(rawAllowed);
  return {
    actionName: rawActionName,
    ...(allowedDecisions
      ? { allowedDecisions: allowedDecisions.filter(isHitlDecisionType) }
      : {}),
  };
}

function isHitlDecisionType(value: string): value is HitlDecisionType {
  return (
    value === "approve" ||
    value === "reject" ||
    value === "edit" ||
    value === "respond"
  );
}

function normalizeClarification(
  value: unknown
): RequirementClarificationInterruptV1 | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "requirement_clarification" ||
    value.version !== 1 ||
    !isString(value.request_id) ||
    !Array.isArray(value.questions)
  ) {
    return null;
  }

  const questions: ClarificationQuestionV1[] = [];
  for (const question of value.questions) {
    if (
      !isRecord(question) ||
      !isString(question.id) ||
      !isString(question.prompt) ||
      (question.type !== "single_select" && question.type !== "multi_select") ||
      typeof question.required !== "boolean" ||
      typeof question.allow_other !== "boolean" ||
      !Array.isArray(question.options)
    ) {
      return null;
    }

    const options: ClarificationOptionV1[] = [];
    for (const option of question.options) {
      if (
        !isRecord(option) ||
        !isString(option.id) ||
        !isString(option.label)
      ) {
        return null;
      }
      options.push({
        id: option.id,
        label: option.label,
        ...(isString(option.description)
          ? { description: option.description }
          : {}),
      });
    }

    questions.push({
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      required: question.required,
      options,
      allow_other: question.allow_other,
    });
  }

  return {
    kind: "requirement_clarification",
    version: 1,
    request_id: value.request_id,
    questions,
  };
}

function interruptThreadId(interrupt: unknown): string | null {
  if (!isRecord(interrupt)) return null;
  const rawThreadId = interrupt.threadId ?? interrupt.thread_id;
  return isString(rawThreadId) ? rawThreadId : null;
}

export function parseInterrupt(interrupt: unknown): ParsedInterrupt {
  const request = { threadId: interruptThreadId(interrupt) };
  const value =
    isRecord(interrupt) && "value" in interrupt ? interrupt.value : interrupt;
  const clarification = normalizeClarification(value);
  if (clarification) {
    return {
      kind: "requirement_clarification",
      request,
      payload: clarification,
    };
  }

  if (isRecord(value)) {
    const rawActions = value.actionRequests ?? value.action_requests;
    const rawConfigs = value.reviewConfigs ?? value.review_configs;
    if (Array.isArray(rawActions)) {
      const actions = rawActions.map(normalizeActionRequest);
      if (actions.every(Boolean)) {
        const configs = Array.isArray(rawConfigs)
          ? rawConfigs.map(normalizeReviewConfig)
          : [];
        return {
          kind: "action_review",
          request,
          actions: actions.map((action, index) => ({
            index,
            request: action as ActionRequest,
            ...(configs[index]
              ? { config: configs[index] as ReviewConfig }
              : {}),
          })),
        };
      }
      return {
        kind: "unsupported",
        request,
        reason: "Malformed action review interrupt.",
        value,
      };
    }
  }

  return {
    kind: "unsupported",
    request,
    reason: "Unsupported interrupt payload.",
    value,
  };
}

export function buildClarificationResponse(
  payload: RequirementClarificationInterruptV1,
  draftAnswers: Record<string, ClarificationDraftAnswer>,
  skipped = false
): RequirementClarificationResponseV1 {
  if (skipped) {
    return {
      kind: "requirement_clarification_response",
      version: 1,
      request_id: payload.request_id,
      skipped: true,
      answers: [],
    };
  }

  return {
    kind: "requirement_clarification_response",
    version: 1,
    request_id: payload.request_id,
    skipped: false,
    answers: payload.questions.map((question) => {
      const answer = draftAnswers[question.id] ?? { selectedOptionIds: [] };
      const otherText = answer.otherText?.trim() || null;
      return {
        question_id: question.id,
        selected_option_ids: [...answer.selectedOptionIds],
        other_text: otherText,
      };
    }),
  };
}

export function buildApprovalResumeValue(
  decisions: HitlDecision[],
  actionCount: number
): { decisions: HitlDecision[] } {
  if (decisions.length !== actionCount) {
    throw new Error("HITL resume requires one decision per action request.");
  }
  return { decisions };
}

export function mergeHitlConfig<T extends Record<string, unknown> | undefined>(
  config: T
): Record<string, unknown> {
  const base: Record<string, unknown> =
    config && typeof config === "object" ? config : {};
  const configurable = isRecord(base.configurable) ? base.configurable : {};
  const clientCapabilities = isRecord(configurable.client_capabilities)
    ? configurable.client_capabilities
    : {};

  return {
    ...base,
    configurable: {
      ...configurable,
      clarification_mode: "auto",
      client_capabilities: {
        ...clientCapabilities,
        requirement_clarification: 1,
      },
    },
  };
}
