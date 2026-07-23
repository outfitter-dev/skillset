import type { PromptChoice } from "./prompt-adapter";
import type {
  ReconcileChoice,
  ReconcileReport,
} from "./reconcile";

export function reconcileDirectionChoices(
  report: ReconcileReport
): readonly PromptChoice<ReconcileChoice>[] {
  return [
    {
      ...(report.sourceResolutionAvailable
        ? { description: "Re-render managed output from source." }
        : { disabled: "Source resolution is unavailable." }),
      name: "Source wins",
      value: "source",
    },
    {
      ...(report.outputResolution.wouldWrite
        ? { description: report.outputResolution.message }
        : { disabled: report.outputResolution.message }),
      name: "Output wins",
      value: "output",
    },
  ];
}

export function reconcileChoiceAvailable(
  report: ReconcileReport,
  choice: ReconcileChoice
): boolean {
  return choice === "source"
    ? report.sourceResolutionAvailable
    : report.outputResolution.wouldWrite;
}
