"""闖關模式端到端測試：老師＋N 位學生跑完整一場範例題庫，核對分數、排行、成績匯出。

準備：專案根目錄 python3 -m http.server 4177 --bind 127.0.0.1；混合模式另需 realtime-worker 的 npx wrangler dev --port 8790
執行：python3 tools/load/game_e2e.py --students 8 [--legacy] [--shots DIR]
"""
import argparse, asyncio, json, random
from playwright.async_api import async_playwright

BASE = "http://localhost:4177/"


async def main(a):
    rnd = random.Random(7)
    report = {"mode": "legacy" if a.legacy else "hybrid+swarm", "students": a.students}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"])
        errors = []
        tctx = await b.new_context(viewport={"width": 1440, "height": 900}, service_workers="block", accept_downloads=True)
        t = await tctx.new_page()
        t.on("pageerror", lambda e: errors.append("teacher: " + str(e)[:200]))
        t.on("dialog", lambda d: asyncio.ensure_future(d.accept() if "刪除" not in d.message else d.dismiss()))
        q = "" if a.legacy else "?transport=hybrid&swarm=1&swarmDirect=3"
        await t.goto(BASE + q, wait_until="load")
        await t.wait_for_timeout(2500)
        await t.evaluate("closeWelcomeGuide()")
        await t.click("#nav-irs")
        await t.click("#irs-start-btn")
        await t.wait_for_function("irsState.roomId && irsState.roomId.length > 4", timeout=30000)
        url = await t.evaluate("buildIRSJoinUrl(irsState.roomId)")

        await t.click("#irs-game-btn")
        await t.wait_for_selector(".gm-card", timeout=10000)
        if a.shots: await t.screenshot(path=f"{a.shots}/g-library.png")
        await t.click(".gm-card:has-text('暖身題') [data-act=start]")
        await t.wait_for_selector("[data-qr] img, [data-qr] canvas", timeout=10000)

        studs = []
        for i in range(a.students):
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
            s = await ctx.new_page()
            s.on("pageerror", lambda e, i=i: errors.append(f"s{i}: " + str(e)[:200]))
            await s.goto(url, wait_until="load")
            await s.wait_for_selector("#irs-join-name", state="visible", timeout=60000)
            await s.fill("#irs-join-name", f"學生{i+1:02d}")
            await s.click("text=男生")
            await s.evaluate("joinIRS()")
            studs.append(s)
            await s.wait_for_timeout(700)
        await t.wait_for_function(f"document.querySelector('[data-count]')?.textContent === '{a.students}'", timeout=60000)
        await asyncio.sleep(2)
        if a.shots:
            await t.screenshot(path=f"{a.shots}/g-lobby.png")
            await studs[0].screenshot(path=f"{a.shots}/g-s-lobby.png")

        quiz = await t.evaluate("IrsGame._test.T.quiz")
        expected = {f"學生{i+1:02d}": 0 for i in range(a.students)}
        streak = {k: 0 for k in expected}
        await t.click("[data-act=next]")   # 開始遊戲
        for qi, qd in enumerate(quiz["questions"]):
            await t.wait_for_function("IrsGame._test.T.phase === 'answer'", timeout=20000)
            await asyncio.sleep(0.4)
            if a.shots and qi == 0:
                await t.screenshot(path=f"{a.shots}/g-answer.png")
                await studs[0].screenshot(path=f"{a.shots}/g-s-answer.png")
            # 每位學生隨機選，最後一位故意不作答（測未作答）
            for i, s in enumerate(studs[:-1] if a.students > 1 else studs):
                choice = rnd.randrange(len(qd["options"]))
                await s.wait_for_selector(f"[data-choice='{choice}']", timeout=15000)
                await s.click(f"[data-choice='{choice}']")
            if a.students > 1:
                await t.click("[data-act=lock]") if await t.locator("[data-act=lock]").count() else None
            await t.wait_for_function("IrsGame._test.T.phase === 'reveal'", timeout=30000)
            await asyncio.sleep(2.0)
            # 以老師端記錄的秒數驗算分數
            answers = await t.evaluate("Object.fromEntries([...IrsGame._test.T.answers.entries()].map(([k,v])=>[irsState.studentsInfo[k].name, v]))")
            for name in expected:
                ans = answers.get(name)
                if ans and ans["correct"]:
                    streak[name] += 1
                    pts = await t.evaluate("([c,e,l,d,s])=>IrsGame._test.scoreAnswer({correct:c,elapsedMs:e,limitMs:l,double:d,streak:s})", [True, ans["elapsed"], qd["time"] * 1000, bool(qd.get("double")), streak[name]])
                    expected[name] += pts
                else:
                    streak[name] = 0
            if a.shots and qi == 0:
                await t.screenshot(path=f"{a.shots}/g-reveal.png")
                await studs[0].screenshot(path=f"{a.shots}/g-s-result.png")
            await t.click("[data-act=next]")   # → 排行榜
            if qi == 1 and a.shots:
                await asyncio.sleep(3)
                await t.screenshot(path=f"{a.shots}/g-board.png")
            await asyncio.sleep(0.6)
            await t.click("[data-act=next]")   # → 下一題或頒獎
        await t.wait_for_function("IrsGame._test.T.phase === 'podium'", timeout=20000)
        await asyncio.sleep(4.5)
        if a.shots:
            await t.screenshot(path=f"{a.shots}/g-podium.png")
            await studs[0].screenshot(path=f"{a.shots}/g-s-end.png")
        report["podiumAvatars"] = await t.evaluate("document.querySelectorAll('.gm-step svg.gm-av').length")
        actual = await t.evaluate("Object.fromEntries([...IrsGame._test.T.players.values()].map(p=>[p.name,p.score]))")
        report["scoresMatch"] = actual == expected
        report["scores"] = actual
        if actual != expected:
            report["expected"] = expected
        ends = [await s.evaluate("document.querySelector('.gm-student .gm-s-big')?.textContent || ''") for s in studs]
        report["studentEndScreens"] = sum(1 for e in ends if e.startswith("第"))
        async with t.expect_download() as dl:
            await t.click("[data-act=csv]")
        path = await (await dl.value).path()
        report["csvRows"] = len(open(path, encoding="utf-8-sig").read().strip().splitlines()) - 1
        acks = [await s.evaluate("irsState.transport?.pendingAcks?.size || 0") for s in studs]
        report["unacked"] = sum(1 for x in acks if x)
        report["errors"] = errors[:10]
        await b.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--students", type=int, default=8)
    ap.add_argument("--legacy", action="store_true")
    ap.add_argument("--shots", default="")
    asyncio.run(main(ap.parse_args()))
