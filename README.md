# TaskForge

**Local-first Jira assistant** with deterministic queries and local AI.

TaskForge fetches your Jira issues, normalizes them into a stable schema, stores snapshots locally, and provides powerful deterministic queries — plus a local AI layer (with optional Groq routing) for natural-language summaries and recommendations.

## Features

- **Jira Sync** — Paginated fetch with retry/backoff, Cloud + Server auth, parent/subtask/linked-issue chasing
- **Strict Schema** — Every issue normalized to a stable structure (no missing keys)
- **ADF Parser** — Extracts plain text from Jira Cloud's Atlassian Document Format
- **Deterministic Queries** — Blocked detection, priority-based ranking with score breakdown, by-project grouping, today filter
- **Storage** — JSON snapshots + SQLite history tracking
- **Structured Outputs** — JSON, Markdown report, Rich CLI table
- **Local AI** — Ollama (primary) + HuggingFace/GGUF (secondary), privacy-friendly by default
- **Groq (Optional)** — Cloud fallback or direct routing when you need more reliability/quality
- **AI Doctor** — Hardware detection, model recommendations, diagnostics

## Quick Start

### 1. Install (Ubuntu)

```bash
# System dependencies
sudo apt update && sudo apt install -y python3 python3-pip python3-venv git curl

# Install Ollama (local AI)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull phi3:mini

# Clone and install TaskForge
git clone <repo-url> taskforge && cd taskforge
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your Jira credentials:
#   JIRA_BASE_URL=https://yourcompany.atlassian.net
#   JIRA_EMAIL=you@example.com
#   JIRA_API_TOKEN=your-token
#   JIRA_AUTH_MODE=cloud
```

### 3. Initialize & Sync

```bash
jira-assist init        # Create directories and .env
jira-assist auth-test   # Verify Jira auth works
jira-assist sync        # Fetch and store all issues
```

### 4. Query

```bash
jira-assist render table              # Rich table view
jira-assist render json               # JSON output
jira-assist render md                 # Markdown report
jira-assist query blocked             # Show blocked issues
jira-assist query next --top 5        # Top 5 recommended tasks
jira-assist query by-project          # Group by project
jira-assist query today               # Today's issues
```

### 5. AI Commands

```bash
jira-assist ai today                  # AI summary of today
jira-assist ai next                   # AI-powered recommendations
jira-assist ai ask "What's overdue?"  # Free-form question
jira-assist ai models list            # List available models
jira-assist ai set-model phi3:mini    # Change default model
jira-assist ai doctor                 # AI diagnostics
```

### 5b. Groq (Optional)

Set your Groq API key in `.env` and (optionally) add Groq models to `AI_MODELS` so the UI can list them:

```bash
GROQ_API_KEY=your-groq-api-key
AI_MODELS=llama3.1:8b-instruct-q4_K_M@local=5*,phi3:mini@local=1,llama-3.1-8b-instant@groq=4
```

In the GUI, use “Skip local (Groq)” in the Advisor to route directly to Groq.

### 6. Diagnostics

```bash
jira-assist doctor    # Full system check
```

### 7. Web GUI (New!)

TaskForge now includes a powerful local Web UI for browsing issues, visualizing relationships, and interacting with AI.

#### Install GUI dependencies
```bash
pip install -e ".[gui]"
```

#### Run the GUI
```bash
jira-assist gui
# Opens http://localhost:8765
```

**GUI Features:**
- **Split-Pane Browsing**: List/Tree view on left, Details/Focus/Graph on right
- **Focus Mode**: See parent, subtasks, siblings, and linked issues in one view
- **Graph View**: Interactive relationship visualization
- **AI Chat**: Context-aware chat with "Summarize Today" and "What Next?" presets
- **Dark Mode**: Toggle via header icon
- **Search**: JQL and text search against local cache

#### Running with Docker
The Docker image includes the GUI by default.

```bash
docker compose up
# GUI available at http://localhost:8765
```

## Project Structure

```
taskforge/
├── src/taskforge/
│   ├── __init__.py          # Package version
│   ├── config.py            # Pydantic settings from .env
│   ├── jira_client.py       # Jira REST API client
│   ├── normalizer.py        # ADF parser + schema normalizer
│   ├── tree.py              # Hierarchy tree builder
│   ├── storage.py           # JSON snapshots + SQLite
│   ├── queries.py           # Deterministic queries
│   ├── renderer.py          # JSON / Markdown / Rich table
│   ├── ai/
│   │   ├── __init__.py      # Provider factory
│   │   ├── base.py          # Abstract provider interface
│   │   ├── ollama.py        # Ollama HTTP provider
│   │   ├── huggingface.py   # GGUF / llama.cpp provider
│   │   ├── prompts.py       # Context-grounded prompt builder
│   │   └── doctor.py        # Hardware detection + model recs
│   └── cli/
│       ├── __init__.py      # App export
│       ├── main.py          # init, auth-test, sync, render, doctor
│       ├── query.py         # blocked, next, by-project, today
│       └── ai_cmd.py        # AI sub-commands
├── tests/
│   ├── test_normalizer.py   # ADF + schema tests
│   ├── test_queries.py      # Blocked + ranking tests
│   └── test_tree.py         # Hierarchy tests
├── out/                     # Latest outputs (generated)
├── data/                    # Snapshots + SQLite (generated)
├── docs/
│   └── troubleshooting.md
├── .env.example
├── .gitignore
├── Makefile
├── pyproject.toml
└── README.md
```

## Configuration Reference

Full configuration details: `docs/configuration.md`

| Variable | Default | Description |
|----------|---------|-------------|
| `JIRA_BASE_URL` | — | Jira instance URL |
| `JIRA_AUTH_MODE` | `cloud` | `cloud` or `server` |
| `JIRA_EMAIL` | — | Atlassian email (cloud only) |
| `JIRA_API_TOKEN` | — | API token or PAT |
| `JIRA_JQL` | `assignee=currentUser()...` | JQL filter |
| `JIRA_TIMEOUT` | `30` | Request timeout (seconds) |
| `JIRA_MAX_RETRIES` | `3` | Max retry attempts |
| `BLOCKED_LINK_KEYWORDS` | `is blocked by,...` | Blocked link detection |
| `BLOCKED_FLAG_FIELD` | — | Optional custom impediment field |
| `AI_PROVIDER` | `ollama` | `ollama` or `huggingface` |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API URL |
| `AI_MODEL_DEFAULT` | `phi3:mini` | Default model |
| `AI_MODEL_FAST` | `phi3:mini` | Fast/small model |
| `AI_MODEL_REASON` | `phi3:mini` | Reasoning model |
| `AI_MODEL_HEAVY` | `phi3:medium` | Heavy/large model |
| `AI_MODELS` | — | Optional model list with strengths and providers |
| `AI_SKIP_LOCAL` | `false` | Skip local LLM and route to Groq |
| `GROQ_API_KEY` | — | Groq API key |
| `GROQ_BASE_URL` | `https://api.groq.com` | Groq API base URL |
| `GROQ_MODEL_DEFAULT` | `llama3.1-8b-instant` | Default Groq model |
| `ADVISOR_INCLUDE_CURRENT_DESCRIPTION` | `true` | Include current description in advisor prompt |
| `ADVISOR_INCLUDE_SUBTASK_DESCRIPTIONS` | `false` | Include subtask descriptions |
| `ADVISOR_INCLUDE_PARENT_DESCRIPTION` | `false` | Include parent description |
| `GGUF_MODEL_DIR` | `~/.cache/taskforge/models` | GGUF model directory |
| `OUTPUT_DIR` | `out` | Output directory |
| `DATA_DIR` | `data` | Data directory |
| `LOG_LEVEL` | `INFO` | Logging level |
| `LOG_FILE` | `logs/taskforge.log` | Log file path |
| `LOG_JSON` | `false` | JSON logs |

## Hardware Profiles

| Profile | RAM | GPU | Recommended Model |
|---------|-----|-----|-------------------|
| Laptop | 8GB | GTX 1050 | `phi3:mini` (CPU mode) |
| Desktop | 16GB | RTX 2080 | `phi3:medium` (GPU layers) |

## Key Principles

1. **Facts from code, summaries from AI** — All filtering, blocking detection, and ranking use deterministic logic. AI only summarizes/explains the pre-computed data.
2. **Works without AI** — `sync`, `render`, `query` commands work perfectly without Ollama.
3. **Privacy-first by default** — All AI runs locally unless Groq is enabled.
4. **Deterministic outputs** — Same data → same query results, every time.

## Docs

- `docs/configuration.md` — Full .env reference
- `docs/prompting.md` — Prompting and routing behavior
- `docs/troubleshooting.md` — Common issues and fixes

## Running Tests

```bash
pip install -e ".[dev]"
pytest tests/ -v
```

## License

MIT
