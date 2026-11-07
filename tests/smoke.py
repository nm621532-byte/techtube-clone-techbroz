#!/usr/bin/env python3
"""TechTube smoke test (Playwright, Chromium). Usage:
    python3 tests/smoke.py http://127.0.0.1:8765/
It signs up a throwaway account, checks feed, search, watch, likes, comments,
subscribe, watch-later, upload, Shorts, theme, sign-out and wrong-password.
Exit code 0 = all checks passed."""
import subprocess, sys, tempfile, os, time
from playwright.sync_api import sync_playwright, expect

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/").rstrip("/") + "/"
SHOTS = os.environ.get("SHOTS_DIR", tempfile.gettempdir())
errors = []
checks = []

def check(name, cond):
    checks.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name, flush=True)
    if not cond:
        raise SystemExit(1)

def make_clip(path):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "4",
                    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=12", "-t", "2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", path], check=True, timeout=60)

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(BASE, wait_until="domcontentloaded")

    # sign up
    expect(page.locator("#authGate")).to_be_visible()
    NAME = "Smoke " + str(int(time.time()))
    page.fill("#authName", NAME)
    page.fill("#authPass", "secret123")
    page.click("#authSubmit")
    expect(page.locator("#authGate")).to_be_hidden()
    expect(page.locator(".grid .card").first).to_be_visible()
    check("signup lands on feed with 6 sample videos", page.locator(".grid .card").count() >= 6)

    # categories
    page.click("a.chip:has-text('Coding')")
    expect(page.locator(".grid .card")).to_have_count(1)
    check("category chip filters the feed", page.locator(".grid .card").count() == 1)
    page.click("a.chip:has-text('All')")

    # search
    page.fill("#searchInput", "pixel")
    page.press("#searchInput", "Enter")
    expect(page.locator(".row-result").first).to_be_visible()
    check("search finds 'pixel'", page.locator(".row-result").count() >= 1)

    # watch page
    page.click(".row-result >> nth=0")
    expect(page.locator("#player")).to_be_visible()
    check("watch page has an HTML5 video with a src", (page.get_attribute("#player", "src") or "").endswith(".mp4"))
    before = page.inner_text("#likeCount")
    page.click("#likeBtn")
    check("like increments count", page.inner_text("#likeCount") != before or page.get_attribute("#likeBtn", "aria-pressed") == "true")
    page.click("#likeBtn")  # toggle back
    page.click("#dislikeBtn")
    check("dislike toggles on", page.get_attribute("#dislikeBtn", "aria-pressed") == "true")
    page.click("#dislikeBtn")

    page.fill("#commentForm textarea", "Smoke test comment ✅")
    page.click("#commentForm button[type=submit]")
    expect(page.locator("#commentList .comment p").first).to_have_text("Smoke test comment ✅")
    check("comment posts and shows", True)
    page.click("#commentList button[data-action=delcomment] >> nth=0")
    expect(page.locator("#commentList .comment")).to_have_count(0)
    check("own comment can be deleted", True)

    page.click("#laterBtn")
    check("watch later toggles", "Watch later" in page.inner_text("#laterBtn") and page.get_attribute("#laterBtn", "aria-pressed") == "true")
    page.click("button[data-action=sub]")
    check("subscribe toggles", "Subscribed" in page.inner_text("button[data-action=sub] >> nth=0"))

    # play once so history records
    page.evaluate("document.querySelector('#player').muted = true")
    page.evaluate("document.querySelector('#player').play().catch(()=>{})")
    time.sleep(1)

    # upload
    clip = os.path.join(tempfile.gettempdir(), "tt_smoke_clip.mp4")
    make_clip(clip)
    page.goto(BASE + "#/upload")
    expect(page.locator("#uploadForm")).to_be_visible()
    page.set_input_files("#uploadForm input[type=file]", clip)
    page.fill("#uploadForm [name=title]", "Smoke upload clip")
    page.click("#upSubmit")
    expect(page.locator("#player")).to_be_visible(timeout=15000)
    check("upload saves and opens its watch page", "Smoke upload clip" in page.inner_text("h1"))
    src = page.get_attribute("#player", "src")
    check("uploaded video plays from a local blob URL", src.startswith("blob:"))

    # shorts
    page.goto(BASE + "#/shorts")
    expect(page.locator(".short").first).to_be_visible()
    check("shorts feed has one full-screen item per video", page.locator(".short").count() >= 7)

    # library shows history / later / uploads
    page.goto(BASE + "#/library")
    expect(page.locator("h1.page")).to_have_text("Library")
    check("library lists the upload", "Smoke upload clip" in page.inner_text("body"))

    # settings: light theme, then persist across reload
    page.goto(BASE + "#/settings")
    page.check("input[name=theme][value=light]")
    check("light theme applies", page.get_attribute("html", "data-theme") == "light")
    page.reload(wait_until="domcontentloaded")
    expect(page.locator("h1.page").first).to_have_text("Settings")
    check("theme persists after reload", page.get_attribute("html", "data-theme") == "light")

    # desktop layout screenshot + shots for review
    page.screenshot(path=os.path.join(SHOTS, "tt_mobile_home.png"))

    # sign out, wrong password, right password
    page.goto(BASE + "#/settings")
    page.click("button[data-action=signout]")
    expect(page.locator("#authGate")).to_be_visible()
    page.fill("#authName", NAME)
    page.fill("#authPass", "wrong-pass")
    page.click("#authSubmit")
    expect(page.locator("#authError")).to_have_text("Wrong password.")
    check("wrong password is refused", True)
    page.fill("#authPass", "secret123")
    page.click("#authSubmit")
    expect(page.locator("#authGate")).to_be_hidden()
    check("correct password signs back in", True)

    ctx.close()

    # desktop pass
    dctx = browser.new_context(viewport={"width": 1280, "height": 800})
    dpage = dctx.new_page()
    dpage.on("pageerror", lambda e: errors.append(str(e)))
    dpage.goto(BASE, wait_until="domcontentloaded")
    dpage.fill("#authName", "Desk Tester")
    dpage.fill("#authPass", "secret123")
    dpage.click("#authSubmit")
    expect(dpage.locator(".grid .card").first).to_be_visible()
    dpage.goto(BASE + "#/watch/s2")
    expect(dpage.locator("#player")).to_be_visible()
    check("desktop watch page renders with related column", dpage.locator(".related .rel").count() >= 3)
    dpage.screenshot(path=os.path.join(SHOTS, "tt_desktop_watch.png"))
    dctx.close()
    browser.close()

real_errors = [e for e in errors if "favicon" not in e.lower() and "net::ERR" not in e]
check("no uncaught page errors", not real_errors)
if real_errors:
    print(real_errors[:5])
print(f"ALL {len(checks)} CHECKS PASSED", flush=True)
