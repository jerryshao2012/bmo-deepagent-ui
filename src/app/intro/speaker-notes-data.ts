import { type IntroSlideId } from "./presentation-navigation";

export interface SlideSpeakerNote {
  id: IntroSlideId;
  title: string;
  duration: string;
  minutes: number;
  category: string;
  talkingPoints: string[];
  transitionCue: string;
}

export const INTRO_SPEAKER_NOTES: Record<IntroSlideId, SlideSpeakerNote> = {
  hero: {
    id: "hero",
    title: "Overview: Enterprise Research Workspace",
    duration: "1 min",
    minutes: 1,
    category: "Vision & Overview",
    talkingPoints: [
      "**Welcome & Problem Statement**: Enterprise organizations don't lack LLMs; they lack reliable research workspaces grounded in their actual documents.",
      "**From Chat to Knowledge**: Moving past ephemeral one-off prompt boxes into a persistent thread wiki where uploaded documents become searchable, cited knowledge.",
      "**Three-Phase Architecture**: Introduce the foundational workflow — Ground source material, execute bounded Research, and inspect through human Review.",
    ],
    transitionCue: "Let's take a quick look at the live research workspace in action on the next slide.",
  },
  preview: {
    id: "preview",
    title: "Workspace Preview & Interactive Shell",
    duration: "2 mins",
    minutes: 2,
    category: "Interactive Preview",
    talkingPoints: [
      "**Dual-Pane Experience**: The workspace pairs structured research findings on the left with observable agent execution state and live threads on the right.",
      "**Observable Execution**: Deep Agent tracks every step — document chunking, wiki indexing, citation extraction, and research query generation.",
      "**Zero Hallucination Anchoring**: Highlighting that local thread knowledge is indexed and queried *before* any bounded web research occurs.",
    ],
    transitionCue: "Now let's break down Phase 1: how source material is grounded and indexed into a living wiki.",
  },
  phase1: {
    id: "phase1",
    title: "Phase 1: Ground — Source Ingestion & Thread Wiki",
    duration: "2 mins",
    minutes: 2,
    category: "Ingestion & Grounding",
    talkingPoints: [
      "**Multi-Format Ingestion**: Upload reports, policies, earnings presentations, and market research PDFs into an isolated thread.",
      "**Living Thread Wiki**: Sources are parsed into structured, cross-referenced Markdown pages that persist for follow-up research.",
      "**Research Purpose Capture**: The agent records the user's research goal directly from initial prompts to guide downstream queries.",
    ],
    transitionCue: "Once source material is indexed and grounded, Phase 2 begins the targeted research loops.",
  },
  phase2: {
    id: "phase2",
    title: "Phase 2: Research — Bounded Agent Execution",
    duration: "2 mins",
    minutes: 2,
    category: "Bounded Execution",
    talkingPoints: [
      "**Thread Knowledge First**: Deep Agent queries local wiki knowledge before issuing any external web queries to minimize cost and latency.",
      "**Interactive Workflow Tree**: Walk through the visual node pipeline — Source Material → Living Wiki → Research Plan → Source-Linked Report.",
      "**Safety & Cost Controls**: Configurable concurrency, max iterations, and visible state files prevent unbounded agent loops.",
    ],
    transitionCue: "Once research passes are synthesized, Phase 3 provides comprehensive human verification.",
  },
  phase3: {
    id: "phase3",
    title: "Phase 3: Review — Verification & Comparison",
    duration: "2 mins",
    minutes: 2,
    category: "Evidence & Review",
    talkingPoints: [
      "**Citation Reachability**: Every claim connects back to page-exact document evidence that can be opened and verified with a click.",
      "**Deep Agent vs. Bare LLM**: Contrast persistent context and repeatable research skills against lossy, unlinked single-turn prompt windows.",
      "**Human-in-the-Loop Oversight**: Research skills generate reviewable instruction drafts before execution, keeping humans in control.",
    ],
    transitionCue: "To conclude, let's look at how to get started in the workspace right now.",
  },
  launch: {
    id: "launch",
    title: "Launch: Workspace Demo & Human Oversight",
    duration: "1 min",
    minutes: 1,
    category: "Call to Action",
    talkingPoints: [
      "**Core Value Summary**: Document grounding + bounded multi-step research + observable verification.",
      "**Actionable Next Step**: Direct stakeholders and team members to launch the workspace demo (`/chat`).",
      "**Q&A Invite**: Open the floor for questions, skill customizations, and live document testing.",
    ],
    transitionCue: "Thank you! Let's jump into the interactive workspace.",
  },
};
