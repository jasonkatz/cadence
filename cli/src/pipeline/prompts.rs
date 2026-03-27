use crate::pipeline::state::WorkflowState;

pub fn dev_implement_prompt(state: &WorkflowState) -> String {
    let req_context = requirements_context(state);

    format!(
        "TASK: {task}\n\n\
         WORKING DIRECTORY: {repo_dir}\n\
         BRANCH: {branch}\n\
         {req_context}\n\n\
         After implementing:\n\
         1. Run verification yourself and confirm all tests pass\n\
         2. Commit using imperative subject (~50 chars), explain what/why in body\n\
         3. Push to origin/{branch}\n\
         4. Do NOT create a PR — the pipeline handles that\n\n\
         Output: files changed, test count + pass/fail, known gaps.",
        task = state.task,
        repo_dir = state.repo_dir.display(),
        branch = state.branch,
    )
}

pub fn dev_fix_review_prompt(
    state: &WorkflowState,
    comment_count: u64,
    comment_text: &str,
) -> String {
    let req_context = requirements_context(state);

    format!(
        "Code review on PR #{pr_num} (iteration {iter}) left {comment_count} comments. \
         Address ALL comments, run tests locally, commit (imperative subject, what/why) \
         and push to {branch}.\n\n\
         {req_context}\n\n\
         REVIEW COMMENTS:\n{comment_text}",
        pr_num = state.pr_number.unwrap_or(0),
        iter = state.iteration,
        branch = state.branch,
    )
}

pub fn dev_fix_e2e_prompt(state: &WorkflowState, verifier_feedback: &str) -> String {
    let req_context = requirements_context(state);

    format!(
        "E2E validation on PR #{pr_num} failed verification (iteration {iter}). \
         The behaviors do not match the requirements. Fix the issues, run tests locally, \
         commit (imperative subject, what/why) and push to {branch}.\n\n\
         {req_context}\n\n\
         E2E VERIFICATION FEEDBACK:\n{verifier_feedback}",
        pr_num = state.pr_number.unwrap_or(0),
        iter = state.iteration,
        branch = state.branch,
    )
}

pub fn dev_feedback_prompt(state: &WorkflowState, feedback: &str) -> String {
    let req_context = requirements_context(state);

    format!(
        "You are iterating on PR #{pr_num} on {repo} based on human feedback.\n\
         BRANCH: {branch}\n\
         WORKING DIRECTORY: {repo_dir}\n\
         {req_context}\n\n\
         TASK: {task}\n\n\
         HUMAN FEEDBACK:\n{feedback}\n\n\
         Instructions:\n\
         1. Read the current PR diff: gh pr diff {pr_num} --repo {repo}\n\
         2. Read the requirements file if one exists\n\
         3. Address the human feedback\n\
         4. Run verification and confirm all tests pass\n\
         5. Commit using imperative subject (~50 chars), explain what/why in body\n\
         6. Push to origin/{branch}\n\n\
         Output: files changed, test count + pass/fail, known gaps.",
        pr_num = state.pr_number.unwrap_or(0),
        repo = state.repo,
        repo_dir = state.repo_dir.display(),
        branch = state.branch,
        task = state.task,
    )
}

pub fn review_prompt(state: &WorkflowState) -> String {
    let req_context = requirements_context(state);

    format!(
        "You are reviewing PR #{pr_num} on {repo}.\n\
         Branch: {branch}\n\
         {req_context}\n\n\
         TASK BEING REVIEWED: {task}\n\n\
         Instructions:\n\
         1. Check GHA status: gh pr checks {pr_num} --repo {repo}\n\
            - If checks are failing, leave a single comment with failure details\n\
         2. Read the PR diff: gh pr diff {pr_num} --repo {repo}\n\
         3. Read the requirements file if one exists\n\
         4. Review for correctness, tests, security, quality\n\
         5. For each blocking issue: gh pr comment {pr_num} --repo {repo} --body \"<comment>\"\n\
         6. For inline issues: gh api repos/{repo}/pulls/{pr_num}/comments \
            -f body=\"<comment>\" -f path=\"<file>\" \
            -f commit_id=\"$(gh pr view {pr_num} --repo {repo} --json headRefOid --jq .headRefOid)\" \
            -F line=<line>\n\n\
         If GHA passes and implementation is correct: leave NO comments.\n\
         If issues exist: one PR comment per blocking issue.\n\n\
         End your response with this JSON block:\n\
         ```json\n\
         {{\"review_pass\": true | false, \"issues\": [\"...\"], \"summary\": \"...\"}}\n\
         ```",
        pr_num = state.pr_number.unwrap_or(0),
        repo = state.repo,
        branch = state.branch,
        task = state.task,
    )
}

pub fn e2e_prompt(state: &WorkflowState) -> String {
    let req_context = requirements_context(state);

    format!(
        "You are validating PR #{pr_num} on {repo} end-to-end.\n\
         Branch: {branch}\n\
         Working directory: {repo_dir}\n\
         {req_context}\n\n\
         TASK: {task}\n\n\
         Instructions:\n\
         1. Run `uvx showboat --help` to learn how to use showboat for evidence documentation\n\
         2. Run `uvx rodney --help` to learn how to use rodney for browser automation and screenshots\n\
         3. Read the requirements to understand expected behaviors\n\
         4. Set up a fully running local environment (server, database, dependencies)\n\
         5. Detect which surfaces exist (server/, cli/, client/) — only test present ones\n\
         6. Validate real user journeys:\n\
            - API (if server/ exists): test actual HTTP endpoints with curl\n\
            - CLI (if cli/ exists): test CLI commands\n\
            - UI (if client/ exists): use rodney for browser automation and screenshots\n\
         7. Do NOT run unit tests — covered by CI\n\
         8. Focus on proving actual behaviors work end-to-end\n\
         9. Use showboat to compile your evidence document\n\
         10. Post the evidence as a PR comment:\n\
            gh pr comment {pr_num} --repo {repo} --body \"<showboat evidence>\"\n\n\
         The showboat document is the primary evidence the human will review.",
        pr_num = state.pr_number.unwrap_or(0),
        repo = state.repo,
        repo_dir = state.repo_dir.display(),
        branch = state.branch,
        task = state.task,
    )
}

pub fn e2e_verify_prompt(state: &WorkflowState, artifact: &str) -> String {
    let req_context = requirements_context(state);

    format!(
        "PR #{pr_num} on {repo}\n\
         {req_context}\n\n\
         TASK: {task}\n\n\
         Below is the E2E artifact produced by the validation agent. Your job:\n\
         1. Read the requirements to understand expected behaviors\n\
         2. Compare the artifact against the requirements\n\
         3. Assess: does the artifact prove the expected behaviors work?\n\
         4. Check: are there behaviors NOT validated?\n\
         5. Check: did any validation steps fail?\n\n\
         E2E ARTIFACT:\n{artifact}\n\n\
         Structure your response as a brief verification report with your insights.\n\
         Do NOT post PR comments — the pipeline will post your verification.\n\n\
         End with this JSON block (mandatory):\n\
         ```json\n\
         {{\n\
           \"e2e_pass\": true | false,\n\
           \"issues\": [\"description of each issue\"],\n\
           \"missing_coverage\": [\"behaviors not validated\"],\n\
           \"summary\": \"one-line assessment\"\n\
         }}\n\
         ```\n\n\
         If all required behaviors are validated and passing, set e2e_pass to true.\n\
         If anything is missing or failing, set e2e_pass to false.",
        pr_num = state.pr_number.unwrap_or(0),
        repo = state.repo,
        task = state.task,
    )
}

pub fn update_pr_prompt(state: &WorkflowState) -> String {
    let req_context = requirements_context(state);

    format!(
        "Update PR #{pr_num} on {repo} with a current title and description.\n\n\
         TASK: {task}\n\
         BRANCH: {branch}\n\
         ITERATION: {iter}/{max}\n\
         {req_context}\n\n\
         Instructions:\n\
         1. Read the PR diff: gh pr diff {pr_num} --repo {repo}\n\
         2. Write a title: concise imperative summary of what the PR does (~50 chars, capitalized, no period)\n\
         3. Write the description using this template:\n\n\
         ## Context\n\
         One or two sentences: what this PR does and why.\n\n\
         ## Changes\n\
         - Bulleted list of key changes (3-6 items, focused on external-facing behaviors)\n\n\
         ## Testing\n\
         Brief note on how changes were verified.\n\n\
         ---\n\
         _cadence · iteration {{iter}}/{{max}}_\n\n\
         4. Update: gh pr edit {pr_num} --repo {repo} --title \"<title>\" --body \"<description>\"\n\n\
         Keep it brief — a human should grasp intent, scope, and risk at a glance.",
        pr_num = state.pr_number.unwrap_or(0),
        repo = state.repo,
        branch = state.branch,
        task = state.task,
        iter = state.iteration,
        max = state.max_iters,
    )
}

fn requirements_context(state: &WorkflowState) -> String {
    match &state.requirements {
        Some(req) => format!("Requirements file: {req} (in repo root)"),
        None => "Requirements: see TASK description above".to_string(),
    }
}
