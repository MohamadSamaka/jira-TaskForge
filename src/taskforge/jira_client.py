"""Jira API client — paginated fetcher with retry/backoff and dual auth modes.

API Assumptions:
- Jira Cloud uses REST API v3 (/rest/api/3/...)
- Jira Server/DC may need v2 (/rest/api/2/...) which is tried as fallback
- Search POST endpoint is preferred; GET fallback for older instances
- Pagination uses startAt/maxResults with total from response
- Auth: Cloud uses Basic Auth (email:token), Server uses Bearer PAT
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from taskforge.config import Settings, get_settings

logger = logging.getLogger(__name__)

# Fields to request from Jira (keeps responses manageable).
# These are standard Jira fields available in both Cloud and Server.
ISSUE_FIELDS = [
    "summary",
    "status",
    "priority",
    "assignee",
    "issuetype",
    "created",
    "updated",
    "duedate",
    "description",
    "parent",        # Cloud v3 field — parent epic/story
    "subtasks",      # Always available
    "issuelinks",    # Always available
    "labels",
    "components",
    "project",
]


class JiraClientError(Exception):
    """Raised on unrecoverable Jira API errors."""


class JiraClient:
    """Handles all communication with the Jira REST API."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._client: httpx.Client | None = None

        # Validate config before doing anything
        errors = self.settings.validate_jira_config()
        if errors:
            raise JiraClientError(
                "Jira configuration errors:\n  • " + "\n  • ".join(errors)
            )

    # ── HTTP plumbing ─────────────────────────────────────────────────

    def _build_client(self) -> httpx.Client:
        headers: dict[str, str] = {"Accept": "application/json"}
        auth = None

        base_url = self.settings.jira_base_url.rstrip("/")
        if not base_url:
            raise JiraClientError("JIRA_BASE_URL is empty — cannot create HTTP client")

        if self.settings.jira_auth_mode == "cloud":
            # Cloud: Basic Auth with email + API token
            auth = httpx.BasicAuth(
                username=self.settings.jira_email,
                password=self.settings.jira_api_token,
            )
        else:
            # Server / DC — bearer Personal Access Token
            headers["Authorization"] = f"Bearer {self.settings.jira_api_token}"

        return httpx.Client(
            base_url=base_url,
            headers=headers,
            auth=auth,
            timeout=httpx.Timeout(self.settings.jira_timeout),
        )

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = self._build_client()
        return self._client

    def _parse_retry_after(self, value: str | None, default: int) -> int:
        """Parse Retry-After header — can be seconds (int) or HTTP-date string."""
        if value is None:
            return default
        try:
            return int(value)
        except ValueError:
            # Retry-After might be an HTTP-date like "Fri, 31 Dec 1999 23:59:59 GMT"
            # Fall back to the exponential backoff default
            logger.debug("Non-integer Retry-After header: %s, using default %ds", value, default)
            return default

    def _request_with_retry(
        self, method: str, url: str, **kwargs: Any
    ) -> httpx.Response:
        """Execute an HTTP request with retries on 429 and 5xx."""
        max_retries = self.settings.jira_max_retries
        for attempt in range(max_retries + 1):
            try:
                resp = self.client.request(method, url, **kwargs)
            except httpx.TransportError as exc:
                if attempt >= max_retries:
                    raise JiraClientError(f"Transport error after {max_retries} retries: {exc}") from exc
                wait = 2 ** attempt
                logger.warning("Transport error (attempt %d/%d), retrying in %ds: %s", attempt + 1, max_retries, wait, exc)
                time.sleep(wait)
                continue

            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt >= max_retries:
                    raise JiraClientError(
                        f"HTTP {resp.status_code} after {max_retries} retries: {resp.text[:300]}"
                    )
                retry_after = self._parse_retry_after(
                    resp.headers.get("Retry-After"), 2 ** attempt
                )
                logger.warning(
                    "HTTP %d (attempt %d/%d), retrying in %ds",
                    resp.status_code, attempt + 1, max_retries, retry_after,
                )
                time.sleep(retry_after)
                continue

            resp.raise_for_status()
            return resp

        raise JiraClientError("Unexpected retry loop exit")  # pragma: no cover

    # ── Auth test ─────────────────────────────────────────────────────

    def test_auth(self) -> dict[str, Any]:
        """Test authentication and return current user info.

        Tries /rest/api/3/myself first (Cloud), then falls back to
        /rest/api/2/myself for Server/DC instances.
        """
        # Try v3 first (Jira Cloud)
        try:
            resp = self._request_with_retry("GET", "/rest/api/3/myself")
            return resp.json()
        except (JiraClientError, httpx.HTTPStatusError):
            logger.info("v3 /myself failed, trying v2 fallback for Server/DC")

        # Fallback to v2 (Jira Server / Data Center)
        resp = self._request_with_retry("GET", "/rest/api/2/myself")
        return resp.json()

    # ── Search / fetch ────────────────────────────────────────────────

    def _search_issues(
        self,
        jql: str,
        start_at: int = 0,
        max_results: int = 50,
        next_token: str | None = None,
    ) -> dict[str, Any]:
        """Execute JQL search, handling both cursor (Cloud) and offset (Legacy) pagination."""
        payload = {
            "jql": jql,
            "maxResults": max_results,
            "fields": ISSUE_FIELDS,
        }

        # Strategy 1: Cursor-based [/rest/api/3/search/jql]
        # Used if we have a token OR we are on page 0 and in Cloud mode (preferring new API)
        # Note: We MUST NOT send 'startAt' to this endpoint.
        use_cursor = next_token is not None or (start_at == 0 and self.settings.jira_auth_mode == "cloud")
        
        if use_cursor:
            cursor_payload = payload.copy()
            if next_token:
                cursor_payload["nextPageToken"] = next_token
            
            try:
                resp = self._request_with_retry(
                    "POST", "/rest/api/3/search/jql", json=cursor_payload
                )
                return resp.json()
            except (JiraClientError, httpx.HTTPStatusError) as e:
                # If we were forcing cursor because of a token, we can't fall back (context lost)
                if next_token:
                    raise e
                # If we were just trying it for page 0, we can fall back to offset w/ startAt
                logger.warning("Primary Cloud search (/search/jql) failed: %s", e)

        # Strategy 2: Offset-based [/rest/api/3/search] or [/rest/api/2/search]
        # Used as fallback or for Server/DC.
        offset_payload = payload.copy()
        offset_payload["startAt"] = start_at

        # Try v3 POST (deprecated but sometimes valid)
        try:
            resp = self._request_with_retry(
                "POST", "/rest/api/3/search", json=offset_payload
            )
            return resp.json()
        except (JiraClientError, httpx.HTTPStatusError):
            pass

        # Try v3 GET (reliable fallback)
        params = {
            "jql": jql,
            "startAt": start_at,
            "maxResults": max_results,
            "fields": ",".join(ISSUE_FIELDS),
        }
        try:
            resp = self._request_with_retry("GET", "/rest/api/3/search", params=params)
            return resp.json()
        except (JiraClientError, httpx.HTTPStatusError):
            logger.info("v3 GET search failed, trying v2 for Server/DC")

        # Try v2 POST (Server/DC)
        resp = self._request_with_retry(
            "POST", "/rest/api/2/search", json=offset_payload
        )
        return resp.json()

    def fetch_all_assigned(self) -> list[dict[str, Any]]:
        """Fetch ALL issues matching configured JQL, handling both pagination styles automatically."""
        jql = self.settings.jira_jql
        logger.info("Fetching issues with JQL: %s", jql)

        all_issues: list[dict[str, Any]] = []
        
        # Pagination state
        start_at = 0
        next_token = None
        page_size = 100 # Increased from 50
        
        # SAFETY: Hard cap to prevent runaway loops (e.g. 10k+ issues)
        # Configurable limit could be added to Settings later
        MAX_ISSUES_HARD_CAP = 500 

        while True:
            # Check hard cap
            if len(all_issues) >= MAX_ISSUES_HARD_CAP:
                logger.warning("Hit hard cap of %d issues. Stopping sync.", MAX_ISSUES_HARD_CAP)
                break
                
            data = self._search_issues(
                jql, 
                start_at=start_at, 
                max_results=page_size, 
                next_token=next_token
            )
            
            issues = data.get("issues", [])
            all_issues.extend(issues)
            
            # Determine pagination capability from response
            has_token = "nextPageToken" in data
            total = data.get("total", -1) # -1 implies unknown (cursor mode)
            
            logger.info(
                "Fetched %d issues (total so far: %d)",
                len(issues), len(all_issues),
            )

            if not issues:
                break
            
            # Stop if we just fetched less than requested page size (end of list)
            if len(issues) < page_size:
                break

            # If the API gave us a token, we MUST use it for the next page
            if has_token:
                next_token = data["nextPageToken"]
                # Cursor mode often doesn't have 'total', so we rely on token presence
                if not next_token:
                    break
            else:
                # Classic offset mode
                start_at += len(issues)
                if total != -1 and start_at >= total:
                    break
        
        return all_issues

    def fetch_issue(self, key: str) -> dict[str, Any]:
        """Fetch a single issue by key."""
        # Try v3 first, fallback to v2
        try:
            resp = self._request_with_retry(
                "GET",
                f"/rest/api/3/issue/{key}",
                params={"fields": ",".join(ISSUE_FIELDS)},
            )
            return resp.json()
        except (JiraClientError, httpx.HTTPStatusError):
            resp = self._request_with_retry(
                "GET",
                f"/rest/api/2/issue/{key}",
                params={"fields": ",".join(ISSUE_FIELDS)},
            )
            return resp.json()

    def list_assignable_users(
        self,
        project_key: str | None = None,
        query: str | None = None,
        max_results: int = 1000,
    ) -> list[dict[str, Any]]:
        """List assignable users for a project (or globally if project_key is None)."""
        if not project_key and not query:
            raise JiraClientError("project_key or query is required for assignable user search")
        users: list[dict[str, Any]] = []
        start_at = 0
        page_size = 50

        params: dict[str, Any] = {
            "startAt": start_at,
            "maxResults": page_size,
        }
        if project_key:
            params["project"] = project_key
        if query:
            params["query"] = query

        # Try v3 first, fallback to v2
        while True:
            params["startAt"] = start_at
            try:
                resp = self._request_with_retry(
                    "GET", "/rest/api/3/user/assignable/search", params=params
                )
            except (JiraClientError, httpx.HTTPStatusError):
                resp = self._request_with_retry(
                    "GET", "/rest/api/2/user/assignable/search", params=params
                )

            data = resp.json() or []
            if isinstance(data, dict):
                # Some Jira instances return {"values": [...]} instead of a list
                data = data.get("values", [])
            if not data:
                break

            users.extend(data)
            if len(users) >= max_results:
                break
            if len(data) < page_size:
                break
            start_at += len(data)

        return users[:max_results]

    def fetch_with_hierarchy(self) -> list[dict[str, Any]]:
        """Fetch assigned issues + chase parent/subtask keys for complete hierarchy."""
        assigned = self.fetch_all_assigned()
        issues_by_key: dict[str, dict[str, Any]] = {}

        for issue in assigned:
            issues_by_key[issue["key"]] = issue

        # Collect keys we need to chase
        extra_keys: set[str] = set()

        for issue in assigned:
            fields = issue.get("fields", {})

            # Chase parent
            parent = fields.get("parent")
            if parent and parent.get("key") and parent["key"] not in issues_by_key:
                extra_keys.add(parent["key"])

            # Chase subtasks
            subtasks = fields.get("subtasks") or []
            for st in subtasks:
                if st.get("key") and st["key"] not in issues_by_key:
                    extra_keys.add(st["key"])

            # Chase linked issues needed for blocked detection
            links = fields.get("issuelinks") or []
            for link in links:
                for direction in ("inwardIssue", "outwardIssue"):
                    linked = link.get(direction)
                    if linked and linked.get("key") and linked["key"] not in issues_by_key:
                        extra_keys.add(linked["key"])

        # Fetch extra issues
        if extra_keys:
            logger.info("Chasing %d related issues: %s", len(extra_keys), extra_keys)
            for key in extra_keys:
                try:
                    issue = self.fetch_issue(key)
                    issues_by_key[key] = issue
                except Exception:
                    logger.warning("Could not fetch related issue %s", key)

        return list(issues_by_key.values())

    def close(self) -> None:
        if self._client:
            self._client.close()
            self._client = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
