# Configuration Reference

This document explains every supported environment variable in `.env` and how it affects TaskForge.

Notes:
- `.env` is loaded from the project root.
- `.env.example` contains safe defaults and comments.
- When a value is not set, defaults from `src/taskforge/config.py` apply.

Jira
- `JIRA_BASE_URL`: Jira instance URL. Required. Example: `https://yourcompany.atlassian.net`.
- `JIRA_AUTH_MODE`: `cloud` (email+token) or `server` (PAT). Default: `cloud`.
- `JIRA_EMAIL`: Atlassian email (required for `cloud`).
- `JIRA_API_TOKEN`: API token (cloud) or PAT (server). Required.
- `JIRA_JQL`: JQL filter used when syncing issues. Default: `assignee=currentUser() ORDER BY updated DESC`.
- `JIRA_TIMEOUT`: HTTP timeout in seconds for Jira calls. Default: `30`.
- `JIRA_MAX_RETRIES`: Retry count for 429/5xx responses. Default: `3`.

Blocked Detection
- `BLOCKED_LINK_KEYWORDS`: Comma-separated link types considered blockers. Default: `is blocked by,Blocked,depends on`.
- `BLOCKED_FLAG_FIELD`: Custom field name that represents a blocked flag (optional).

AI (Local)
- `AI_PROVIDER`: `ollama` or `huggingface`. Default: `ollama`.
- `OLLAMA_HOST`: Ollama API base URL. Default: `http://localhost:11434`.
- `AI_MODEL_DEFAULT`: Default model. Use `auto` to pick from `AI_MODELS`.
- `AI_MODEL_FAST`: Small/fast model tier.
- `AI_MODEL_REASON`: Reasoning model tier.
- `AI_MODEL_HEAVY`: Largest/slowest model tier.
- `AI_MODELS`: Optional comma-separated model list with strengths and providers.
  Format: `name=strength` and optional `*` for default.
  Provider tag: `@local` (default) or `@groq`.
  Example: `llama3.1:8b-instruct-q4_K_M@local=5*,phi3:mini@local=1,llama-3.1-8b-instant@groq=4`.
- `AI_SKIP_LOCAL`: If `true`, route all AI calls directly to Groq.

Groq (Cloud)
- `GROQ_API_KEY`: Groq API key. If invalid/expired you will see a clear 401 error in the UI.
- `GROQ_BASE_URL`: Groq API base URL. Default: `https://api.groq.com`.
- `GROQ_MODEL_DEFAULT`: Default Groq model if none is specified.

Advisor Prompt Options
- `ADVISOR_INCLUDE_CURRENT_DESCRIPTION`: Include current task description in advisor prompt. Default: `true`.
- `ADVISOR_INCLUDE_SUBTASK_DESCRIPTIONS`: Include subtask descriptions. Default: `false`.
- `ADVISOR_INCLUDE_PARENT_DESCRIPTION`: Include parent description. Default: `false`.

Model Storage Paths
- `OLLAMA_MODELS_DIR`: Custom path for Ollama models (optional).
- `GGUF_MODEL_DIR`: GGUF/llama.cpp model directory. Default: `~/.cache/taskforge/models`.
- `HF_HOME`: Hugging Face cache root (optional).
- `TRANSFORMERS_CACHE`: Transformers cache path (optional).
- `HUGGINGFACE_HUB_CACHE`: HF Hub cache path (optional).

Paths
- `OUTPUT_DIR`: Output directory for `out/tasks.json` and `out/tasks_tree.json`. Default: `out`.
- `DATA_DIR`: Data directory for snapshots and SQLite. Default: `data`.

Logging
- `LOG_LEVEL`: `DEBUG`, `INFO`, `WARNING`, `ERROR`. Default: `INFO`.
- `LOG_FILE`: Log file path. Default: `logs/taskforge.log`.
- `LOG_JSON`: `true` to emit JSON logs. Default: `false`.
