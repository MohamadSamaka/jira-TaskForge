# Troubleshooting Guide

## Jira Connection Issues

### "Authentication failed" on `auth-test`

1. **Cloud users**: Verify `JIRA_AUTH_MODE=cloud`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in `.env`
   - API tokens: [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   - Token is NOT your password — generate a dedicated API token

2. **Server/DC users**: Set `JIRA_AUTH_MODE=server` and use a Personal Access Token
   - Go to Jira → Profile → Personal Access Tokens → Create

3. **Base URL**: Must include protocol, no trailing slash
   - ✅ `https://yourcompany.atlassian.net`
   - ❌ `yourcompany.atlassian.net`
   - ❌ `https://yourcompany.atlassian.net/`

### "HTTP 429" — Rate Limited

TaskForge has built-in retry with exponential backoff. If you keep hitting limits:
- Increase `JIRA_TIMEOUT` (default 30s)
- Reduce sync frequency
- Check if Jira has rate limit headers enabled

### "HTTP 403" — Forbidden

- Verify your account has permission to access the project
- For Server/DC, ensure PAT has the correct scopes
- Check if IP allowlisting is blocking requests

### Pagination not working

TaskForge uses POST to `/rest/api/3/search` with automatic fallback to `/rest/api/3/search/jql` and GET. If issues:
- Verify JQL in `JIRA_JQL` is valid
- Check Jira instance version (API v3 is Cloud, v2 may be needed for older Server)

---

## AI / Ollama Issues

### "Cannot connect to Ollama"

1. Start Ollama: `ollama serve`
2. Check it's running: `curl http://localhost:11434/api/tags`
3. Verify `OLLAMA_HOST` in `.env` (default: `http://localhost:11434`)
4. If using a custom port: `OLLAMA_HOST=http://localhost:YOUR_PORT`

### "Model not found"

Pull the model first:
```bash
ollama pull phi3:mini
```

List available models:
```bash
jira-assist ai models list
# or directly:
ollama list
```

### AI responses are slow

- **CPU mode**: Expected on 8GB RAM. `phi3:mini` takes 10-30s per response.
- **GPU acceleration**: Ollama auto-detects NVIDIA GPUs with proper drivers.
  - Install NVIDIA drivers: `sudo apt install nvidia-driver-535`
  - Verify: `nvidia-smi`
- **Switch to a smaller model**: `jira-assist ai set-model phi3:mini`

### Model storage location

- **Ollama models**: `~/.ollama/models/` (default)
  - Change with `OLLAMA_MODELS` env var (Ollama config)
- **GGUF models**: `~/.cache/taskforge/models/` (configurable via `GGUF_MODEL_DIR`)
- Check with: `jira-assist ai doctor`

### Out of memory (OOM)

- Use smaller quantized models: `phi3:mini` (Q4 ~2.3GB RAM)
- Close Docker containers to free RAM
- Check RAM usage: `free -h`
- Reduce context: TaskForge auto-limits context to 50 issues

---

---

## Groq Issues

### "model_not_found" or HTTP 404 from Groq

This usually means a **local model name** was sent to Groq (e.g., `llama3.1:8b-instruct-q4_K_M`).

Fix:
- Ensure `GROQ_API_KEY` is set in `.env`
- Use Groq model names (no local quantization suffixes)
- Add Groq models to `AI_MODELS` with `@groq`:
  - `AI_MODELS=llama3.1:8b-instruct-q4_K_M@local=5*,llama-3.1-8b-instant@groq=4`
- Or set `GROQ_MODEL_DEFAULT` and leave model blank in requests

### "Groq authentication failed" / token expired

If your Groq API token expires or is revoked, the UI will show a red warning and API calls will return a 401.

Fix:
- Replace `GROQ_API_KEY` in `.env`
- Restart the API/GUI (`jira-assist gui`)

---

## Storage Issues

### "No synced issues found"

Run `jira-assist sync` first. Outputs go to:
- `out/tasks.json` — flat normalized issues
- `out/tasks_tree.json` — nested hierarchy
- `data/snapshots/` — timestamped archives
- `data/jira.sqlite` — history database

### SQLite locked

If you see "database is locked":
- Only one sync should run at a time
- Check for zombie processes: `ps aux | grep jira-assist`
- SQLite uses WAL mode for better concurrency

### Cleaning up

```bash
# Remove all data and start fresh
rm -rf out/ data/

# Re-initialize
jira-assist init
jira-assist sync
```

---

## Logging & Debugging

### Centralized logs

TaskForge writes logs to both console and a rotating log file.
Defaults (can be overridden in `.env`):

- `LOG_LEVEL=INFO`
- `LOG_FILE=logs/taskforge.log`
- `LOG_JSON=false`

### Enable verbose logging

Use CLI verbose mode:
```bash
jira-assist --verbose sync
```

Or set `.env`:
```bash
LOG_LEVEL=DEBUG
```

### JSON logs

If you want structured logs for tooling:
```bash
LOG_JSON=true
```

Logs rotate at ~5MB and keep up to 5 backups by default.

---

## Installation Issues

### pip install fails

```bash
# Make sure you're in a virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### `jira-assist` command not found

```bash
# Option 1: Activate virtual env
source .venv/bin/activate

# Option 2: Run as module
python -m taskforge.cli
```

### GPU detection issues

Run diagnostics:
```bash
jira-assist ai doctor
```

For NVIDIA GPU support:
```bash
# Install drivers
sudo apt install nvidia-driver-535

# Verify
nvidia-smi

# Check CUDA
python3 -c "import torch; print(torch.cuda.is_available())"
```

---

## Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| `JIRA_BASE_URL not set` | Missing `.env` config | Copy `.env.example` → `.env` and fill in values |
| `HTTP 401 Unauthorized` | Bad credentials | Regenerate API token |
| `Connection refused` | Wrong URL or VPN issue | Check `JIRA_BASE_URL` and network |
| `No synced issues` | Haven't synced yet | Run `jira-assist sync` |
| `Ollama connect error` | Ollama not running | Start with `ollama serve` |
| `Model not found` | Model not pulled | Run `ollama pull phi3:mini` |
