use serde::{Deserialize, Serialize};

/// Team vibe that affects status messages and PR comment tone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Personality {
    #[default]
    Default,
    Pirate,
    Space,
    Cooking,
}

impl Personality {
    pub fn label(&self) -> &'static str {
        match self {
            Personality::Default => "Default",
            Personality::Pirate => "Pirate Crew 🏴‍☠️",
            Personality::Space => "Space Mission 🚀",
            Personality::Cooking => "Cooking Show 👨‍🍳",
        }
    }

    pub fn stage_message(&self, stage: &str) -> String {
        match self {
            Personality::Default => stage.to_string(),
            Personality::Pirate => Self::pirate_stage(stage),
            Personality::Space => Self::space_stage(stage),
            Personality::Cooking => Self::cooking_stage(stage),
        }
    }

    fn pirate_stage(stage: &str) -> String {
        match stage {
            "Dev" => "🏴‍☠️ Arrr! Scribin' the treasure code".to_string(),
            "In Review" => "🔭 Avast! The lookout be reviewin' the plank".to_string(),
            "Verification" => "🦜 Squawk! Testin' the seven seas of bugs".to_string(),
            "Final Signoff" => "⚓ Make ready to port — final inspection!".to_string(),
            "Complete" => "🏴‍☠️ Shiver me timbers! She be ship-shape!".to_string(),
            "Failed" => "☠️  Davy Jones has claimed this voyage".to_string(),
            _ => stage.to_string(),
        }
    }

    fn space_stage(stage: &str) -> String {
        match stage {
            "Dev" => "🚀 T-minus zero — initiating launch sequence".to_string(),
            "In Review" => "🛸 Entering orbit — mission control reviewing".to_string(),
            "Verification" => "🌌 Deep scan active — checking all systems".to_string(),
            "Final Signoff" => "🪐 Re-entry approach — final systems check".to_string(),
            "Complete" => "🌟 Mission success — splashdown confirmed!".to_string(),
            "Failed" => "💥 Houston, we have a problem".to_string(),
            _ => stage.to_string(),
        }
    }

    fn cooking_stage(stage: &str) -> String {
        match stage {
            "Dev" => "👨‍🍳 Prepping the mise en place — let's cook!".to_string(),
            "In Review" => "🍽️  The head chef is tasting the dish".to_string(),
            "Verification" => "🧂 Verifying every ingredient is balanced".to_string(),
            "Final Signoff" => "🔥 Plating up — final presentation!".to_string(),
            "Complete" => "⭐ Chef's kiss — a perfectly executed dish!".to_string(),
            "Failed" => "🔥 Something burned in the kitchen".to_string(),
            _ => stage.to_string(),
        }
    }

    pub fn rework_message(&self, iteration: u32) -> String {
        match self {
            Personality::Default => format!("Iteration {iteration} — fixing issues"),
            Personality::Pirate => {
                format!("Batten down the hatches! Iteration {iteration} — back to the map!")
            }
            Personality::Space => {
                format!("Course correction {iteration} — recalculating trajectory")
            }
            Personality::Cooking => {
                format!("Back to the stove! Iteration {iteration} — adjusting the recipe")
            }
        }
    }

    pub fn ci_pass_message(&self) -> &'static str {
        match self {
            Personality::Default => "CI passed",
            Personality::Pirate => "Arrr! The CI seas be calm and passin'!",
            Personality::Space => "All systems nominal — CI is go!",
            Personality::Cooking => "No smoke, no fire — CI baked to perfection!",
        }
    }

    pub fn review_clean_message(&self) -> &'static str {
        match self {
            Personality::Default => "Review clean — 0 comments",
            Personality::Pirate => "Arrr, this be fine code! No complaints from the crew!",
            Personality::Space => "Mission control approves — zero anomalies detected",
            Personality::Cooking => "Head chef tasted it — no notes, flawless execution!",
        }
    }

    /// Returns an optional system-level tone instruction to prepend to reviewer
    /// prompts so PR comments reflect the chosen personality vibe.
    pub fn review_tone_instruction(&self) -> Option<&'static str> {
        match self {
            Personality::Default => None,
            Personality::Pirate => Some(
                "You are a pirate crew member reviewing this code. \
                 Phrase all review feedback in pirate speak (e.g., \"Arrr, \
                 this function be missin' error handling, matey!\"). \
                 Keep the technical critique accurate — only the tone changes.",
            ),
            Personality::Space => Some(
                "You are a mission control specialist reviewing this code. \
                 Frame all review feedback as mission briefings and telemetry \
                 reports (e.g., \"Anomaly detected in navigation subsystem — \
                 error handler missing on re-entry path\"). \
                 Keep the technical critique accurate — only the tone changes.",
            ),
            Personality::Cooking => Some(
                "You are a head chef reviewing this code as if it were a recipe. \
                 Frame all review feedback as culinary critique \
                 (e.g., \"This function needs more seasoning — the error case \
                 is under-cooked and will leave users hungry for a proper response\"). \
                 Keep the technical critique accurate — only the tone changes.",
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_passes_stage_name_through() {
        let p = Personality::Default;
        assert_eq!(p.stage_message("Dev"), "Dev");
        assert_eq!(p.stage_message("In Review"), "In Review");
    }

    #[test]
    fn pirate_dev_message_contains_pirate_flavor() {
        let msg = Personality::Pirate.stage_message("Dev");
        assert!(msg.contains("Arr") || msg.contains("treasure") || msg.contains("🏴"));
    }

    #[test]
    fn space_complete_mentions_mission() {
        let msg = Personality::Space.stage_message("Complete");
        assert!(msg.to_lowercase().contains("mission"));
    }

    #[test]
    fn cooking_rework_message_mentions_recipe() {
        let msg = Personality::Cooking.rework_message(3);
        assert!(msg.contains("recipe") || msg.contains("stove"));
    }

    #[test]
    fn all_personalities_have_non_empty_labels() {
        for p in [
            Personality::Default,
            Personality::Pirate,
            Personality::Space,
            Personality::Cooking,
        ] {
            assert!(!p.label().is_empty(), "{p:?} label is empty");
        }
    }

    #[test]
    fn serializes_to_kebab_case() {
        assert_eq!(
            serde_json::to_string(&Personality::Pirate).unwrap(),
            "\"pirate\""
        );
        assert_eq!(
            serde_json::to_string(&Personality::Space).unwrap(),
            "\"space\""
        );
    }

    #[test]
    fn deserializes_from_kebab_case() {
        let p: Personality = serde_json::from_str("\"cooking\"").unwrap();
        assert_eq!(p, Personality::Cooking);
    }

    #[test]
    fn unknown_stage_falls_through_to_name_for_pirate() {
        let msg = Personality::Pirate.stage_message("SomethingUnknown");
        assert_eq!(msg, "SomethingUnknown");
    }

    #[test]
    fn default_has_no_review_tone_instruction() {
        assert!(Personality::Default.review_tone_instruction().is_none());
    }

    #[test]
    fn non_default_personalities_have_review_tone_instructions() {
        for p in [Personality::Pirate, Personality::Space, Personality::Cooking] {
            assert!(
                p.review_tone_instruction().is_some(),
                "{p:?} missing review tone instruction"
            );
        }
    }

    #[test]
    fn pirate_review_tone_mentions_pirate() {
        let instruction = Personality::Pirate.review_tone_instruction().unwrap();
        assert!(
            instruction.to_lowercase().contains("pirate"),
            "Pirate review tone should reference pirate theme"
        );
    }
}
