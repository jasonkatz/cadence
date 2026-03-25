use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Stage {
    Pending,
    Dev,
    InReview,
    Verification,
    FinalSignoff,
    Complete,
    Failed,
    Cancelled,
}

impl Stage {
    pub fn label(&self) -> &'static str {
        match self {
            Stage::Pending => "Pending",
            Stage::Dev => "Dev",
            Stage::InReview => "In Review",
            Stage::Verification => "Verification",
            Stage::FinalSignoff => "Final Signoff",
            Stage::Complete => "Complete",
            Stage::Failed => "Failed",
            Stage::Cancelled => "Cancelled",
        }
    }

    pub fn emoji(&self) -> &'static str {
        match self {
            Stage::Pending => "⏳",
            Stage::Dev => "🔨",
            Stage::InReview => "🔍",
            Stage::Verification => "🧪",
            Stage::FinalSignoff => "📋",
            Stage::Complete => "✅",
            Stage::Failed => "❌",
            Stage::Cancelled => "🚫",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Stage::Complete | Stage::Failed | Stage::Cancelled)
    }
}

impl fmt::Display for Stage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.emoji(), self.label())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_stages() {
        assert!(Stage::Complete.is_terminal());
        assert!(Stage::Failed.is_terminal());
        assert!(Stage::Cancelled.is_terminal());
        assert!(!Stage::Pending.is_terminal());
        assert!(!Stage::Dev.is_terminal());
        assert!(!Stage::InReview.is_terminal());
        assert!(!Stage::Verification.is_terminal());
        assert!(!Stage::FinalSignoff.is_terminal());
    }

    #[test]
    fn stage_serializes_to_kebab_case() {
        let json = serde_json::to_string(&Stage::InReview).unwrap();
        assert_eq!(json, "\"in-review\"");

        let json = serde_json::to_string(&Stage::FinalSignoff).unwrap();
        assert_eq!(json, "\"final-signoff\"");
    }

    #[test]
    fn stage_deserializes_from_kebab_case() {
        let stage: Stage = serde_json::from_str("\"in-review\"").unwrap();
        assert_eq!(stage, Stage::InReview);

        let stage: Stage = serde_json::from_str("\"final-signoff\"").unwrap();
        assert_eq!(stage, Stage::FinalSignoff);
    }

    #[test]
    fn display_includes_emoji_and_label() {
        let s = format!("{}", Stage::Dev);
        assert!(s.contains("Dev"));

        let s = format!("{}", Stage::Complete);
        assert!(s.contains("Complete"));
    }
}
