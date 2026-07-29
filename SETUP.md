# Getting the app online — step by step

Written for someone who has never used GitHub. **Everything here is done in a
web browser.** You do not need to install anything or type any commands.

Total time: about ten minutes, most of it waiting for a build.

---

## First, a decision you can't skip

GitHub Pages is the free web hosting that will serve this app. What it costs
depends on whether your repository is public or private:

| Your repository | What you need | The published site is |
| --- | --- | --- |
| **Public** | Nothing — works on the free plan | Public |
| **Private** | GitHub Pro, about $4/month | **Still public** |

Note the last column. Paying for Pro lets you keep the *source code* private,
but the *website itself is still public either way* — a private site needs a
GitHub Enterprise plan. So the only question is whether you mind people being
able to read the code.

**For this app, making the repository public is usually the right call**, for a
reason worth understanding:

> Your audits never go into the repository. The plans you load, the notes you
> type and the photos you take are stored on your phone or iPad and nowhere
> else. Making the repository public publishes the app's *source code* — not a
> single one of your surveys.

The one thing to watch: **don't ever commit a real client's CAD plan into the
repository** if it's public. You never need to — you load plans from your
device when you use the app.

If the code itself is sensitive to you, buy Pro and skip Step 1.

---

## Step 1 — Make the repository public

Skip this if you're paying for GitHub Pro.

1. Go to **https://github.com/lymaxxx/algach**
2. Click **Settings** (the tab along the top, on the right)
3. Scroll to the very bottom, to the red **Danger Zone** box
4. On **Change repository visibility**, click **Change visibility**
5. Choose **Make public**, then confirm — it asks you to type the repository
   name to prove you meant it

---

## Step 2 — Rename the repository (optional)

The repo is currently called `algach`, which doesn't say much. The name becomes
part of your web address, so `signage-audit` gives you
`https://lymaxxx.github.io/signage-audit/`.

1. **Settings** → **General** (the first section)
2. The **Repository name** box is at the top — type the new name
3. Click **Rename**

**Do this now, before Step 5.** The address is built from the name, so renaming
later changes your URL and means running the build again. (GitHub redirects the
old address, so nothing breaks — but the app's own address would move.)

---

## Step 3 — Point the repository at the app

A repository can hold several parallel versions, called *branches*. The app is
on a branch called `claude/signage-audit-app-ul649t`. The **default branch** is
the one GitHub treats as the real version — and right now it's still pointing at
an unrelated website that was in this repo before.

1. **Settings** → **Branches** (left-hand sidebar, under "Code and automation")
2. Under **Default branch**, click the **⇄** swap button
3. Choose **`claude/signage-audit-app-ul649t`**
4. Click **Update**, then confirm

Nothing is lost — the old branch is still there.

---

## Step 4 — Rename that branch to `main` (optional)

`claude/signage-audit-app-ul649t` is an ugly name. `main` is the convention.

1. On the repository's **Code** tab, click the **branch** dropdown, then **View
   all branches**
2. Find the branch and click the **pencil** icon on its row
3. Type `main`, then **Rename branch**

---

## Step 5 — Turn on the hosting

1. **Settings** → **Pages** (left-hand sidebar)
2. Under **Build and deployment** → **Source**, choose **GitHub Actions** from
   the dropdown

That's it — there's no Save button. Ignore any other options on the page.

---

## Step 6 — Build the site

GitHub builds the app automatically whenever the code changes, but nothing has
changed since you switched branches, so this first one is done by hand.

1. Click the **Actions** tab along the top
2. If it offers a green **I understand my workflows, go ahead and enable them**
   button, click it
3. In the left-hand sidebar, click **Build and deploy**
4. On the right, click **Run workflow** → leave the branch as it is → click the
   green **Run workflow** button
5. Refresh the page after a few seconds. A run appears with a yellow dot,
   meaning it's working. It takes a minute or two.

**A green tick means it's live.** A red cross means something failed — click
into the run to see which step, and send me the message.

---

## Step 7 — Find your address

Go back to **Settings** → **Pages**. At the top it now says:

> Your site is live at `https://lymaxxx.github.io/<your-repo-name>/`

That link is the app. Open it on your computer to check it loads.

---

## Step 8 — Put it on your iPhone or iPad

**Do this rather than using it in a browser tab.** It is not cosmetic — iOS
clears a website's saved data after about a week of not visiting, and
home-screen apps are exempt. It also makes the app open reliably with no signal.

1. Open the address in **Safari** on the device (email yourself the link, or
   just type it in)
2. Tap the **Share** button — the square with an arrow pointing up
3. Scroll down the list and tap **Add to Home Screen**
4. Tap **Add**

You now have an icon on your home screen. Open it from there from now on.

---

## Step 9 — Load a plan and use it

Get the DXF onto the device first — AirDrop it, put it in iCloud Drive, or email
it to yourself and save it to Files.

1. Open the app from your home screen
2. Tap **Open a DXF plan** and pick the file
3. The app shows the blocks it found and which one it thinks is your signs.
   Check the preview of names looks right, then tap **Create audit**
4. Tap a sign on the plan, or find it in the **Signs** list

Then, at the end of each day: **⋯ menu → Save project file**. That's a single
file with the drawing, all your notes and all your photos — save it to Files or
iCloud. It's the only copy that survives a lost phone, and the header tells you
"not exported" when there's work that only exists on the device.

---

## Afterwards

**Changing the app.** Ask me. When a change is pushed to the default branch,
GitHub rebuilds and republishes it on its own — usually within two minutes.
On your device, close the app and reopen it to pick up the new version.

**Moving it to a different repository later.** Nothing is tied to this
repository's name — the build works out its own web address. See the "Moving it
to another repository" section of `README.md`.

**If the site shows a blank page** after renaming the repository, re-run the
build (Step 6). The address changed and the app needs rebuilding to match.
