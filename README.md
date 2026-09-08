# JAVE — Job Application via Email and Agent

JAVE started as a simple bulk email tool for job applications. It has since evolved into a two-part system: a job scraper with an interactive interface, and an automated LinkedIn application agent.

---

## What It Does

**Part 1 — Scout** finds and displays recent, locally profile-matched job listings from LinkedIn and optional JSearch in your terminal. Choose countries, browse listings, read full descriptions, and select jobs you want to apply to.

**Part 2 — Agent** takes Scout's output further. It evaluates each job against your profile, waits for your approval, tailors your resume, fills supported LinkedIn Easy Apply forms, and stops for a complete review. The application is submitted only after you explicitly type `SUBMIT`.

---

## Project Structure

```
jave/
├── scout.js                        # Browse jobs interactively
├── apply.js                        # Full reviewed application workflow
├── scrapers.js                     # Fetch jobs from LinkedIn and JSearch
├── search-options.js                # Shared country selection, CLI options, and search policy
├── job-analyzer.js                 # Isolated job-only Gemini gateway
├── evaluator.js                    # Local candidate scoring and fallback extraction
├── career-profile.json             # Local professional facts; ignored by Git
├── career-profile.example.json     # Safe setup template
├── private-profile.json            # Local PII and answers; ignored by Git
├── private-profile.example.json    # Safe setup template
├── resume-selector.js              # Deterministic local resume selection
├── resumes.json                    # Base resume paths and local role signals
├── tailor.js                       # Local tailoring, PII injection, DOCX/PDF rendering
├── applier.js                      # Local browser form filling and submission gate
├── applications.json               # Auto-generated application history
└── .env                            # API keys and local browser paths; ignored by Git
```

---

## Requirements

- Node.js 22.3 or higher
- Chromium installed (`/usr/bin/chromium` on Arch Linux)
- LibreOffice (required to convert DOCX resumes to PDF before upload)
- A Gemini API key is optional. When configured, Gemini receives job-posting data only and extracts job requirements. Local extraction is used otherwise.
- A RapidAPI key with JSearch subscribed is optional.

Install Node dependencies:

```bash
npm install
```

---

## Configuration and Private Information

### 1. Create the private PII file

All direct personal information and reusable application answers belong in exactly:

```text
private-profile.json
```

On a fresh installation:

```bash
cp private-profile.example.json private-profile.json
chmod 600 private-profile.json
```

Edit `private-profile.json` and replace the placeholder values under `personal`. Put work authorization, sponsorship, relocation, notice period, and salary answers under `application`. Leave an answer as `null` when JAVE must ask before using it. Values are resolved locally by `applier.js` and typed directly into the browser; they are never added to a model request.

`field_aliases` maps form labels to private values. For example, `"email address": "personal.email"` means an Email address field receives the locally stored email. Add an alias only when a real form uses a label that JAVE does not already recognize.

`private-profile.json` is ignored by Git. It is local plaintext, so keep the file permission at `600`, do not place it in cloud-synchronized folders, and never copy its values into `.env`, `career-profile.json`, `resumes.json`, or an issue report.

### 2. Create the local career profile

Professional facts used for local scoring and the locally generated resume summary belong in:

```text
career-profile.json
```

On a fresh installation:

```bash
cp career-profile.example.json career-profile.json
chmod 600 career-profile.json
```

Fill in the headline, years of experience, education, skills, languages, and target roles. This file is also ignored by Git. Scout and Agent use it for local screening before displaying search results. The Agent also uses it after Gemini returns a job-only requirement analysis; it is never included in the Gemini request.

### 3. Configure base resumes

Resume sources are configured in `resumes.json`. Each profile points to a trusted local DOCX. Base DOCX files should contain approved career facts and must contain a recognized section heading such as `EXPERIENCE`, `PROJECTS`, `SKILLS`, or `EDUCATION`.

The local renderer ignores everything before the first recognized section. For a single source of truth, remove name, email, phone, location, and profile URLs from base resumes. The final header is always created locally from `private-profile.json`.

### 4. Configure optional services

Create a `.env` file in the project root:

```text
GEMINI_API_KEY=your_gemini_api_key
OUTPUT_DIR=./output
CHROMIUM_PATH=/usr/bin/chromium
CHROMIUM_PROFILE=/home/yourusername/.config/chromium
JSEARCH_API_KEY=your_rapidapi_key_here
```

`GEMINI_API_KEY` and `JSEARCH_API_KEY` are optional. The Gemini request contains only job title, company, and description. Private answers, the career profile, base resumes, and final resumes remain local.

---

## One-Time Setup for the Agent

The agent uses your existing Chromium session to stay logged into LinkedIn. Before running the agent for the first time:

1. Open Chromium manually
2. Go to linkedin.com and log in, ticking "Keep me logged in"
3. Close Chromium completely
4. Run the agent — it will pick up your session automatically

Make sure Chromium is fully closed before running the agent. Two instances sharing the same profile will cause conflicts.

---

## Usage

**Browse jobs without applying:**

```bash
node scout.js
```

Select countries with **Space**, then press **Enter**. **Malaysia (MY)** and **Oman (OM)** are preselected; **Singapore (SG)** and **Saudi Arabia (SA)** are also available. At least one country is required. The keyword prompt defaults to your first target role in `career-profile.json`. Search again lets you change countries and remembers the previous selection within the session.

To bypass the initial country prompt:

```bash
node scout.js --countries MY,OM
node scout.js --countries MY,OM,SG
node scout.js --countries SG
```

Both commands accept comma-separated country codes or quoted full names, case-insensitively, including `--countries=MY,OM`. Run `node scout.js --help` or `node apply.js --help` for usage.

**Search rules shared by Scout and Agent:**

- Query only selected countries and rank **newest first**, ahead of country and local match score. Equal posting ages use Malaysia, Oman, Singapore, then Saudi Arabia as the country tie-breaker, followed by local match score.
- Give postings younger than **5 hours** first priority, checked again after descriptions load. LinkedIn is queried with a five-hour window; JSearch's daily results are filtered locally to the same strict boundary. If any qualify, display only those recent matches.
- If no under-five-hour postings match the local profile and selected countries, search older postings without an age limit and display the newest available matches first. Exactly five-hour-old postings belong to this fallback tier. Scout and Agent label the active tier; Agent processes the same order.
- Missing, invalid, and future timestamps are excluded in both tiers. A precise timestamp takes precedence over relative text. Date-only postings use an agreeing relative label when available; contradictory dates are excluded. Without hour-level evidence, age is conservatively bounded from UTC midnight and the posting date is displayed with “time unknown.” This may keep genuinely recent postings with incomplete dates out of the priority tier.
- Require explicit country evidence from the listing. City-only locations and global remote listings without country evidence are excluded rather than assigned to the requested country.
- Load descriptions and screen locally against target roles, skills, and experience. A role outside your configured targets needs at least two distinct matching profile skills; excessive experience requirements are rejected by the evaluator. Listings without usable descriptions are excluded. No model calls or candidate-profile data are sent to search providers.
- Display local match scores, matched skills in details, and counts for the final filtered results. Scores are heuristic screening signals, not a complete qualification assessment; review the description and work-authorization or nationality restrictions yourself.
- Report source failures separately from a genuine no-match result. An unavailable source does not discard successful results from another country or source.

Select a job to view its description, local match details, and original link. To try the country-selection interface without network requests, run `node scout.js --demo`. Demo postings are clearly synthetic and still pass through the country, freshness, and profile filters.

**Run the full agent:**

```bash
node apply.js "Software Engineer"
node apply.js "Software Engineer" --countries MY,OM
```

1. Select countries (unless supplied with `--countries`) and fetch recent, locally profile-matched LinkedIn/JSearch jobs; process up to 15
2. Ask Gemini to extract requirements from job-posting data only, or use local extraction when Gemini is unavailable
3. Score the extracted requirements locally against `career-profile.json`; anything below 50% match is skipped automatically
4. Select a base DOCX locally from configured role signals
5. Display the match summary, resume recommendation, confidence, and reason
6. Allow `[R]` to override the resume, then wait for you to approve preparation
7. Extract approved resume sections and prioritize matching skills locally
8. Add the name and contact header from `private-profile.json` during local DOCX rendering
9. Convert the locally rendered DOCX to PDF with LibreOffice
10. Open Chromium and fill supported Easy Apply controls directly from the local private profile
11. Ask for any answer that is absent from the private profile instead of guessing
12. Display every collected answer and keep the browser form open for verification
13. Submit only when you explicitly type `SUBMIT`; `EDIT` returns to review and `CANCEL` exits without submission
14. Record confirmed, unconfirmed, cancelled, skipped, incomplete, and failed outcomes in `applications.json`

Easy Apply detection waits for a visible application form with loaded controls. It supports native `<dialog>` elements, ARIA dialog/modal containers, and LinkedIn Easy Apply modal wrappers, using application labels/headings or LinkedIn classes to distinguish them from unrelated dialogs. Filling and Next/Review/Submit actions stay inside that form; hidden dialogs and background-page controls are ignored. Existing answers are preserved, and submission still requires typing `SUBMIT`.

Before filling a blank phone field from the private profile, JAVE selects its configured phone country code instead of accepting the dropdown's implicit first option. Dial codes match exactly: a shared code such as `+1` prompts for a country rather than picking the first match. An unanswered choice stays unresolved and blocks progression when required. Existing phone/contact answers, including the account email selection, are preserved.

If the application form cannot be identified, JAVE stops rather than entering private information elsewhere on the page. Check that Chromium is signed in and the Easy Apply form opens. For an unsupported layout, capture the outer dialog wrapper, field labels/controls, and navigation buttons, with personal values redacted. Dialog identification and navigation currently recognize English application labels.

---

## Resume Tailoring and PII Boundary

Resume preparation is local. Gemini is not called by `tailor.js` and never receives a base resume or final resume.

The selector compares the job title and description with local signals in `resumes.json`. After you approve preparation, JAVE reads the selected DOCX locally, discards its pre-section header, preserves its approved career content, prioritizes matching skills, and builds a factual summary from `career-profile.json`.

Only then does the local renderer read `private-profile.json` and create the final name and contact header. The resulting DOCX is converted to PDF locally and passed directly to the browser uploader. The model has no access to either artifact.

Tailored DOCX and PDF files are saved in `output`. Review the generated PDF before typing `SUBMIT`.

---

## Application Log

Every job the agent processes is recorded in `applications.json`, including:

- Job title and company
- Match score and reasoning
- Skills matched and missing
- Application status: applied, submitted but unconfirmed, cancelled before submission, incomplete, skipped, or error

---

## Limitations

- LinkedIn Easy Apply forms vary significantly between companies. Most are handled automatically, but complex forms with custom questions will pause and ask you for input.
- Jobs that redirect to external company websites are skipped by design.
- LinkedIn may occasionally detect browser automation and log out the session. If this happens, log back in manually in Chromium and run the agent again.
- JSearch is optional and requires a subscribed RapidAPI key. Each search makes one JSearch request per selected country when configured; selecting more countries consumes more quota.
- Gemini rate limits can affect job-requirement extraction. JAVE falls back to local extraction without sending candidate data.