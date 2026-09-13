# JAVE — Job Application via Email and Agent

JAVE started as a simple bulk email tool for job applications. It has since evolved into a two-part system: a job scraper with an interactive interface, and an automated LinkedIn application agent.

---

## What It Does

**Part 1 — Scout** finds and displays recent, locally profile-matched job listings from LinkedIn and optional JSearch in your terminal. Choose countries, browse listings, read full descriptions, and select jobs you want to apply to.

**Part 2 — Agent** takes Scout's output further. It evaluates each job against your profile, offers optional resume tailoring, fills supported LinkedIn Easy Apply forms, and pauses for you to select or upload and confirm a resume. It then stops for a complete application review. The application is submitted only after you explicitly type `SUBMIT`.

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
├── resume-tailoring.js              # Career-content Gemini gateway and constrained edits
├── tailor.js                       # Local extraction, identity masking, DOCX/PDF rendering
├── applier.js                      # Local browser form filling and submission gate
├── applications.json               # Auto-generated application history
└── .env                            # API keys and local browser paths; ignored by Git
```

---

## Requirements

- Node.js 22.3 or higher
- Chromium installed (`/usr/bin/chromium` on Arch Linux)
- LibreOffice (required only when generating a tailored DOCX/PDF, not when selecting or uploading a resume yourself in LinkedIn)
- A Gemini API key is required for optional resume tailoring. Browsing, job evaluation, and applying with an existing resume still work without it; evaluation uses local requirement extraction when Gemini is unavailable.
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

Professional facts used for local scoring and model-assisted resume tailoring belong in:

```text
career-profile.json
```

On a fresh installation:

```bash
cp career-profile.example.json career-profile.json
chmod 600 career-profile.json
```

Fill in the headline, years of experience, education, skills, languages, and target roles. This file is also ignored by Git. Scout and Agent use it for local screening before displaying search results. Job evaluation sends only posting data to Gemini; approving resume tailoring additionally sends these professional fields and the selected resume's career sections.

### 3. Configure base resumes

Optional tailoring sources are configured in `resumes.json`. Each profile points to a trusted local DOCX. Base DOCX files should contain approved career facts under recognized section headings, including `EXPERIENCE` or `PROJECTS` with descriptive paragraphs or bullets. A skills list alone is not enough for substantive tailoring. Missing or invalid base-resume configuration disables the Agent's tailoring controls but does not prevent starting an application and choosing a resume in LinkedIn.

The local renderer ignores everything before the first recognized section. For a single source of truth, remove name, email, phone, location, and profile URLs from base resumes. The final header is always created locally from `private-profile.json`.

### 4. Configure services

Create a `.env` file in the project root:

```text
GEMINI_API_KEY=your_gemini_api_key
OUTPUT_DIR=./output
CHROMIUM_PATH=/usr/bin/chromium
CHROMIUM_PROFILE=/home/yourusername/.config/chromium
JSEARCH_API_KEY=your_rapidapi_key_here
```

`GEMINI_API_KEY` is required when preparing a tailored resume; `JSEARCH_API_KEY` remains optional. Evaluation requests contain only job title, company, and description. Tailoring requests contain the complete retrieved description, allowlisted professional profile fields, and career sections extracted from the selected DOCX. Private application answers, the name/contact header, and the raw DOCX/PDF files remain local. Career history itself can still be identifying; review your source sections before approving preparation.

---

## One-Time Setup for the Agent

The agent uses your existing Chromium session to stay logged into LinkedIn. Before running the agent for the first time:

1. Open Chromium manually
2. Go to https://www.linkedin.com and log in, ticking "Keep me logged in"
3. Close Chromium completely
4. Run the agent — it will pick up your session automatically

LinkedIn job links from both search providers are normalized to `https://www.linkedin.com/jobs/view/...`, with locale/tracking queries and fragments removed. The Agent also normalizes incoming job links before opening them, so regional hosts such as `my.linkedin.com` and `sg.linkedin.com` do not select a different public-site session or locale. Job location and country search filters are unchanged; external application URLs retain their parameters.

The Agent requests English pages and keeps using `CHROMIUM_PROFILE`; it does not change your LinkedIn account's language setting. If LinkedIn shows a login page, verification challenge, or visible sign-in controls, the Agent keeps Chromium open. Complete sign-in there, then type `RETRY` to reopen the same job. If authentication is still required, it pauses again rather than reporting `no_easy_apply`. `CANCEL` records an incomplete application with reason `authentication_required`.

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

1. Select countries (unless supplied with `--countries`) and fetch recent, locally profile-matched LinkedIn/JSearch jobs; process up to 20
2. Ask Gemini to extract requirements from job-posting data only, or use local extraction when Gemini is unavailable
3. Score the extracted requirements locally against `career-profile.json`; anything below 50% match is skipped automatically
4. Recommend an optional tailoring base DOCX from configured role signals; unavailable base files do not block applying
5. Display the match summary, tailoring base recommendation, and separate application-resume choice
6. Optionally press `[T]` to tailor that base and generate DOCX/PDF files locally, then return to the menu without starting an application; a tailoring failure also returns to the menu
7. Use `[R]` to change the tailoring base; choosing a different base clears any prepared PDF selection for this job
8. Press `[Y]` to open Chromium without requiring tailoring; by default you select a saved resume or upload a file yourself in LinkedIn. If `[T]` succeeded, the Agent uploads that prepared PDF first
9. Fill supported Easy Apply controls from the local private profile, asking for missing answers instead of guessing
10. Pause at the resume step: select or upload in the browser, then enter `[C]` to confirm or `[X]` to cancel the application
11. Check the actual selected resume and visible upload status before continuing; missing selections, pending/rejected uploads, and conflicting selection controls cannot be confirmed
12. Display the collected answers and actual confirmed resume filename for a complete review
13. Submit only when you explicitly type `SUBMIT`; `EDIT` returns to review and `CANCEL` exits without submission. Resume confirmation alone never submits
14. Record confirmed, unconfirmed, cancelled, skipped, incomplete, and failed outcomes in `applications.json`

```text
[Y] Start application   [T] Tailor resume (optional)   [R] Change tailoring base
[V] View JD             [N] Skip                     [Q] Quit
```

A prepared resume applies only to the current job. You can override its upload by selecting a different saved resume or uploading your own before confirming. Later fills and review preserve that choice rather than uploading the prepared file over it. A changed selection requires confirmation again; if it changes while you answer `SUBMIT`, the Agent requires a renewed final review.

Easy Apply detection waits for a visible application form with loaded controls. It supports native `<dialog>` elements, ARIA dialog/modal containers, and LinkedIn Easy Apply modal wrappers, using application labels/headings or LinkedIn classes to distinguish them from unrelated dialogs. Filling and Next/Review/Submit actions stay inside that form; hidden dialogs and background-page controls are ignored. Existing answers are preserved, and submission still requires typing `SUBMIT`.

The Agent pauses for a freshly randomized **2–4 seconds** after opening the job page, before filling each form section (including contact details, role questions, and resume uploads), and before clicking Next/Continue/Review. These pauses slow automatic navigation; they do not replace form-readiness or upload-confirmation checks and cannot guarantee that LinkedIn will keep the session signed in. Manual corrections are rechecked without an extra pause, and submission still requires explicit `SUBMIT` confirmation.

Resume steps support native file inputs, saved resume radio controls, and roleless SDUI `dialog-content` containers identified by LinkedIn's Easy Apply screen attribute. In browser mode, JAVE does not upload a local file or silently accept the preselected resume: you confirm the actual selection with `[C]`. In local-file mode, it intercepts the file chooser before clicking **Upload resume**, waits for the new upload and its selection, then asks for your confirmation. An older saved file with the same name is not proof that a new local upload succeeded. Failed automatic uploads stop progression; browser selections with missing or unresolved upload state remain paused until corrected or cancelled. Submission is blocked if no resume has been confirmed.

Before filling a blank phone field from the private profile, JAVE selects its configured phone country code instead of accepting the dropdown's implicit first option. Dial codes match exactly: a shared code such as `+1` prompts for a country rather than picking the first match. An unanswered choice stays unresolved and blocks progression when required. Existing phone/contact answers, including the account email selection, are preserved.

If the application form cannot be identified, JAVE stops rather than entering private information elsewhere on the page. Check that Chromium is signed in and the Easy Apply form opens. For an unsupported layout, capture the outer dialog wrapper, field labels/controls, and navigation buttons, with personal values redacted. Dialog identification and navigation currently recognize English application labels.

---

## Resume Tailoring and PII Boundary

Resume tailoring uses Gemini; extraction, identity masking, rendering, PDF conversion, and browser upload run locally. Selecting **Tailor resume** in Scout or pressing `[T]` in Agent authorizes sending the career content described below. Pressing `[Y]` only starts the application and does not authorize or trigger resume tailoring. Both interfaces display this boundary before the tailoring choice.

The selector compares the job title and description with local signals in `resumes.json`. JAVE reads the selected DOCX locally and discards its pre-section header. It sends the complete retrieved job description, allowlisted fields from `career-profile.json`, and structured career sections together to `gemini-3.1-flash-lite`. Known name/contact values from the private profile are masked if repeated in those sections; this is not a guarantee that career history is anonymous.

Gemini returns one summary and indexed edits to experience/project paragraphs or bullets. Entry headings, employers/dates stored in those headings, and skills lists remain unchanged; the old summary is removed. Each editable block includes locally extracted fact constraints so generation and validation use the same numeric facts, skills, scope and attribution evidence.

Validation accepts equivalent responsibility verbs (`led`, `managed`, `supervised`, `directed`) when the source block already establishes that responsibility, but does not treat them as evidence of ownership, higher seniority or credentials. Unchanged blocks echoed alongside substantive rewrites are kept untouched; summary-only, unchanged-only and word-reordering-only output still fails. Malformed edits, changed numeric facts and detectable unsupported skill/scope changes are rejected.

These checks cannot prove semantic truthfulness: review the wording for unsupported claims. Missing descriptions, API failures, or invalid output stop preparation instead of silently copying a base resume.

The local renderer restores masked identity references and adds the name/contact header from `private-profile.json`; private application answers never enter the model request. DOCX and PDF artifacts are named `Candidate_Name_Job_Role_resume.docx` and `.pdf`, with filename-safe, bounded name/role components. Each preparation gets a separate `output/resume-.../` folder to avoid overwriting prior applications while keeping the uploaded filename short. LibreOffice uses an isolated temporary profile so conversion does not interfere with open documents. Existing output files are left unchanged. Review the generated PDF before typing `SUBMIT`.

---

## Application Log

Every job the agent processes is recorded in `applications.json`, including:

- Job title and company
- Match score and reasoning
- Skills matched and missing
- Application status: applied, submitted but unconfirmed, cancelled before submission, incomplete, skipped, or error
- Actual confirmed resume filename and mode (`browser` or `local`); tailoring-base metadata is included only when that local upload remains the confirmed selection

---

## Limitations

- LinkedIn Easy Apply forms vary significantly between companies. Most are handled automatically, but complex forms with custom questions will pause and ask you for input.
- Jobs that redirect to external company websites are skipped by design.
- LinkedIn can expire or revoke a session, including when it detects automation; JAVE cannot guarantee continued authentication. Complete sign-in or verification in the Agent's open Chromium window and type `RETRY` to resume the same job.
- JSearch is optional and requires a subscribed RapidAPI key. Each search makes one JSearch request per selected country when configured; selecting more countries consumes more quota.
- Gemini rate limits can affect evaluation and tailoring. Evaluation falls back to local requirement extraction; tailoring fails explicitly without creating a fallback resume. In Agent, you can retry `[T]` or press `[Y]` to apply with an existing resume instead.