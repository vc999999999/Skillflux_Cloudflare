from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
BASE_URL = "http://127.0.0.1:4321"


def assert_no_horizontal_overflow(page, label):
    overflow = page.evaluate(
        """() => ({
            width: window.innerWidth,
            html: document.documentElement.scrollWidth,
            body: document.body.scrollWidth
        })"""
    )
    limit = overflow["width"] + 2
    assert overflow["html"] <= limit and overflow["body"] <= limit, f"{label} overflow: {overflow}"


def read_utf8(path):
    with urlopen(f"{BASE_URL}{path}", timeout=10) as response:
        return response.read().decode("utf-8")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    desktop = browser.new_page(viewport={"width": 1440, "height": 1000})
    desktop.goto(BASE_URL)
    desktop.wait_for_load_state("networkidle")
    expect(desktop.get_by_role("heading", name="技流")).to_be_visible()
    expect(desktop.get_by_role("link", name="浏览目录")).to_be_visible()
    expect(desktop.locator(".hero-stats")).to_be_visible()
    assert_no_horizontal_overflow(desktop, "home desktop")
    desktop.screenshot(path=str(ARTIFACTS / "skillflux-home-desktop.png"), full_page=True)

    desktop.goto(f"{BASE_URL}/en/")
    desktop.wait_for_load_state("networkidle")
    expect(desktop.get_by_role("link", name="Browse directory")).to_be_visible()
    expect(desktop.locator(".hero-stats .stat-label").filter(has_text="Resources")).to_be_visible()
    assert_no_horizontal_overflow(desktop, "home english desktop")
    desktop.screenshot(path=str(ARTIFACTS / "skillflux-home-en-desktop.png"), full_page=True)

    desktop.goto(f"{BASE_URL}/directory/")
    desktop.wait_for_load_state("networkidle")
    rows = desktop.locator("[data-site-row]")
    assert rows.count() >= 50, f"expected at least 50 rows, got {rows.count()}"
    desktop.locator("[data-directory-search]").fill("ModelScope")
    visible_rows = desktop.locator("[data-site-row]:visible").count()
    assert visible_rows >= 1, "directory search should keep matching rows visible"
    assert_no_horizontal_overflow(desktop, "directory desktop")
    desktop.screenshot(path=str(ARTIFACTS / "skillflux-directory-desktop.png"), full_page=True)

    desktop.goto(f"{BASE_URL}/en/directory/")
    desktop.wait_for_load_state("networkidle")
    expect(desktop.get_by_role("heading", name="Directory")).to_be_visible()
    expect(desktop.get_by_placeholder("Name, labels, summary")).to_be_visible()
    assert_no_horizontal_overflow(desktop, "directory english desktop")

    desktop.goto(f"{BASE_URL}/site/modelscope-cn-skills/")
    desktop.wait_for_load_state("networkidle")
    expect(desktop.get_by_role("heading", name="魔搭 ModelScope Skills")).to_be_visible()
    expect(desktop.get_by_role("link", name="访问原站")).to_be_visible()
    assert_no_horizontal_overflow(desktop, "detail desktop")

    desktop.goto(f"{BASE_URL}/en/site/modelscope-cn-skills/")
    desktop.wait_for_load_state("networkidle")
    expect(desktop.get_by_role("link", name="Visit source")).to_be_visible()
    expect(desktop.get_by_role("heading", name="Overview")).to_be_visible()
    assert_no_horizontal_overflow(desktop, "detail english desktop")

    mobile = browser.new_page(viewport={"width": 390, "height": 900}, is_mobile=True)
    mobile.goto(BASE_URL)
    mobile.wait_for_load_state("networkidle")
    expect(mobile.get_by_role("heading", name="技流")).to_be_visible()
    assert_no_horizontal_overflow(mobile, "home mobile")
    mobile.screenshot(path=str(ARTIFACTS / "skillflux-home-mobile.png"), full_page=True)

    mobile.goto(f"{BASE_URL}/directory/")
    mobile.wait_for_load_state("networkidle")
    expect(mobile.get_by_role("heading", name="完整目录")).to_be_visible()
    assert_no_horizontal_overflow(mobile, "directory mobile")

    llms_text = read_utf8("/llms.txt")
    assert "SkillFlux 技流" in llms_text

    payload_text = read_utf8("/index.json")
    assert '"schemaVersion": "2026-06-24"' in payload_text
    assert '"resources": 63' in payload_text

    browser.close()
