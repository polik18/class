"""IRS 混合模式／Swarm 瀏覽器壓測（本機）。

需求：pip install playwright && playwright install chromium
準備：
  1. 專案根目錄執行  python3 -m http.server 4177 --bind 127.0.0.1
  2. realtime-worker 目錄執行  npx wrangler dev --port 8790
執行：
  python3 tools/load/swarm_browser_load.py --students 24 --direct-cap 6 [--kill-relay] [--media] [--no-swarm]

說明：每位學生是獨立的瀏覽器 context（等同一台裝置）。本機測試涵蓋協定、去重、ACK 與中繼失效恢復，
不代表真實 Wi-Fi 容量；正式人數宣稱仍需實機驗收（見 docs/CLASS_IMPROVEMENT_PLAN_2026-11.md 第 5 節 P5）。
"""
import argparse, asyncio, json, statistics, time
from playwright.async_api import async_playwright

BASE = "http://localhost:4177/"

FAKE_SCREEN = """(()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const g=c.getContext('2d');let f=0;
setInterval(()=>{g.fillStyle='hsl('+(f++*7%360)+',70%,45%)';g.fillRect(0,0,1280,720);g.fillStyle='#fff';g.font='64px sans-serif';g.fillText('frame '+f,60,360)},66);
const st=c.captureStream(15);navigator.mediaDevices.getDisplayMedia=async()=>st;})()"""


async def main(args):
    report = {"students": args.students, "directCap": args.direct_cap, "swarm": not args.no_swarm}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        errors = []
        tctx = await browser.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
        teacher = await tctx.new_page()
        teacher.on("pageerror", lambda e: errors.append("teacher: " + str(e)[:160]))
        teacher.on("dialog", lambda d: asyncio.ensure_future(d.dismiss()))
        query = "transport=hybrid" + ("" if args.no_swarm else f"&swarm=1&swarmDirect={args.direct_cap}")
        await teacher.goto(BASE + "?" + query, wait_until="load")
        await teacher.wait_for_timeout(2500)
        await teacher.evaluate("closeWelcomeGuide()")
        await teacher.click("#nav-irs")
        await teacher.click("#irs-start-btn")
        await teacher.wait_for_function("irsState.roomId && irsState.roomId.length > 4", timeout=20000)
        join_url = await teacher.evaluate("buildIRSJoinUrl(irsState.roomId)")

        students = []
        t0 = time.time()
        for i in range(args.students):
            ctx = await browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
            page = await ctx.new_page()
            page.on("pageerror", lambda e, i=i: errors.append(f"student{i+1}: " + str(e)[:160]))
            await page.goto(join_url, wait_until="load")
            try:
                await page.wait_for_selector("#irs-join-name", state="visible", timeout=60000)
            except Exception:
                await page.screenshot(path=f"load-fail-student{i+1}.png")
                raise
            await page.fill("#irs-join-name", f"學生{i+1:02d}")
            await page.click("text=男生")
            await page.evaluate("joinIRS()")
            students.append((ctx, page))
            await page.wait_for_timeout(args.join_gap)
        await teacher.wait_for_function(f"Object.keys(irsState.studentsInfo).length >= {args.students}", timeout=60000)
        await teacher.wait_for_timeout(5000)
        report["joinSeconds"] = round(time.time() - t0, 1)
        report["topology"] = await teacher.evaluate("irsState.transport.stats()")

        async def answer_round(qtype, values):
            await teacher.evaluate(f"sendIRSQuestion('{qtype}')")
            await teacher.wait_for_timeout(2000)
            sent = time.time()
            await asyncio.gather(*[page.evaluate(f"submitIRSAnswer('{values[i % len(values)]}')") for i, (_, page) in enumerate(students)])
            latencies = []
            deadline = time.time() + 20
            while time.time() < deadline:
                done = await teacher.evaluate("Object.values(irsState.studentsInfo).filter(s=>s.hasAnswered).length")
                if done >= len(students):
                    break
                await teacher.wait_for_timeout(100)
            latencies.append(time.time() - sent)
            await teacher.wait_for_timeout(args.ack_wait)
            pending = [await page.evaluate("irsState.transport.pendingAcks.size") for _, page in students]
            answered = await teacher.evaluate("Object.values(irsState.studentsInfo).filter(s=>s.hasAnswered).length")
            await teacher.evaluate("stopIRSQuestion()")
            await teacher.wait_for_timeout(800)
            return {"answered": answered, "of": len(students), "allAnsweredSeconds": round(latencies[0], 2), "unackedStudents": sum(1 for x in pending if x)}

        report["round1"] = await answer_round("ABCD", "ABCD")

        if args.media:
            await teacher.evaluate(FAKE_SCREEN)
            await teacher.evaluate("toggleTeacherBroadcast()")
            await teacher.wait_for_timeout(10000)
            seen = [await page.evaluate("(()=>{const v=document.querySelector('#screen-view-modal video');return !!(v&&v.videoWidth)})()") for _, page in students]
            report["mediaReceived"] = f"{sum(seen)}/{len(seen)}"
            await teacher.evaluate("stopTeacherBroadcast()")
            await teacher.wait_for_timeout(2000)

        if args.kill_relay and not args.no_swarm:
            relay_ids = await teacher.evaluate("[...irsState.transport.swarm.relayNodes.entries()].filter(([k,v])=>v.size).map(([k])=>k)")
            if relay_ids:
                ids = [await page.evaluate("irsState.transport.clientId") for _, page in students]
                idx = ids.index(relay_ids[0])
                await students[idx][0].close()
                students.pop(idx)
                await teacher.wait_for_timeout(12000)
                report["afterKillTopology"] = await teacher.evaluate("irsState.transport.stats()")
                report["round2AfterRelayKilled"] = await answer_round("OX", "OX")

        report["errors"] = errors[:10]
        await browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--students", type=int, default=12)
    ap.add_argument("--direct-cap", type=int, default=4)
    ap.add_argument("--join-gap", type=int, default=800, help="每位學生加入間隔（毫秒）")
    ap.add_argument("--ack-wait", type=int, default=6000)
    ap.add_argument("--kill-relay", action="store_true")
    ap.add_argument("--media", action="store_true")
    ap.add_argument("--no-swarm", action="store_true")
    asyncio.run(main(ap.parse_args()))
