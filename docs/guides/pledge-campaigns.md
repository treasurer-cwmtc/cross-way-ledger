# Pledge Campaigns

*How to set up a fundraising campaign, import its data with the 5-step wizard, and read the Status and Details views once it's running.*

**Required permissions:** `Campaign Status`, `Campaign Details` (Details requires either the Pledges or Actuals half of that permission), and the Import Campaigns wizard itself follows the same access as Campaign Status/Details

---

## How a campaign is put together

A pledge campaign (e.g. "Phase 2 Building Project") tracks two things against a goal: **pledges** (a commitment to give, from a pledge form) and **actual giving** (real donations, from the Giving App / Planning Center export). A campaign declares which donation **fund** it's tracking — chosen from the funds actually present in your donations export, never hand-typed — and reads that fund's giving dynamically, so uploading donations never requires picking a campaign first.

## The Import Campaign Data wizard

This is a 5-step, safe-to-re-run wizard: donations and donors are always **upserted** (re-importing the same file never creates duplicates), and pledges are automatically matched to donors by email — both at import time and again any time a later donor import resolves a previously-unmatched pledge.

### Step 1 — Campaign

Choose an existing campaign from the dropdown, or click **+ New campaign** to create one (name, goal amount, starting balance). If you're revisiting an existing campaign, you can update its **Starting balance** here and click **Save**.

### Step 2 — Donations

Upload the **Donations export** (the Giving App's own export — the source of truth; no fund needs to be chosen at this step, since every fund present in the file is imported). Click **Import donations**.

A **Funds on file** table shows every fund now on record, with gift counts and totals. You can delete all giving data for a fund here if it was imported by mistake — this permanently removes that data and can't be undone except by restoring a backup, so the confirmation prompt is explicit about that.

### Step 3 — Pledges

Choose **which fund this campaign is tracking** (from the funds you just imported), then upload the **Pledge form export**. Click **Import pledges**.

You'll see four stat tiles — **New pledges**, **Updated pledges**, **Matched to a donor**, **No gift yet** — and two results tables (**New records** / **Updated records**) showing each pledge's name, email, pledged amount, delivery date, and matched donor (or a dash if no gift has come in yet to match against).

### Step 4 — Donors

Upload the **Donors export** (the Giving App's donor list — shared across every campaign, not scoped to this one). Click **Import donors & finish**.

This step **re-matches this campaign's pledges automatically** — so anyone who gave for the first time since Step 3 gets linked to their pledge without you needing to re-upload pledges. It advances to the summary automatically when it finishes.

### Step 5 — Summary

A quick sanity check: pledge count, total pledged, this fund's donation count, and total raised for this fund. If these numbers don't look right, the most common cause is picking the wrong fund in Step 3 — double check it matches what you expected.

> **Every file you upload in this wizard is also archived to Google Drive**, organized by fiscal year and campaign name, for audit purposes. If that archiving step fails for any reason, the import still proceeds — you'll just see a note that the file wasn't saved for audit, which never blocks your actual data from being imported.

## Campaign Status

The day-to-day dashboard for a running campaign:

- **Progress toward goal** — two progress bars: **Cash Received** (dollars actually given) and **Pledged & Given** (total commitment, including gifts from people who gave without a formal pledge).
- **At a glance** — starting balance, pledge goal, pledged amount, received amount, number of pledges, number of gifts.
- **Giving over time** — a running-total line chart with separate lines for Pledged, Actual, and the campaign Goal.

## Campaign Details

A row-level table: every pledge form submission, plus anyone who gave to this fund without ever submitting a pledge. Click a row to see full detail, or manually link it to a pledge/donor if the automatic email match missed it.

One subtlety worth understanding: **when a pledge's donor has a joint giver (a spouse) who didn't pledge separately**, that spouse's giving is folded into the pledge's Received Amount automatically — so you won't see two disconnected rows for a married couple who only made one pledge together. If the spouse *did* submit their own separate pledge, they get their own row instead, with no double-counting.

### Hiding donor names

Anywhere on the Campaign pages, click **Donor info hidden / Donor info shown** to toggle whether real donor names are visible — showing only Donor ID / Joint Donor ID instead. This defaults to hidden every time you load the page. An administrator can also make this the *permanent* setting for a specific user (see [Administration](administration.md)), which applies even if that user is an admin themselves.

---

## Tips

- **Import order matters the first time, but re-running is always safe.** Donations → Pledges → Donors is the natural order because each step depends on data from the one before it, but if you need to re-upload any file later (a corrected export, a new batch of donations), just re-run that step — nothing gets duplicated.
- **A pledge showing no Donor ID isn't an error** — it just means that person hasn't given yet. It'll resolve automatically the next time you import an updated donor list.
- **If Campaign Status's numbers look off**, check Campaign Details first — it's the row-level view that makes it obvious whether a specific gift or pledge landed where you expected.

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Donors & Receipts](donors-and-receipts.md).*
