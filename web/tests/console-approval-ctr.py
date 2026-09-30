"""Synthetic browser workflow test against disposable localhost services only.

kind='human' is test input to exercise the approval gate. It is NOT evidence of
a real human evaluation and must never enter production data or publications.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright, expect

WEB, API = "http://127.0.0.1:4439", "http://127.0.0.1:8849"
TOKEN = "console-browser-test-only"
FIXTURE = "SYNTHETIC AUTOMATED UI FIXTURE; NOT A REAL HUMAN EVALUATION"

def fill(form, values):
    for name, value in values.items():
        form.locator('[name="' + name + '"]').fill(value)

with sync_playwright() as runtime:
    browser = runtime.chromium.launch(headless=True, channel="chrome")
    context = browser.new_context(viewport={"width":1365,"height":1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    headers = {"Authorization":"Bearer " + TOKEN}
    suffix = uuid.uuid4().hex[:8]
    skill_id = "synthetic-approval-" + suffix
    now = datetime.now(timezone.utc)
    try:
        submission = {
            "id":skill_id,"version":"1.0.0","name":"Synthetic approval workflow " + suffix,
            "description":FIXTURE,"category":"research","tags":["synthetic-qa"],
            "hosts":["generic"],"publisher":"Automated test fixture","license":"MIT",
            "entry":"SKILL.md","permissions":{"network":[],"shell":False,"secrets":[]},
            "dependencies":[],
            "files":{"SKILL.md":"---\nname: " + skill_id + "\ndescription: Synthetic workflow fixture, never real human evidence.\n---\n\n# Isolated QA\n\nAsk for the research goal. Inspect the user-provided source. Summarize supported claims and identify missing evidence. This package only tests software approval and revocation workflows."},
            "release":{"notes":FIXTURE,"breaking":False,"minClientVersion":"1.0.0","maintainedAt":now.isoformat(),"maintainedBy":"Automated QA fixture"}
        }
        response = page.request.post(API + "/v1/admin/skills",headers=headers,data=submission)
        assert response.status == 201,response.text()
        page.goto(WEB + "/console/")
        page.wait_for_load_state("networkidle")
        print("Initial actions:",page.get_by_role("button").all_text_contents())
        connect=page.locator("[data-connect-form]")
        fill(connect,{"registry":API,"token":TOKEN})
        connect.get_by_role("button",name="连接后端").click()
        row=page.locator("#skills .console-record").filter(has_text=skill_id)
        row.get_by_role("button",name="查看全部文件、实测与审核").click()
        detail=page.locator("[data-skill-detail]")
        expect(detail.locator('.console-review option[value="approve"]')).to_be_disabled()
        evaluation=detail.locator(".console-evaluation")
        fill(evaluation,{"tester":"Synthetic automated QA fixture","testedAt":now.strftime("%Y-%m-%dT%H:%M"),"environment":FIXTURE,"generic.notes":FIXTURE,"publicSummary":FIXTURE})
        evaluation.locator('[name="kind"]').select_option("human")
        for case in ["purpose","boundary"]:
            fill(evaluation,{case+"."+field:FIXTURE+"; "+case+" "+field for field in ["input","expected","actual","steps","limitations","evidence"]})
            evaluation.locator('[name="'+case+'.passed"]').select_option("true")
        evaluation.locator('[name="generic.installed"]').check()
        evaluation.locator('[name="generic.read"]').check()
        evaluation.locator('[name="attest"]').check()
        evaluation.get_by_role("button",name="保存实测记录").click()
        expect(detail.locator('.console-review option[value="approve"]')).to_be_enabled()
        review=detail.locator(".console-review")
        fill(review,{"reviewer":"Synthetic automated UI fixture","notes":FIXTURE+"; approve workflow only"})
        review.locator('[name="action"]').select_option("approve")
        with page.expect_response(lambda response: response.url.endswith("/review") and response.request.method=="POST") as approved:
            review.get_by_role("button",name="提交审核决定").click()
        assert approved.value.status==200,approved.value.text()
        expect(row.locator("header")).to_contain_text("approved")
        actual=page.request.get(API+"/v1/admin/skills/"+skill_id+"/1.0.0",headers=headers).json()
        assert actual["skill"]["qualification"]=="qualified"
        digest=actual["skill"]["digest"]
        expect(detail.locator('.console-review option[value="revoke"]')).to_be_enabled()
        review=detail.locator(".console-review")
        fill(review,{"reviewer":"Synthetic automated UI fixture","notes":FIXTURE+"; revoke workflow only"})
        review.locator('[name="action"]').select_option("revoke")
        with page.expect_response(lambda response: response.url.endswith("/review") and response.request.method=="POST") as revoked:
            review.get_by_role("button",name="提交审核决定").click()
        assert revoked.value.status==200,revoked.value.text()
        expect(row.locator("header")).to_contain_text("revoked")
        final=page.request.get(API+"/v1/admin/skills/"+skill_id+"/1.0.0",headers=headers).json()
        assert final["skill"]["digest"]==digest
        assert final["files"]==actual["files"] and final["manifest"]==actual["manifest"]
        assert {review["action"] for review in final["reviews"]} >= {"approve","revoke"}
        detail.screenshot(path="/tmp/skillflux-synthetic-approval-revoke.png")
        print("PASS: synthetic evaluation saved through UI → enabled approve → real backend qualified → real UI revoke/history; published bytes unchanged")

        campaign={"name":"CTR workflow "+suffix,"sponsor":"Synthetic QA fixture","text":"Disposable CTR accounting fixture.","url":"https://example.com/qa","categories":["research"],"active":True,"budgetCents":5000,"cpcCents":25,"dailyCap":100,"startsAt":(now-timedelta(days=1)).isoformat(),"endsAt":(now+timedelta(days=1)).isoformat()}
        created=page.request.post(API+"/v1/admin/campaigns",headers=headers,data=campaign)
        assert created.status==201,created.text()
        campaign_id=created.json()["campaign"]["id"]
        metrics=page.locator("[data-metrics-filter]")
        metrics.locator('[name="campaignId"]').fill(campaign_id)
        metrics.get_by_role("button",name="查询",exact=True).click()
        ctr=page.locator("[data-metrics-grid] article").filter(has_text="付费 CTR")
        expect(ctr).to_contain_text("—")
        decisions=[]
        for index in range(2):
            decided=page.request.post(API+"/v1/ads/decision",data={"category":"research","context":"normal","requestId":"ctr-"+suffix+"-"+str(index)})
            assert decided.status==200,decided.text()
            decision=decided.json()["payload"]
            assert decision["campaignId"]==campaign_id
            displayed=page.request.post(API+"/v1/events",data={"type":"impression","eventId":"impression-"+suffix+"-"+str(index),"token":decision["token"]})
            assert displayed.ok,displayed.text()
            decisions.append(decision)
        clicked=page.request.get(decisions[0]["url"],max_redirects=0)
        assert clicked.status==302
        metrics.get_by_role("button",name="查询",exact=True).click()
        expect(ctr).to_contain_text("50.00%")
        expect(page.locator("[data-metrics-rows]")).to_contain_text("50.00%")
        with page.expect_download() as exported:
            metrics.get_by_role("button",name="导出当前 CSV").click()
        with open(exported.value.path()) as artifact:
            csv=artifact.read()
        assert "clickedImpressions,ctr" in csv and '"0.5"' in csv
        page.locator("#metrics").screenshot(path="/tmp/skillflux-ctr-50-percent.png")
        print("PASS: actual 2 paid impressions / 1 first click = 50.00% in total card, table and server CSV; no-impression state is —")
        page.get_by_role("button",name="断开并清除").click()
        assert not errors,errors
    except Exception:
        page.screenshot(path="/tmp/skillflux-approval-ctr-failure.png",full_page=True)
        raise
    finally:
        browser.close()
