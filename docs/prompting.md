# Prompting Guide

This document explains how TaskForge builds prompts, what data is provided, and how to customize behavior.

Overview
- Prompts are built in `src/taskforge/ai/prompts.py`.
- The AI provider wraps prompts with a strict grounding instruction and a TASK DATA JSON block.
- AI is used to summarize or explain data. Deterministic queries and rankings come from code.

TASK DATA JSON
- A compact JSON list of issues is passed to the model.
- Each item includes key fields like `key`, `summary`, `status`, `priority`, `dueDate`, `projectKey`, and `parentKey`.
- Descriptions are truncated to keep context small.

Command Prompts
- Today (`jira-assist ai today`):
  - Groups by project and highlights overdue/blockers.
  - Output is concise, action-oriented, and includes flags.
- Next (`jira-assist ai next`):
  - Uses the deterministic rank order as ground truth.
  - Returns 3-5 recommendations with reasons based on the score breakdown.
- Ask (`jira-assist ai ask "..."`):
  - Answers only using the provided data.
  - If the data does not contain the answer, the response should say "Not in data".
- Advisor (`/advisor/run/{key}`):
  - Produces JSON with keys `action`, `blockers`, `inconsistencies`, `missing`.
  - Output is validated; invalid JSON triggers a Groq fallback if configured.

Routing and Fallback
- Local LLM is preferred by default.
- If validation fails, the router falls back to Groq (if configured).
- `AI_SKIP_LOCAL=true` routes all requests directly to Groq.

Customization
- Edit `src/taskforge/ai/prompts.py` to adjust tone or formatting.
- Adjust `ADVISOR_INCLUDE_*` flags to include or omit descriptions.
- Tune `AI_MODELS` and `AI_MODEL_*` to control model selection.
