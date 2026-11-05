from __future__ import annotations

import os
import json
from dataclasses import dataclass
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_PANEL_HTML = BASE_DIR / "assets" / "index.tender-card-fields-v1-label-wrap.html"


@dataclass(frozen=True)
class Settings:
    """Closed paths are process configuration only and never serialized."""

    protected_current: Path = Path(
        os.getenv("TENDER_PANEL_WEBMASTER_PROTECTED_CURRENT")
        or os.getenv("TENDER_PANEL_PROTECTED_CURRENT", BASE_DIR / "runtime" / "current.json")
    )
    tenderman_projection_root: Path = Path(
        os.getenv("TENDER_PANEL_WEBMASTER_TENDERMAN_PROJECTION_ROOT")
        or os.getenv("TENDER_PANEL_TENDERMAN_PROJECTION_ROOT", BASE_DIR / "runtime" / "tenderman")
    )
    html_path: Path = Path(
        os.getenv("TENDER_PANEL_WEBMASTER_HTML")
        or os.getenv("TENDER_PANEL_HTML", DEFAULT_PANEL_HTML)
    )
    search_service_url: str = os.getenv("TENDER_SEARCH_SERVICE_URL", "http://127.0.0.1:8765")
    internal_search_token: str = os.getenv("TENDER_SEARCH_INTERNAL_TOKEN", "")
    authenticated_header: str = os.getenv("TENDER_PANEL_AUTH_HEADER", "X-Authenticated-User")
    public_prefix: str = os.getenv("TENDER_PANEL_PUBLIC_PREFIX", "/tender/panel").rstrip("/")
    archive_db_path: Path = Path(os.getenv(
        "TENDER_PANEL_ARCHIVE_DB",
        Path.home() / ".local" / "state" / "tender-panel-protected" / "archive-actions.sqlite",
    ))
    search_settings_db_path: Path = Path(os.getenv(
        "TENDER_PANEL_SEARCH_SETTINGS_DB",
        Path.home() / ".local" / "state" / "tender-panel-protected" / "search-settings-v1.sqlite",
    ))
    offers_refresh_db: Path = Path(os.getenv(
        "TENDER_PANEL_OFFERS_REFRESH_DB",
        Path.home() / ".local" / "state" / "tender-panel-v2" / "offers-refresh.sqlite",
    ))
    # Deployment-only argv: no shell, caller-provided path/query or import gate.
    offers_search_command: tuple[str, ...] = tuple(json.loads(os.getenv(
        "TENDER_PANEL_OFFERS_SEARCH_COMMAND", "[]",
    )))
    offers_source_db: Path = Path(os.getenv('TENDER_PANEL_OFFERS_SOURCE_DB','/data/price-search/data/data.db'))
    sourcing_db: Path | None = Path(os.environ['TENDER_PANEL_SOURCING_DB']) if os.getenv('TENDER_PANEL_SOURCING_DB') else None
    sourcing_search_url: str = os.getenv('TENDER_PANEL_SOURCING_SEARCH_URL', '')
    sourcing_import_url: str = os.getenv('TENDER_PANEL_SOURCING_IMPORT_URL', '')
    core_db_path: Path = Path(os.getenv(
        "TENDER_PANEL_CORE_DB",
        "./data/source.sqlite",
    ))
    core_card_overlay_path: Path = Path(os.getenv(
        "TENDER_PANEL_CORE_CARD_OVERLAY",
        BASE_DIR / "overlays" / "visible-core-cards.json",
    ))
    document_checklist_source: Path = Path(os.getenv(
        "TENDER_PANEL_DOCUMENT_CHECKLIST_SOURCE",
        "./data/checklist-data.json",
    ))
    document_checklist_db: Path = Path(os.getenv(
        "TENDER_PANEL_DOCUMENT_CHECKLIST_DB",
        Path.home() / ".local" / "state" / "tender-panel-v2" / "document-checklist.sqlite",
    ))
    paperless_api_base: str = os.getenv("TENDER_PANEL_PAPERLESS_API_BASE", "https://example.invalid/documents/api/")
    paperless_public_base: str = os.getenv("TENDER_PANEL_PAPERLESS_PUBLIC_BASE", "https://example.invalid/documents")
    paperless_token_file: Path = Path(os.getenv(
        "TENDER_PANEL_PAPERLESS_TOKEN_FILE",
        "./secrets/reader-token",
    ))
    allowed_origins: tuple[str, ...] = tuple(
        item.strip().rstrip("/")
        for item in os.getenv(
            "TENDER_PANEL_ALLOWED_ORIGINS",
            "https://example.invalid,https://example.invalid",
        ).split(",")
        if item.strip()
    )


settings = Settings()
