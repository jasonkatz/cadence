import { useState, useEffect, useMemo } from "react";
import type { PipelineState } from "../hooks/usePipelineState";

type AgentStatus = "idle" | "working" | "done" | "waiting";

interface AgentState {
  name: string;
  role: string;
  avatar: string;
  status: AgentStatus;
  speech: string | null;
}

interface TheaterStage {
  label: string;
  description: string;
  activeAgent: string;
}

const THEATER_STAGES: TheaterStage[] = [
  {
    label: "Dev",
    description: "Implementing the feature",
    activeAgent: "Dev",
  },
  {
    label: "In Review",
    description: "Code review in progress",
    activeAgent: "Reviewer",
  },
  {
    label: "Verification",
    description: "Running E2E journeys",
    activeAgent: "E2E",
  },
  {
    label: "Final Signoff",
    description: "Verifying coverage",
    activeAgent: "Verifier",
  },
  {
    label: "Complete",
    description: "Ready for merge",
    activeAgent: "",
  },
];

const STAGE_SPEECHES: Record<string, string[]> = {
  Dev: [
    "Writing tests first...",
    "Implementing the feature...",
    "Running lint and build...",
    "Committing changes...",
    "Pushing to branch...",
  ],
  Reviewer: [
    "Checking the PR diff...",
    "Reviewing against requirements...",
    "Running security checks...",
    "Assessing test coverage...",
    "Leaving review comments...",
  ],
  E2E: [
    "Starting local environment...",
    "Running user journeys...",
    "Testing API endpoints...",
    "Capturing screenshots...",
    "Writing demo document...",
  ],
  Verifier: [
    "Reading requirements...",
    "Comparing E2E artifact...",
    "Checking coverage gaps...",
    "Assessing pass/fail...",
    "Emitting result JSON...",
  ],
};

const INITIAL_AGENTS: AgentState[] = [
  {
    name: "Dev",
    role: "Senior Engineer",
    avatar: "🔨",
    status: "idle",
    speech: null,
  },
  {
    name: "Reviewer",
    role: "Code Reviewer",
    avatar: "🔍",
    status: "idle",
    speech: null,
  },
  {
    name: "E2E",
    role: "QA Engineer",
    avatar: "🧪",
    status: "idle",
    speech: null,
  },
  {
    name: "Verifier",
    role: "Verification Agent",
    avatar: "📋",
    status: "idle",
    speech: null,
  },
];

function SpeechBubble({ text }: { text: string }) {
  return (
    <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-10 w-48">
      <div className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 shadow-lg text-center leading-snug">
        {text}
      </div>
      <div className="w-3 h-3 bg-white border-b border-r border-gray-200 rotate-45 mx-auto -mt-1.5" />
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentState }) {
  const statusColors: Record<AgentStatus, string> = {
    idle: "bg-gray-100 border-gray-200",
    working: "bg-blue-50 border-blue-300 shadow-blue-100 shadow-md",
    done: "bg-green-50 border-green-300",
    waiting: "bg-yellow-50 border-yellow-200",
  };

  const statusDot: Record<AgentStatus, string> = {
    idle: "bg-gray-300",
    working: "bg-blue-500 animate-pulse",
    done: "bg-green-500",
    waiting: "bg-yellow-400",
  };

  return (
    <div className="relative flex flex-col items-center">
      {agent.speech && <SpeechBubble text={agent.speech} />}
      <div
        className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-500 w-32 ${statusColors[agent.status]}`}
      >
        <div
          className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${statusDot[agent.status]}`}
        />
        <span className="text-4xl">{agent.avatar}</span>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-800">{agent.name}</p>
          <p className="text-xs text-gray-500">{agent.role}</p>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            agent.status === "working"
              ? "bg-blue-100 text-blue-700"
              : agent.status === "done"
                ? "bg-green-100 text-green-700"
                : agent.status === "waiting"
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-gray-100 text-gray-500"
          }`}
        >
          {agent.status}
        </span>
      </div>
    </div>
  );
}

function StageIndicator({
  stage,
  index,
  currentIndex,
}: {
  stage: TheaterStage;
  index: number;
  currentIndex: number;
}) {
  const isDone = index < currentIndex;
  const isCurrent = index === currentIndex;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
          isDone
            ? "bg-green-500 text-white"
            : isCurrent
              ? "bg-blue-500 text-white ring-4 ring-blue-100"
              : "bg-gray-200 text-gray-500"
        }`}
      >
        {isDone ? "✓" : index + 1}
      </div>
      <span
        className={`text-sm font-medium transition-colors duration-300 ${
          isCurrent ? "text-blue-700" : isDone ? "text-green-600" : "text-gray-400"
        }`}
      >
        {stage.label}
      </span>
    </div>
  );
}

// Map pipeline stage strings (as serialized by Rust) to THEATER_STAGES indices.
const STAGE_NAME_TO_INDEX: Record<string, number> = {
  pending: 0,
  dev: 0,
  "in-review": 1,
  verification: 2,
  "final-signoff": 3,
  complete: 4,
  failed: 4,
  cancelled: 4,
};

interface AgentTheaterProps {
  /** When provided the theater reflects this live workflow state instead of
   *  running the built-in demo simulation. */
  pipelineState?: PipelineState | null;
}

export function AgentTheater({ pipelineState }: AgentTheaterProps = {}) {
  const isLive = pipelineState != null;

  // --- Live-data-derived values ---
  const liveStageIndex = useMemo(() => {
    if (!pipelineState) return 0;
    return STAGE_NAME_TO_INDEX[pipelineState.stage] ?? 0;
  }, [pipelineState]);

  const liveIteration = pipelineState?.iteration ?? 1;
  const liveIsComplete =
    pipelineState?.stage === "complete" ||
    pipelineState?.stage === "failed" ||
    pipelineState?.stage === "cancelled";

  // --- Demo-simulation state (only used when !isLive) ---
  const [demoStageIndex, setDemoStageIndex] = useState(0);
  const [demoIteration, setDemoIteration] = useState(1);
  const [demoIsRunning, setDemoIsRunning] = useState(true);

  const [speechIndex, setSpeechIndex] = useState(0);
  const [agents, setAgents] = useState<AgentState[]>(INITIAL_AGENTS);

  const stageIndex = isLive ? liveStageIndex : demoStageIndex;
  const iteration = isLive ? liveIteration : demoIteration;
  const isComplete = isLive ? liveIsComplete : (demoStageIndex === THEATER_STAGES.length - 1 && !demoIsRunning);

  const currentStage = THEATER_STAGES[stageIndex];

  // Cycle through speeches for the active agent
  useEffect(() => {
    if (isLive && isComplete) return;
    if (!isLive && !demoIsRunning) return;

    const activeAgentName = currentStage?.activeAgent;
    if (!activeAgentName) return;

    const speeches = STAGE_SPEECHES[activeAgentName] ?? [];
    if (speeches.length === 0) return;

    const speechTimer = setInterval(() => {
      setSpeechIndex((i) => (i + 1) % speeches.length);
    }, 2000);

    return () => clearInterval(speechTimer);
  }, [stageIndex, isLive, isComplete, demoIsRunning, currentStage]);

  // Demo: advance stage every ~10 seconds (disabled in live mode)
  useEffect(() => {
    if (isLive || !demoIsRunning) return;

    const stageTimer = setInterval(() => {
      setDemoStageIndex((i) => {
        const next = i + 1;
        if (next >= THEATER_STAGES.length - 1) {
          // Simulate a rework then complete
          if (demoIteration < 2) {
            setDemoIteration((it) => it + 1);
            return 0;
          }
          setDemoIsRunning(false);
          return THEATER_STAGES.length - 1;
        }
        return next;
      });
      setSpeechIndex(0);
    }, 10000);

    return () => clearInterval(stageTimer);
  }, [isLive, demoIsRunning, demoIteration]);

  // Sync agent statuses with current stage
  useEffect(() => {
    const activeAgentName = currentStage?.activeAgent;
    setAgents(
      INITIAL_AGENTS.map((a) => {
        const stageForAgent = THEATER_STAGES.findIndex(
          (s) => s.activeAgent === a.name,
        );
        if (a.name === activeAgentName) {
          const speeches = STAGE_SPEECHES[a.name] ?? [];
          return {
            ...a,
            status: "working",
            speech: speeches[speechIndex] ?? null,
          };
        }
        if (stageForAgent >= 0 && stageForAgent < stageIndex) {
          return { ...a, status: "done", speech: null };
        }
        return { ...a, status: "idle", speech: null };
      }),
    );
  }, [stageIndex, speechIndex, currentStage]);

  const handleReset = () => {
    setAgents(INITIAL_AGENTS);
    setDemoStageIndex(0);
    setSpeechIndex(0);
    setDemoIteration(1);
    setDemoIsRunning(true);
  };

  return (
    <div className="bg-white shadow rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            🎭 Live Agent Theater
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {isComplete
              ? "Pipeline complete — ready for merge!"
              : `${currentStage?.description ?? ""} · Iteration ${iteration}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isLive && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
              🔴 Live
            </span>
          )}
          {isComplete && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full border border-green-200">
              ✅ Complete
            </span>
          )}
          {!isLive && (
            <button
              onClick={handleReset}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Replay demo
            </button>
          )}
        </div>
      </div>

      {/* Stage progress */}
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {THEATER_STAGES.map((stage, i) => (
          <StageIndicator
            key={stage.label}
            stage={stage}
            index={i}
            currentIndex={stageIndex}
          />
        ))}
      </div>

      {/* Agent stage */}
      <div className="bg-gradient-to-b from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200">
        <div className="flex justify-around items-end gap-4 min-h-32 pt-8">
          {agents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </div>

        {/* Stage floor label */}
        <div className="mt-6 border-t-2 border-gray-300 pt-3 text-center">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            {isComplete ? "🎉 Pipeline Complete" : `Stage: ${currentStage?.label ?? ""}`}
          </span>
        </div>
      </div>

      {/* Rework indicator */}
      {iteration > 1 && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <span>🔄</span>
          <span>
            Rework in progress — iteration {iteration} (review feedback sent
            back to Dev)
          </span>
        </div>
      )}

      {isLive && pipelineState?.task && (
        <p className="text-xs text-gray-500 text-center truncate">
          {pipelineState.task}
        </p>
      )}

      {!isLive && (
        <p className="text-xs text-gray-400 text-center">
          Demo simulation — start a pipeline to see live data
        </p>
      )}
    </div>
  );
}
