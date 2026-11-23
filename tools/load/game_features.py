"""闖關模式功能測試：編輯器建題、CSV 匯入、團隊模式、暫停／繼續、中途加入、隱藏排行榜。
準備同 game_e2e.py（混合模式需要本機 Worker）。執行：python3 tools/load/game_features.py
"""
import asyncio, json, os, tempfile
from playwright.async_api import async_playwright

BASE = "http://localhost:4177/?transport=hybrid"
CSV = "題目,選項A,選項B,選項C,選項D,正確答案,秒數\n\"2+2=?\",3,4,5,,B,10\n\"哪些是水果？（可複選）\",蘋果,石頭,香蕉,,AC,10\n\"格式錯誤題\",只有一個選項,,,,A,10\n"


async def join(b, url, name, errors):
    ctx = await b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    s = await ctx.new_page()
    s.on("pageerror", lambda e: errors.append(f"{name}: " + str(e)[:200]))
    await s.goto(url, wait_until="load")
    await s.wait_for_selector("#irs-join-name", state="visible", timeout=60000)
    await s.fill("#irs-join-name", name)
    await s.click("text=男生")
    await s.evaluate("joinIRS()")
    await s.wait_for_timeout(1500)
    return s


async def main():
    r = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        errors = []
        t = await (await b.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")).new_page()
        t.on("pageerror", lambda e: errors.append("teacher: " + str(e)[:200]))
        t.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await t.goto(BASE, wait_until="load"); await t.wait_for_timeout(2500)
        await t.evaluate("closeWelcomeGuide()"); await t.click("#nav-irs"); await t.click("#irs-start-btn")
        await t.wait_for_function("irsState.roomId && irsState.roomId.length > 4", timeout=30000)
        url = await t.evaluate("buildIRSJoinUrl(irsState.roomId)")

        # 先讓 4 位學生加入，再到抽籤機分 2 組，供團隊模式使用
        studs = [await join(b, url, n, errors) for n in ["王小明", "李小華", "陳大同", "林美美"]]
        await t.wait_for_function("Object.keys(irsState.studentsInfo).length === 4", timeout=30000)
        await t.evaluate("""scoreState.teams=[{id:1,name:'第 1 組',score:0,members:[{name:'王小明(男)',score:0},{name:'李小華(男)',score:0}]},{id:2,name:'第 2 組',score:0,members:[{name:'陳大同(男)',score:0},{name:'林美美(男)',score:0}]}]; renderScoreboard();""")

        await t.click("#irs-game-btn"); await t.wait_for_selector(".gm-card")
        # 1) 編輯器建立題庫
        await t.click("[data-act=new]")
        await t.fill("[data-f=title]", "測試題庫")
        box = t.locator("[data-q='0']")
        await box.locator("[data-f=text]").fill("台灣的首都在哪裡？")
        await box.locator("[data-f=opt][data-k='0']").fill("台中")
        await box.locator("[data-f=opt][data-k='1']").fill("台北")
        await box.locator("[data-f=correct][data-k='0']").uncheck()
        await box.locator("[data-f=correct][data-k='1']").check()
        await box.locator("[data-f=time]").select_option("10")
        await t.click("[data-act=q-add]")
        b1 = t.locator("[data-q='1']")
        await b1.locator("[data-f=text]").fill("O 或 X：太陽從西邊升起")
        await b1.locator("[data-f=opt][data-k='0']").fill("O")
        await b1.locator("[data-f=opt][data-k='1']").fill("X")
        await b1.locator("[data-f=correct][data-k='0']").uncheck()
        await b1.locator("[data-f=correct][data-k='1']").check()
        await b1.locator("[data-f=double]").check()
        await t.click("[data-act=save]")
        await t.wait_for_selector(".gm-card:has-text('測試題庫')")
        saved = await t.evaluate("IrsQuizBank.list().then(l=>l.find(q=>q.title==='測試題庫'))")
        r["editorSaved"] = saved and len(saved["questions"]) == 2 and saved["questions"][0]["options"] == ["台中", "台北"] and saved["questions"][0]["correct"] == [1] and saved["questions"][1]["double"] is True

        # 2) CSV 匯入（含一題格式錯誤應被略過）
        path = os.path.join(tempfile.mkdtemp(), "匯入測試.csv")
        open(path, "w", encoding="utf-8-sig").write(CSV)
        await t.set_input_files("[data-import=csv]", path)
        await t.wait_for_selector(".gm-card:has-text('匯入測試')", timeout=5000)
        imp = await t.evaluate("IrsQuizBank.list().then(l=>l.find(q=>q.title==='匯入測試'))")
        r["csvImported"] = len(imp["questions"]) == 2 and imp["questions"][1]["correct"] == [0, 2]

        # 3) 團隊模式＋測試題庫
        await t.check("[data-setting=team]")
        await t.click(".gm-card:has-text('測試題庫') [data-act=start]")
        await t.wait_for_selector("[data-count]")
        await t.wait_for_function("document.querySelector('[data-count]').textContent==='4'", timeout=10000)
        await t.click("[data-act=next]")
        await t.wait_for_function("IrsGame._test.T.phase==='answer'", timeout=15000)
        # 4) 暫停／繼續：暫停 2 秒後剩餘時間不應減少
        await t.click("[data-act=pause]")
        before = await t.evaluate("IrsGame._test.T.remainingMs")
        await asyncio.sleep(2)
        after = await t.evaluate("IrsGame._test.T.remainingMs")
        paused_msg = await studs[0].evaluate("document.querySelector('.gm-student .gm-s-big')?.textContent")
        await t.click("[data-act=pause]")
        r["pauseHoldsTimer"] = abs(before - after) < 150 and paused_msg and "暫停" in paused_msg
        await studs[0].wait_for_selector("[data-choice='1']", timeout=8000)
        r["resumeShowsButtons"] = True
        # 第 1 組全對、第 2 組全錯
        for s, c in zip(studs, [1, 1, 0, 0]):
            await s.click(f"[data-choice='{c}']")
        await t.wait_for_function("IrsGame._test.T.phase==='reveal'", timeout=15000)
        await asyncio.sleep(1.5)
        await t.click("[data-act=next]")   # 排行榜（團隊）
        await asyncio.sleep(2.5)
        board = await t.evaluate("[...document.querySelectorAll('[data-row] .gm-name')].map(n=>n.textContent)")
        r["teamBoard"] = board[:1] == ["第 1 組（2 人）"]

        # 5) 中途加入：第 2 題作答中加入的學生應直接看到選項
        await t.click("[data-act=next]")
        await t.wait_for_function("IrsGame._test.T.phase==='answer'", timeout=15000)
        late = await join(b, url, "晚到同學", errors)
        try:
            await late.wait_for_selector("[data-choice='0']", timeout=10000)
            r["lateJoinGetsQuestion"] = True
        except Exception:
            r["lateJoinGetsQuestion"] = False
        for s in studs + [late]:
            if await s.locator("[data-choice='1']").count():
                await s.click("[data-choice='1']")
        await t.wait_for_function("IrsGame._test.T.phase==='reveal'", timeout=15000)
        await asyncio.sleep(1.5)
        late_score = await t.evaluate("[...IrsGame._test.T.players.values()].find(p=>p.name==='晚到同學')?.score || 0")
        r["lateJoinScored"] = late_score >= 1000   # 雙倍分數題答對至少 1000
        # 6) 頒獎＋把小組分數加到計分板
        await t.click("[data-act=next]"); await asyncio.sleep(0.6)
        await t.click("[data-act=next]")
        await t.wait_for_function("IrsGame._test.T.phase==='podium'", timeout=15000)
        await t.click("[data-act=toscore]")
        sc = await t.evaluate("scoreState.teams.map(t=>t.score)")
        r["scoreboardUpdated"] = sc[0] > sc[1] and sc[0] > 0
        # 7) 隱藏排行榜：學生結果不顯示名次
        await t.click("[data-act=again]")
        await t.wait_for_selector("[data-count]")
        await t.click("[data-act=hideboard]")
        await t.click("[data-act=next]")
        await t.wait_for_function("IrsGame._test.T.phase==='answer'", timeout=15000)
        for s in studs:
            await s.click("[data-choice='1']")
        await t.wait_for_function("IrsGame._test.T.phase==='reveal'", timeout=15000)
        await asyncio.sleep(2.5)
        txt = await studs[0].evaluate("document.querySelector('.gm-student').innerText")
        label = await t.evaluate("document.querySelector('[data-act=next]').textContent")
        r["hideBoardNoRank"] = "名" not in txt and "下一題" in label
        await t.click("[data-act=hideboard]")  # 還原設定
        # 8) 離開：學生畫面關閉
        await t.click("[data-act=close]")
        await asyncio.sleep(1.5)
        r["exitClosesStudent"] = await studs[0].evaluate("getComputedStyle(document.querySelector('.gm-student')).display") == "none"
        r["errors"] = errors[:10]
        await b.close()
    print(json.dumps(r, ensure_ascii=False, indent=2))

asyncio.run(main())
