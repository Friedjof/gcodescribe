import base64
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from plotter.desktop.startup import desktop_start_url, loading_html


def test_desktop_navigation_changes_with_frontend_even_if_stat_data_matches(tmp_path):
    index = tmp_path / "index.html"
    index.write_text('<script src="old11111.js"></script>')
    os.utime(index, (0, 0))
    first = desktop_start_url("http://127.0.0.1:8123", tmp_path)
    index.write_text('<script src="new22222.js"></script>')
    os.utime(index, (0, 0))
    second = desktop_start_url("http://127.0.0.1:8123", tmp_path)
    assert first != second
    assert desktop_start_url("http://127.0.0.1:8123/", tmp_path) == second
    parsed = urlsplit(second)
    assert (parsed.scheme, parsed.netloc, parsed.path) == ("http", "127.0.0.1:8123", "/")
    assert re.fullmatch(r"[a-f0-9]{16}", parse_qs(parsed.query)["desktop_build"][0])


def test_startup_uses_the_packaged_brand_asset(tmp_path):
    icon = (Path(__file__).parents[1] / "frontend/public/icon.svg").read_bytes()
    (tmp_path / "icon.svg").write_bytes(icon)
    page = loading_html("en", tmp_path)
    encoded = re.search(r'src="data:image/svg\+xml;base64,([^"]+)"', page)[1]
    assert base64.b64decode(encoded) == icon
    assert "__ICON__" not in page and "__STARTING__" not in page


@pytest.mark.parametrize("locale,html_lang", [
    ("en_US.UTF-8", "en"), ("de_DE.UTF-8", "de"), ("bar", "bar"),
    ("fr_FR.UTF-8", "fr"), ("es-ES", "es"), ("C", "en"),
])
def test_loading_page_uses_supported_native_language(locale, html_lang, tmp_path):
    page = loading_html(locale, tmp_path)
    assert f'<html lang="{html_lang}">' in page
    assert '<p role="status">' in page


def test_missing_development_assets_do_not_prevent_startup(tmp_path):
    assert desktop_start_url("http://127.0.0.1:8123", tmp_path).endswith("desktop_build=unbuilt")
    assert "GCodeScribe" in loading_html("en", tmp_path)
