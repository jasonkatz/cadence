interface AchievementDef {
  id: string;
  label: string;
  description: string;
  icon: string;
}

const ALL_ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first-workflow",
    label: "First Pipeline",
    description: "Completed your first Cadence workflow",
    icon: "🎯",
  },
  {
    id: "first-clean-review",
    label: "Zero-Comment Review",
    description: "PR passed review with zero comments",
    icon: "💎",
  },
  {
    id: "ten-workflows",
    label: "Workflow Veteran",
    description: "Completed 10 workflows — you're a pro",
    icon: "🏆",
  },
  {
    id: "survived-max-iters",
    label: "Survived Max Iterations",
    description: "Survived all 8 iterations and still shipped",
    icon: "💪",
  },
  {
    id: "speed-run",
    label: "Speed Run",
    description: "Passed CI, review, and E2E on the first try",
    icon: "⚡",
  },
];

interface BadgeProps {
  achievement: AchievementDef;
  earned: boolean;
}

function Badge({ achievement, earned }: BadgeProps) {
  return (
    <div
      title={achievement.description}
      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all duration-300 ${
        earned
          ? "bg-amber-50 border-amber-300 shadow-sm"
          : "bg-gray-50 border-gray-200 opacity-50 grayscale"
      }`}
    >
      <span className="text-2xl">{achievement.icon}</span>
      <span className="text-xs font-medium text-center text-gray-700 leading-tight max-w-16">
        {achievement.label}
      </span>
      {earned && (
        <span className="text-xs text-amber-600 font-semibold">Earned</span>
      )}
    </div>
  );
}

interface AchievementBadgesProps {
  /** IDs of achievements that have been earned. */
  earned: string[];
}

export function AchievementBadges({ earned }: AchievementBadgesProps) {
  const earnedSet = new Set(earned);
  const earnedCount = ALL_ACHIEVEMENTS.filter((a) =>
    earnedSet.has(a.id),
  ).length;

  return (
    <div className="bg-white shadow rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">🏅 Achievements</h2>
        <span className="text-sm text-gray-500">
          {earnedCount}/{ALL_ACHIEVEMENTS.length} earned
        </span>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {ALL_ACHIEVEMENTS.map((achievement) => (
          <Badge
            key={achievement.id}
            achievement={achievement}
            earned={earnedSet.has(achievement.id)}
          />
        ))}
      </div>

      {earnedCount === 0 && (
        <p className="text-sm text-gray-400 text-center py-2">
          Run your first pipeline to start earning badges!
        </p>
      )}
    </div>
  );
}
