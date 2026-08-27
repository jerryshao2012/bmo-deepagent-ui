"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CornerDownLeft,
  HelpCircle,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildApprovalResumeValue,
  buildClarificationResponse,
  type ClarificationDraftAnswer,
  type HitlDecision,
  type HitlDecisionType,
  type ParsedInterrupt,
  type RequirementClarificationInterruptV1,
  type ResumeInterruptInput,
} from "./index";

interface HitlInterruptPanelProps {
  parsedInterrupt: ParsedInterrupt;
  currentThreadId: string | null;
  isLoading: boolean;
  onResume: (input: ResumeInterruptInput) => void;
}

const DEFAULT_ALLOWED_DECISIONS: HitlDecisionType[] = [
  "approve",
  "reject",
  "edit",
];

function canAnswerQuestion(
  payload: RequirementClarificationInterruptV1,
  answers: Record<string, ClarificationDraftAnswer>
) {
  return payload.questions.every((question) => {
    const answer = answers[question.id];
    const selectedCount = answer?.selectedOptionIds.length ?? 0;
    const hasOther = Boolean(answer?.otherText?.trim());

    if (question.type === "single_select" && selectedCount > 1) return false;
    if (!question.allow_other && hasOther) return false;
    if (!question.required) return true;
    return selectedCount > 0 || hasOther;
  });
}

function resolveThreadId(
  requestedThreadId: string | null,
  currentThreadId: string | null
) {
  return requestedThreadId ?? currentThreadId;
}

function hasStaleThread(
  requestedThreadId: string | null,
  currentThreadId: string | null
) {
  return Boolean(
    requestedThreadId &&
      currentThreadId &&
      requestedThreadId !== currentThreadId
  );
}

function StaleThreadPanel() {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <AlertCircle className="h-4 w-4" />
        <span>Thread Changed</span>
      </div>
      <p className="text-amber-900/80 dark:text-amber-100/80">
        Return to the interrupted thread before responding.
      </p>
    </div>
  );
}

function UnsupportedInterruptPanel({ reason }: { reason: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <HelpCircle className="h-4 w-4 text-muted-foreground" />
        <span>Unsupported Interrupt</span>
      </div>
      <p className="text-muted-foreground">{reason}</p>
    </div>
  );
}

function RequirementClarificationPanel({
  payload,
  threadId,
  isLoading,
  onResume,
}: {
  payload: RequirementClarificationInterruptV1;
  threadId: string;
  isLoading: boolean;
  onResume: (input: ResumeInterruptInput) => void;
}) {
  const [answers, setAnswers] = useState<
    Record<string, ClarificationDraftAnswer>
  >({});
  const canSubmit = canAnswerQuestion(payload, answers);

  const updateSelection = (
    questionId: string,
    optionId: string,
    type: "single_select" | "multi_select",
    checked: boolean
  ) => {
    setAnswers((previous) => {
      const current = previous[questionId] ?? { selectedOptionIds: [] };
      const selectedOptionIds =
        type === "single_select"
          ? [optionId]
          : checked
          ? [...current.selectedOptionIds, optionId]
          : current.selectedOptionIds.filter((id) => id !== optionId);
      return {
        ...previous,
        [questionId]: {
          ...current,
          selectedOptionIds,
        },
      };
    });
  };

  const updateOtherText = (questionId: string, otherText: string) => {
    setAnswers((previous) => {
      const current = previous[questionId] ?? { selectedOptionIds: [] };
      return {
        ...previous,
        [questionId]: { ...current, otherText },
      };
    });
  };

  return (
    <section className="rounded-md border border-border bg-background p-4 shadow-sm">
      <div className="mb-4 flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Clarify Requirements</h3>
          <p className="text-xs text-muted-foreground">
            Answer these before the agent continues.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {payload.questions.map((question) => {
          const current = answers[question.id] ?? { selectedOptionIds: [] };
          return (
            <fieldset
              key={question.id}
              className="space-y-2"
            >
              <legend className="text-sm font-medium text-foreground">
                {question.prompt}
              </legend>
              <div className="space-y-2">
                {question.options.map((option) => {
                  const checked = current.selectedOptionIds.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 text-sm",
                        checked && "bg-primary/5 border-primary"
                      )}
                    >
                      <input
                        className="mt-1"
                        aria-label={option.label}
                        type={
                          question.type === "single_select"
                            ? "radio"
                            : "checkbox"
                        }
                        name={question.id}
                        checked={checked}
                        onChange={(event) =>
                          updateSelection(
                            question.id,
                            option.id,
                            question.type,
                            event.target.checked
                          )
                        }
                        disabled={isLoading}
                      />
                      <span>
                        <span className="block font-medium">
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="block text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
              {question.allow_other && (
                <label className="block text-xs font-medium text-muted-foreground">
                  Other answer for {question.prompt}
                  <Textarea
                    value={current.otherText ?? ""}
                    onChange={(event) =>
                      updateOtherText(question.id, event.target.value)
                    }
                    disabled={isLoading}
                    className="mt-1 text-sm"
                    rows={2}
                  />
                </label>
              )}
            </fieldset>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onResume({
              threadId,
              value: buildClarificationResponse(payload, {}, true),
            })
          }
          disabled={isLoading}
        >
          <SkipForward className="h-4 w-4" />
          Skip and continue
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onResume({
              threadId,
              value: buildClarificationResponse(payload, answers),
            })
          }
          disabled={isLoading || !canSubmit}
        >
          <Check className="h-4 w-4" />
          Submit answers
        </Button>
      </div>
    </section>
  );
}

function ActionReviewPanel({
  parsedInterrupt,
  threadId,
  isLoading,
  onResume,
}: {
  parsedInterrupt: Extract<ParsedInterrupt, { kind: "action_review" }>;
  threadId: string;
  isLoading: boolean;
  onResume: (input: ResumeInterruptInput) => void;
}) {
  const actions = parsedInterrupt.actions;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Array<HitlDecision | null>>(() =>
    actions.map(() => null)
  );
  const [message, setMessage] = useState("");
  const [editedArgsText, setEditedArgsText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const action = actions[currentIndex];
  const allowedDecisions = action?.config?.allowedDecisions?.length
    ? action.config.allowedDecisions
    : DEFAULT_ALLOWED_DECISIONS;
  const allDecisions = decisions.filter(Boolean) as HitlDecision[];
  const isComplete = allDecisions.length === actions.length;

  useEffect(() => {
    setMessage("");
    setEditError(null);
    setEditedArgsText(
      JSON.stringify(actions[currentIndex]?.request.args ?? {}, null, 2)
    );
  }, [actions, currentIndex]);

  const recordDecision = (decision: HitlDecision) => {
    setDecisions((previous) => {
      const next = [...previous];
      next[currentIndex] = decision;
      return next;
    });
    setCurrentIndex((previous) => Math.min(previous + 1, actions.length - 1));
  };

  const submitAll = () => {
    onResume({
      threadId,
      value: buildApprovalResumeValue(
        decisions.filter(Boolean) as HitlDecision[],
        actions.length
      ),
    });
  };

  if (!action) {
    return <UnsupportedInterruptPanel reason="Action review has no actions." />;
  }

  const submitEdit = () => {
    try {
      const parsed = JSON.parse(editedArgsText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Edited arguments must be a JSON object.");
      }
      setEditError(null);
      recordDecision({
        type: "edit",
        edited_action: {
          name: action.request.name,
          args: parsed as Record<string, unknown>,
        },
      });
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="rounded-md border border-border bg-background p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Action Review</h3>
          <p className="text-xs text-muted-foreground">
            Action {currentIndex + 1} of {actions.length}
          </p>
        </div>
        {currentIndex > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentIndex((previous) => previous - 1)}
            disabled={isLoading}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
      </div>

      <div className="mb-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {action.request.name}
        </div>
        {action.request.description && (
          <p className="mb-3 text-muted-foreground">
            {action.request.description}
          </p>
        )}
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-sm bg-background p-2 font-mono text-xs">
          {JSON.stringify(action.request.args, null, 2)}
        </pre>
      </div>

      {(allowedDecisions.includes("reject") ||
        allowedDecisions.includes("respond")) && (
        <label className="mb-3 block text-xs font-medium text-muted-foreground">
          Response to reviewer
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={isLoading}
            className="mt-1 text-sm"
            rows={2}
          />
        </label>
      )}

      {allowedDecisions.includes("edit") && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Edited arguments
            <Textarea
              value={editedArgsText}
              onChange={(event) => setEditedArgsText(event.target.value)}
              disabled={isLoading}
              className="mt-1 font-mono text-xs"
              rows={5}
            />
          </label>
          {editError && (
            <p className="mt-1 text-xs text-destructive">{editError}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {allowedDecisions.includes("approve") && (
            <Button
              size="sm"
              onClick={() => recordDecision({ type: "approve" })}
              disabled={isLoading}
            >
              <Check className="h-4 w-4" />
              Approve
            </Button>
          )}
          {allowedDecisions.includes("reject") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                recordDecision({
                  type: "reject",
                  ...(message.trim() ? { message: message.trim() } : {}),
                })
              }
              disabled={isLoading}
              className="text-destructive hover:bg-destructive/10"
            >
              Reject
            </Button>
          )}
          {allowedDecisions.includes("respond") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                recordDecision({ type: "respond", message: message.trim() })
              }
              disabled={isLoading || !message.trim()}
            >
              <CornerDownLeft className="h-4 w-4" />
              Respond
            </Button>
          )}
          {allowedDecisions.includes("edit") && (
            <Button
              variant="outline"
              size="sm"
              onClick={submitEdit}
              disabled={isLoading}
            >
              Save Edit
            </Button>
          )}
        </div>
        <Button
          size="sm"
          onClick={submitAll}
          disabled={isLoading || !isComplete}
        >
          Submit decisions
        </Button>
      </div>
    </section>
  );
}

export function HitlInterruptPanel({
  parsedInterrupt,
  currentThreadId,
  isLoading,
  onResume,
}: HitlInterruptPanelProps) {
  const stale = hasStaleThread(
    parsedInterrupt.request.threadId,
    currentThreadId
  );
  const threadId = useMemo(
    () => resolveThreadId(parsedInterrupt.request.threadId, currentThreadId),
    [parsedInterrupt.request.threadId, currentThreadId]
  );

  if (stale) {
    return <StaleThreadPanel />;
  }

  if (!threadId) {
    return (
      <UnsupportedInterruptPanel reason="No thread is available for resume." />
    );
  }

  if (parsedInterrupt.kind === "requirement_clarification") {
    return (
      <RequirementClarificationPanel
        payload={parsedInterrupt.payload}
        threadId={threadId}
        isLoading={isLoading}
        onResume={onResume}
      />
    );
  }

  if (parsedInterrupt.kind === "action_review") {
    return (
      <ActionReviewPanel
        parsedInterrupt={parsedInterrupt}
        threadId={threadId}
        isLoading={isLoading}
        onResume={onResume}
      />
    );
  }

  return <UnsupportedInterruptPanel reason={parsedInterrupt.reason} />;
}
