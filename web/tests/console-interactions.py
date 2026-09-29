"""Browser acceptance against an isolated registry. No real human review is generated.

Use with_server.py with Registry on 8849 and Astro on 4439; the only credential
is the disposable test value below. This script never touches production data.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright, expect

WEB = "http://127.0.0.1:4439"
API = "http://127.0.0.1:8849"
TOKEN = "console-browser-test-only"

def fill(form, values):
    for name, value in values.items():
        form.locator('[name="' + name + '"]').fill(value)


with sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True, channel="chrome")
    context = browser.new_context(viewport={"width": 1365, "height": 900})
    page = context.new_page()
    failures = []
    page.on("pageerror", lambda error: failures.append(str(error)))
    suffix = uuid.uuid4().hex[:8]
    headers = {"Authorization": "Bearer " + TOKEN}
    now = datetime.now(timezone.utc)
    try:
        page.goto(WEB + "/console/")
        page.wait_for_load_state("networkidle")
        print("Initial visible actions:", page.get_by_role("button").all_text_contents())
        connection = page.locator("[data-connect-form]")
        fill(connection, {"registry": API, "token": "intentionally-invalid"})
        connection.get_by_role("button", name="连接后端").click()
        expect(page.locator("[data-connect-message]")).to_contain_text("管理员凭据无效")
        expect(connection.locator('[name="token"]')).to_have_value("")
        expect(page.locator("[data-console-app]")).to_be_hidden()

        page.route("**/v1/admin/campaigns?*", lambda route: route.fulfill(status=503, content_type="application/json", body='{"error":{"code":"fixture_unavailable","message":"Isolated failure fixture"}}'))
        fill(connection, {"token": TOKEN})
        connection.get_by_role("button", name="连接后端").click()
        expect(page.locator("[data-console-app]")).to_be_visible()
        expect(page.locator("#campaigns [data-list]")).to_contain_text("fixture_unavailable")
        expect(page.locator("[data-metrics-grid]")).to_contain_text("Skills")
        expect(page.locator("#skills [data-page-info]")).not_to_have_text("")
        expect(connection.locator('[name="token"]')).to_have_value("")
        page.unroute("**/v1/admin/campaigns?*")
        page.locator("#campaigns").get_by_role("button", name="刷新此模块").click()
        expect(page.locator("#campaigns [data-page-info]")).not_to_have_text("")
        print("PASS: authentication failure, memory-only password clearing, independent module failure/retry")

        page.locator("[data-campaign-editor] > summary").click()
        campaign_form = page.locator("[data-campaign-form]")
        campaign_name = "Browser QA " + suffix
        fill(campaign_form, {
            "name": campaign_name, "sponsor": "Synthetic QA fixture",
            "text": "Isolated browser test creative. This is not a real paid campaign.",
            "url": "https://example.com/qa", "categories": "research",
            "budgetCents": "5000", "cpcCents": "25", "dailyCap": "100",
            "startsAt": (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M"),
            "endsAt": (now + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M"),
        })
        campaign_form.locator('[name="active"]').select_option("true")
        with page.expect_response(lambda response: response.url.endswith("/v1/admin/campaigns") and response.request.method == "POST") as saved:
            campaign_form.get_by_role("button", name="保存活动").click()
        assert saved.value.status == 201, saved.value.text()
        campaign_id = saved.value.json()["campaign"]["id"]
        row = page.locator("#campaigns .console-record").filter(has_text=campaign_name)
        expect(row).to_be_visible()
        before = page.request.get(API + "/v1/admin/metrics", headers=headers).json()
        row.get_by_role("button", name="真实预览（不计费）").click()
        expect(row.locator("[data-preview]")).to_contain_text("预览不会分配广告")
        after = page.request.get(API + "/v1/admin/metrics", headers=headers).json()
        for field in ["decisions", "impressions", "clicks", "spentCents"]:
            assert before[field] == after[field], "Preview changed " + field
        row.get_by_role("button", name="编辑", exact=True).click()
        campaign_form.locator('[name="text"]').fill("Updated isolated QA copy.")
        campaign_form.get_by_role("button", name="保存活动").click()
        expect(row).to_contain_text("Updated isolated QA copy.")
        row.get_by_role("button", name="暂停", exact=True).click()
        expect(row.get_by_role("button", name="启用", exact=True)).to_be_visible()
        row.get_by_role("button", name="启用", exact=True).click()
        expect(row.get_by_role("button", name="暂停", exact=True)).to_be_visible()
        print("PASS: campaign create/edit, unbilled real preview, pause/resume")
        # Seed a larger disposable dataset through the actual API, then test pagination using UI controls.
        for index in range(11):
            payload = {"name": "Browser pager " + suffix + " " + str(index), "sponsor": "QA fixture", "text": "Disposable pagination fixture.", "url": "https://example.com/qa", "categories": ["research"], "active": False, "budgetCents": 0, "cpcCents": 0, "dailyCap": 0, "startsAt": (now - timedelta(days=1)).isoformat(), "endsAt": (now + timedelta(days=1)).isoformat()}
            response = page.request.post(API + "/v1/admin/campaigns", headers=headers, data=payload)
            assert response.status == 201, response.text()
        campaign_module = page.locator("#campaigns")
        campaign_module.locator('[name="q"]').fill("Browser pager " + suffix)
        campaign_module.locator('[name="status"]').select_option("paused")
        campaign_module.get_by_role("button", name="搜索 / 筛选").click()
        expect(campaign_module.locator("[data-page-info]")).to_have_text("1–10 / 11")
        campaign_module.get_by_role("button", name="下一页").click()
        expect(campaign_module.locator("[data-page-info]")).to_have_text("11–11 / 11")
        campaign_module.get_by_role("button", name="上一页").click()
        expect(campaign_module.locator("[data-page-info]")).to_have_text("1–10 / 11")
        campaign_module.locator('[name="q"]').fill("no-matching-fixture-" + suffix)
        campaign_module.get_by_role("button", name="搜索 / 筛选").click()
        expect(campaign_module.locator("[data-list]")).to_contain_text("当前筛选没有记录")
        campaign_module.locator('[name="q"]').fill(campaign_name)
        campaign_module.locator('[name="status"]').select_option("")
        campaign_module.get_by_role("button", name="搜索 / 筛选").click()
        expect(row).to_be_visible()
        print("PASS: actual 11-record search/status filter, next/previous pagination and empty state")

        public = context.new_page()
        public.on("pageerror", lambda error: failures.append(str(error)))
        public.goto(WEB + "/advertise/")
        public.wait_for_load_state("networkidle")
        print("Inquiry visible fields:", public.locator("form label").all_text_contents())
        inquiry = public.locator("[data-request-form]")
        fill(inquiry, {"product": "Browser fixture", "company": "QA only " + suffix, "website": "https://example.com/qa", "name": "Automated QA fixture", "contact": "qa@example.invalid", "message": "This is an isolated browser acceptance fixture; no contact is requested."})
        inquiry.locator('[name="consent"]').check()
        public.route("**/v1/inquiries", lambda route: route.fulfill(status=503, content_type="application/json", body='{"error":{"code":"test_retry","message":"temporary fixture failure"}}'))
        inquiry.get_by_role("button", name="提交咨询").click()
        expect(public.locator("[data-submit-status]")).to_contain_text("内容已保留")
        expect(inquiry.locator('[name="contact"]')).to_have_value("qa@example.invalid")
        public.unroute("**/v1/inquiries")
        inquiry.get_by_role("button", name="提交咨询").click()
        expect(public.locator("[data-submit-status]")).to_contain_text("提交已保存")
        expect(inquiry.locator('[name="name"]')).to_have_value("")
        public.evaluate("window.scrollTo(0, 0)")
        public.screenshot(path="/tmp/skillflux-inquiry-success.png", full_page=True)
        public.goto(WEB + "/en/report/?campaignId=" + campaign_id)
        public.wait_for_load_state("networkidle")
        report = public.locator("[data-request-form]")
        expect(report.locator('[name="campaignId"]')).to_have_value(campaign_id)
        report.locator('[name="reason"]').fill("Isolated QA report: validate the full review and pause workflow.")
        report.get_by_role("button", name="Submit report").click()
        expect(public.locator("[data-submit-status]")).to_contain_text("Your submission was saved")
        print("PASS: inquiry failure retains content and retries to actual saved ID; English report saves")

        page.locator("#inquiries").get_by_role("button", name="刷新此模块").click()
        inquiry_row = page.locator("#inquiries .console-record").filter(has_text="QA only " + suffix)
        expect(inquiry_row).to_be_visible()
        operation = inquiry_row.locator("form")
        fill(operation, {"operator": "Browser QA fixture", "notes": "Synthetic lead completed during browser QA."})
        operation.locator('[name="status"]').select_option("following-up")
        operation.get_by_role("button", name="保存处理").click()
        expect(inquiry_row).to_contain_text("following-up")
        fill(operation, {"operator": "Browser QA fixture", "notes": "Synthetic lead completed during browser QA."})
        operation.locator('[name="status"]').select_option("completed")
        operation.get_by_role("button", name="保存处理").click()
        expect(inquiry_row).to_contain_text("completed")
        page.locator("#reports").get_by_role("button", name="刷新此模块").click()
        report_row = page.locator("#reports .console-record").filter(has_text=campaign_id).first
        expect(report_row).to_be_visible()
        report_row.get_by_role("button", name="读取举报详情").click()
        expect(report_row).to_contain_text("举报详情与关联活动")
        operation = report_row.locator("form")
        fill(operation, {"operator": "Browser QA fixture", "notes": "Pause this disposable fixture campaign."})
        operation.locator('[name="action"]').select_option("pause")
        operation.get_by_role("button", name="保存处理").click()
        expect(report_row).to_contain_text("paused")
        expect(row.get_by_role("button", name="启用", exact=True)).to_be_visible()
        metrics = page.locator("[data-metrics-filter]")
        metrics.locator('[name="campaignId"]').fill(campaign_id)
        metrics.get_by_role("button", name="查询", exact=True).click()
        expect(page.locator("[data-metrics-grid]")).to_contain_text("Skills")
        with page.expect_download() as export:
            metrics.get_by_role("button", name="导出当前 CSV").click()
        assert export.value.suggested_filename == "skillflux-metrics.csv"
        export.value.save_as("/tmp/skillflux-browser-metrics.csv")
        audit = page.locator("#audit")
        audit.locator('[name="action"]').fill("campaign.created")
        audit.get_by_role("button", name="搜索 / 筛选").click()
        expect(audit.locator("[data-list]")).to_contain_text("campaign.created")
        print("PASS: lead handling, report detail/pause, actual filtered CSV download, audit filter")

        skill_id = "browser-qa-" + suffix
        submission = {
            "id": skill_id, "version": "1.0.0", "name": "Browser QA fixture " + suffix,
            "description": "Synthetic isolated browser test for reviewing a complete skill package.",
            "category": "research", "tags": ["qa"], "hosts": ["generic"], "publisher": "Automated QA fixture",
            "license": "MIT", "entry": "SKILL.md", "permissions": {"network": [], "shell": False, "secrets": []},
            "dependencies": [], "files": {"SKILL.md": "---\nname: " + skill_id + "\ndescription: Synthetic QA fixture for package review.\n---\n\n# QA fixture\n\nAsk for the intended research question. Read the user-provided source text. Summarize only its supported claims and explain any missing evidence. This text is solely an isolated browser test fixture, not a production skill.", "references/notes.md": "# Evidence\nThis resource belongs only to the synthetic browser test."},
            "release": {"notes": "Isolated QA fixture release.", "breaking": False, "minClientVersion": "1.0.0", "maintainedAt": now.isoformat(), "maintainedBy": "Automated QA fixture"},
        }
        submission_form = page.locator("[data-submission-form]")
        submission_form.locator("details > summary").click()
        submission_form.locator('[name="import"]').fill(json.dumps(submission))
        submission_form.get_by_role("button", name="读取 JSON 到表单").click()
        expect(submission_form.locator('[name="id"]')).to_have_value(skill_id)
        submission_form.get_by_role("button", name="提交到审核队列").click()
        expect(submission_form.locator("[data-form-message]")).to_contain_text("后端已保存")
        skill_row = page.locator("#skills .console-record").filter(has_text=skill_id)
        skill_row.get_by_role("button", name="查看全部文件、实测与审核").click()
        detail = page.locator("[data-skill-detail]")
        expect(detail).to_contain_text("references/notes.md")
        expect(detail).to_contain_text("与上一版本的文件差异")
        expect(detail.locator('.console-review option[value="approve"]')).to_be_disabled()
        evaluation = detail.locator(".console-evaluation")
        fill(evaluation, {"tester": "Automated browser QA fixture", "testedAt": now.strftime("%Y-%m-%dT%H:%M"), "environment": "Automated browser simulation; no human review occurred.", "generic.notes": "Synthetic install/read checks for UI acceptance only.", "publicSummary": "Synthetic QA summary, not an actual review."})
        evaluation.locator('[name="kind"]').select_option("simulation")
        for case in ["purpose", "boundary"]:
            fill(evaluation, {case + "." + field: "Synthetic " + case + " " + field + " fixture, not an actual human observation." for field in ["input", "expected", "actual", "steps", "limitations", "evidence"]})
            evaluation.locator('[name="' + case + '.passed"]').select_option("true")
        evaluation.locator('[name="generic.installed"]').check()
        evaluation.locator('[name="generic.read"]').check()
        evaluation.locator('[name="attest"]').check()
        evaluation.get_by_role("button", name="保存实测记录").click()
        expect(detail).to_contain_text("Synthetic QA summary")
        expect(detail.locator('.console-review option[value="approve"]')).to_be_disabled()
        detail.screenshot(path="/tmp/skillflux-review-simulation.png")
        print("PASS: JSON import/submission, complete files/diff, structured simulation, approval remains disabled")

        # A mocked legacy response exercises UI availability without inventing human evidence.
        legacy_response = page.request.get(API + "/v1/admin/skills/" + skill_id + "/1.0.0", headers=headers).json()
        legacy_response["skill"]["status"] = "approved"
        legacy_response["skill"]["qualification"] = "needs-testing"
        legacy_path = "**/v1/admin/skills/" + skill_id + "/1.0.0"
        page.route(legacy_path, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(legacy_response)))
        skill_row.get_by_role("button", name="查看全部文件、实测与审核").click()
        expect(detail).to_contain_text("需再单独批准")
        expect(detail.locator(".console-evaluation")).to_be_visible()
        expect(detail.locator('.console-review option[value="approve"]')).to_contain_text("单独批准")
        expect(detail.locator('.console-review option[value="approve"]')).to_be_disabled()
        page.unroute(legacy_path)
        skill_row.get_by_role("button", name="查看全部文件、实测与审核").click()
        review = detail.locator(".console-review")
        fill(review, {"reviewer": "Automated browser QA fixture", "notes": "Reject isolated simulation fixture; it has no human review."})
        review.locator('[name="action"]').select_option("reject")
        review.get_by_role("button", name="提交审核决定").click()
        expect(skill_row).to_contain_text("rejected")
        expect(detail).to_contain_text("Reject isolated simulation fixture")
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path="/tmp/skillflux-console-complete.png", full_page=True)
        page.get_by_role("button", name="断开并清除").click()
        expect(page.locator("[data-console-app]")).to_be_hidden()
        expect(page.locator("[data-skill-detail]")).to_be_empty()
        expect(connection.locator('[name="token"]')).to_have_value("")
        storage = page.evaluate("({local: {...localStorage}, session: {...sessionStorage}})")
        assert TOKEN not in json.dumps(storage)
        assert not failures, failures
        print("PASS: legacy re-test/explicit approval controls, real rejection/history, disconnect data clearing")
        print("All covered browser workflows passed. Human approval/revocation are not exercised because no real human testing was performed.")
    except Exception:
        page.screenshot(path="/tmp/skillflux-console-failure.png", full_page=True)
        raise
    finally:
        browser.close()
