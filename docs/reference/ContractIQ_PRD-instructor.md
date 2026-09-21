---
title: "ContractIQ — instructor worked-example PRD (source of truth)"
source: "ContractIQ_PRD_W3 - Cohort 10.docx, Mahesh Yadav; also filed in the AI-COURSE vault at 50-Keystone/reference/contractiq-prd-example.md"
converted: "2026-09-21 by pandoc, gfm"
note: "Instructor material kept as received; never edited. Braces { } are the template prompts the instructor left in place."
---

# PROBLEM DEFINITION

## What problem is this solving?

{Briefly describe what is the problem, what is the job - to - be done, }

Small and medium-sized businesses (SMBs) sign contracts constantly - vendor agreements, supplier terms, leases, client NDAs, service agreements.But most lack in-house legal expertise to interpret them. Manual review is slow, expensive, and inconsistent: outside counsel typically charges £300–£500 per hour for contract review, and even careful lawyers can miss clauses due to fatigue and time pressure.

This leaves a gap between the volume of contracts SMBs sign and their ability to understand what they're actually agreeing to before they sign it - a classic "job to be done":

*"Help me understand what I'm signing, and what could go wrong, without hiring a lawyer for every deal."*

## Who are you solving this problem for?

{Who are your ideal customer persona, your target market}

**Primary persona:** Owner-operator, CEO, or operations manager at a 10–200 employee company with no dedicated legal team.

| **Attribute** | **Detail**                                                                                                                                                                                                                                                              |
|---------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Role          | Business owner/CEO, operations manager, or office manager who signs or routes contracts                                                                                                                                                                                 |
| Industry      | Tech startups (SaaS/vendor contracts), healthcare clinics (patient agreements, HIPAA business-associate agreements), retail/e-commerce (supplier & service agreements), real estate firms (lease & sale contracts), finance/insurance brokers (client agreements, NDAs) |
| Company size  | 10–200 employees; no in-house legal department                                                                                                                                                                                                                          |
| Behaviour     | Reviews or signs 5–15 contracts per month, largely without formal legal review                                                                                                                                                                                          |
| Pain          | Spends 1–3 hours per contract manually reading dense legal language, or skips review entirely due to cost - risking missed obligations, one-sided terms, or non-compliance                                                                                              |

**Secondary persona:** In-house paralegal or a small legal team (where one exists) that uses ContractIQ as a first-pass triage tool to flag issues before a human review, or before escalating to outside counsel. Outside counsel themselves may also use ContractIQ to accelerate first-pass review for SMB clients.

## Why is this problem worth solving?

{Make a case, cite data proving why this problem needs to be solved. Consider <u>your MOAT</u> here. What will your solution provide that is better than other options or Claude/Co-Work or copilots}

- **Quantified pain:** 43% of UK SMB legal issues cost £5,000 or more (per attached market research); lawyer-led contract review commonly runs \$300–\$1,000+ per contract; more than half of surveyed SMBs say they would avoid legal counsel altogether because it's too expensive.

- **AI accuracy advantage:** in a comparative study cited in our market research, an AI model reached 94% accuracy identifying NDA risk clauses versus 85% for experienced human lawyers - roughly a 10-point accuracy edge - and AI-assisted contract review has cut review time by over 60% in reported deployments.

- **Market gap:** existing contract lifecycle management (CLM) tools (e.g., DocuSign CLM, Ironclad, Concord) focus on storage, e-signature routing, and version tracking - not on *understanding* contract content. None are purpose-built or priced for an SMB with zero legal headcount; they assume a legal team is already reviewing the document before it enters the workflow tool.

- **MOAT:** ContractIQ's defensibility comes from three compounding sources: (1) a proprietary, growing corpus of SMB-specific contract types (vendor/supplier/lease agreements skew structurally different from the enterprise MSAs most legal-AI tools are trained on), (2) a correction-driven feedback loop - every user edit or "this flag was wrong" click becomes labeled training signal that a generic LLM wrapper doesn't accumulate, and (3) workflow lock-in through post-execution renewal tracking and a persistent contract repository, which raises switching costs beyond what a one-off "paste into ChatGPT" workflow creates. *(Note: this MOAT is a reasonable inference from the market gap described in source material, not explicitly stated there - flagged as an assumption below.)*

## Why Agentic AI?

{Explain why use of ML or LLMs with tools, planing are better suited to solve this problem vs traditional rule based system of just Ml models as is}

**What unstructured data is involved?** Free-form contract text in PDFs, Word documents, and scanned/photographed images; highly variable clause wording, structure, and formatting across industries and counterparties.

**Why rule-based systems fail:** Regex or keyword-matching cannot enumerate the near-infinite phrasings used for a given clause type - a rule tuned to one counterparty's termination clause wording breaks on the next contract's synonym-heavy phrasing. Rule-based systems also cannot generate natural-language explanations of *why* a clause is risky; they can only flag a keyword hit.

**Why LLMs are necessary:** LLMs generalize across phrasing - they can recognize that "either party may terminate upon 30 days' written notice" is a termination clause regardless of exact wording, infer obligations implied but not explicitly stated, and generate plain-language summaries and risk explanations that a rule engine cannot produce. This is on-demand insight generation, not just data extraction.

**Differentiation from ChatGPT / Copilot / Claude / Co-Work:** ContractIQ is not a general chat interface - it is a structured pipeline (OCR → entity/clause extraction → risk & compliance flagging → RAG-grounded Q&A) purpose-built for contracts, with defined output schemas, mandatory clause-level citations for every flag, a persistent contract repository, and renewal/deadline tracking. A user who pastes a contract into a general-purpose chatbot gets an unstructured, uncited, one-off answer with no audit trail and no lifecycle management - ContractIQ's value is the workflow and grounding around the model, not just the model call itself.

## How will you know that the problem is solved? - Core Metrics 

{Set a specific goal and metric that you want to measure}

Add North Start Metrics, Primary and Secondary metrics

**North Star Metric:**

> Average time from contract upload to the user understanding key terms and risks ("time-to-clarity").

| **Metric**                       | **Baseline**                                        | **Target**                    | **How tracked**                                                                                            |
|----------------------------------|-----------------------------------------------------|-------------------------------|------------------------------------------------------------------------------------------------------------|
| **Time-to-clarity (North Star)** | ~2 hours (manual read-through, per market research) | \<30 minutes (≥60% reduction) | Timestamp delta from upload event to first "insights viewed / dashboard opened" event, in-app session logs |

**Primary Metrics (1–2):**

| **Metric**                                                              | **Baseline**                        | **Target**                                                                                                                                                                 | **How tracked**                                     |
|-------------------------------------------------------------------------|-------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------|
| Clause/risk detection accuracy                                          | 0% (no automated tool exists today) | \>90% F1 on a held-out labeled contract set, benchmarked against the CUAD (Contract Understanding Atticus Dataset) legal-NLP benchmark plus an internal expert-labeled set | Automated eval suite run per model/prompt release   |
| Key entity extraction accuracy (parties, dates, amounts, governing law) | 0% (manual today)                   | \>90% precision and recall vs. expert-labeled ground truth                                                                                                                 | Eval suite, compared against labeled test contracts |

**Secondary / Supporting Metrics:**

| **Metric**                                                   | **Baseline** | **Target**                          | **How tracked**           |
|--------------------------------------------------------------|--------------|-------------------------------------|---------------------------|
| 30-day user retention                                        | —            | \>60%                               | Product analytics         |
| Net Promoter Score (NPS)                                     | —            | \>40                                | In-app survey             |
| Cost per contract analysis                                   | —            | \<\$3                               | Billing / infra cost logs |
| % of users reporting reduced or avoided external legal spend | —            | \>50% of active users after 90 days | Quarterly in-app survey   |

# SOLUTION DEFINITION

## User Flows

{Add flow diagram here showing how you visualize the product working, what is the input, what is the expected output etc, Ensure that AI drawbacks like hallucination, explainability are addressed}  
<img src="media/image1.png" style="width:6.5in;height:3.45833in" />

### **User Flows *(input → processing → output)***

ContractIQ provides a single end-to-end workflow: upload a contract, get AI-generated insight, take an informed action.

**Primary flow:**

Login → Upload contract (PDF/DOCX/scanned image) → AI analysis pipeline (OCR → extraction → risk & compliance flagging → summarization) → Insights dashboard (summary, key terms, risk flags, compliance notes) → User action (Q&A, drill-down, compare, export, approve & sign) → Post-execution tracking (renewal/deadline reminders)

**Detailed flow:**

1.  **Input:** The user logs into the ContractIQ web app and uploads a document via drag-and-drop or import from Google Drive/Dropbox. Supported formats: PDF, DOC/DOCX, and scanned images/photos (via OCR).

2.  **AI pipeline:** If the document is a scan or image, an OCR module first extracts raw text. The system then runs ML/LLM components that: extract key entities (parties, dates, amounts), identify and label clauses (termination, confidentiality, payment, indemnification, etc.), and run risk/compliance checks against known problematic patterns (one-sided indemnity, missing termination-for-convenience, missing data processing terms where personal data is involved).

3.  **Output:** The user sees a dashboard with a plain-language summary, a structured table of key terms, an obligations breakdown per party, risk flags with severity ("❗ Unlimited liability clause - high risk"), and compliance notes (e.g., "This agreement involves personal data but no Data Processing Addendum is present - consider one for GDPR compliance").

4.  **User action:** The user can ask follow-up questions in a chat interface ("What are the renewal terms?"), drill into any flagged clause to see the original text plus a suggested edit, upload a second document to compare against (e.g., a counterparty-edited version of a standard template), export a PDF/Word summary report, or proceed to e-signature (DocuSign/Adobe Sign integration) and mark the contract executed.

5.  **Hallucination safeguard:** Every extracted fact and every risk flag must cite the specific clause or page it was drawn from. If the model cannot ground an answer in the retrieved contract text, it responds "not found in this contract" instead of guessing. Any risk flag above a defined severity threshold is labeled "High risk - recommend human/legal review" rather than presented as a definitive legal verdict, and the product carries a persistent "Not legal advice" disclaimer.

6.  **Explainability:** Every flag and every chat answer is shown side-by-side with the underlying clause text, a confidence indicator (High/Medium/Low), and a "why did the AI say this" trace showing which extracted fields and source passages fed the conclusion.

> **Required: attach a visual flow diagram here** (Miro, Figma, Lucidchart, or drawn sketch) showing this flow with distinct swimlanes for what the *user* does vs. what the *system* does, including the hallucination-safeguard and explainability checkpoints described above.

## Functional Requirements

{List required features and required behaviour, user stories }

**User Stories:**

| **ID** | **User Story**                                                                                                                                              | **Acceptance Criteria**                                                                                                                                          | **Priority** |
|--------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| US-001 | As a business owner, I want to upload a contract (PDF, DOCX, or scanned image) so that I can get an AI-generated summary without reading the whole document | File uploads via drag-and-drop or Drive/Dropbox import; OCR triggers automatically for scanned files; summary appears within the latency target                  | P0           |
| US-002 | As an operations manager, I want the system to flag risky clauses with a plain-language explanation so that I know what to negotiate before signing         | Each flag cites the source clause; each flag includes a severity level and a one-sentence "why this matters" explanation                                         | P0           |
| US-003 | As a non-lawyer user, I want to ask follow-up questions about the contract in plain English so that I don't have to re-read it to find an answer            | Chat answers are grounded in retrieved contract text with a citation; unanswerable questions return "not found in this contract" rather than a fabricated answer | P0           |
| US-004 | As an ops manager, I want to compare a redlined contract against our standard template so that I can see exactly what a counterparty changed                | Diff view highlights added/removed/modified clauses; changes are summarized in plain language                                                                    | P1           |
| US-005 | As a business owner, I want to export a summary report as PDF/Word so that I can share it with a co-founder or outside counsel                              | Export includes executive summary, key terms table, and risk flags; generated in under 10 seconds                                                                | P1           |
| US-006 | As an ops manager, I want to be reminded before a contract renews or expires so that I don't get auto-renewed into unfavorable terms                        | Reminder configurable (e.g., 30/60/90 days before key date); delivered via email and in-app notification                                                         | P1           |
| US-007 | As a healthcare clinic admin, I want the system to flag whether a HIPAA Business Associate Agreement is required so that I stay compliant                   | Flag triggers when personal health information handling language is detected without a BAA; explanation cites relevant clause or its absence                     | P2           |

> P0 = launch blocker · P1 = important, ship in MVP if possible · P2 = nice-to-have, backlog

**Agent Capabilities & System Behaviour:**

| **Agent / Component**           | **Input**                                | **Output**                                           | **Autonomy level**      | **Human-in-loop trigger**                               |
|---------------------------------|------------------------------------------|------------------------------------------------------|-------------------------|---------------------------------------------------------|
| Ingestion & OCR agent           | Uploaded file (PDF/DOCX/image)           | Clean structured text                                | Fully autonomous        | If OCR confidence \<80% - flags for manual re-upload    |
| Extraction agent                | Structured text                          | Key entities & labeled clauses (JSON)                | Autonomous + review     | If a required field (e.g., effective date) is not found |
| Risk & compliance agent         | Labeled clauses                          | Risk flags with severity & citation                  | Suggests, human decides | Always for "High" severity flags - no auto-approval     |
| Summarization & Q&A agent (RAG) | Full contract text + extracted structure | Plain-language summary; chat answers                 | Fully autonomous        | User can always request "show me the source clause"     |
| Comparison agent                | Two contract documents                   | Clause-level diff with plain-language change summary | Fully autonomous        | Flags any newly introduced high-risk clause for review  |

  
Week 2

# PRIORITIZATION  Breaking your Agentic workflow into components {List different components of your AI Agent in a flow diagram}

1.  Document ingestion & OCR

2.  Key entity & clause extraction

3.  Risk analysis & compliance checks

4.  Summarization & Q&A (RAG)

## Identify risks at each component level and in overall agentic workflow {Perform risk assessment for each of the components, use below table as guide and add more checks if needed}

### 

| **Component**           | **Check**                                 | **Result**         | **Explanation**                                                                                                                                                                                                                               |
|-------------------------|-------------------------------------------|--------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1\. Ingestion & OCR     | Is ML necessary?                          | PASS               | Scanned/photographed contracts require OCR + layout understanding; a rule-based parser can't handle variable scan quality and layouts                                                                                                         |
| 1\. Ingestion & OCR     | Do you have data to train/evaluate?       | PASS               | Commercial OCR engines (e.g., AWS Textract, Google Document AI) are pre-trained; we only need a labeled sample of ~100 SMB contracts to evaluate accuracy on our document mix                                                                 |
| 1\. Ingestion & OCR     | ML feasibility                            | PASS               | OCR for typed/printed contracts is a mature, well-solved problem                                                                                                                                                                              |
| 1\. Ingestion & OCR     | Can it meet accuracy requirements?        | **FAIL**           | Handwritten annotations, poor scan quality, and non-English contracts will degrade OCR accuracy below target; **mitigation:** reject inputs below 80% OCR confidence and prompt the user to re-upload a clearer copy or a native digital file |
| 1\. Ingestion & OCR     | Can it scale?                             | PASS               | OCR APIs scale horizontally with usage-based pricing                                                                                                                                                                                          |
| 1\. Ingestion & OCR     | How fast can you get feedback?            | PASS               | OCR confidence score is immediate and machine-computed                                                                                                                                                                                        |
| 1\. Ingestion & OCR     | Applicable laws                           | PASS               | No sector-specific law directly governs OCR itself; data-handling rules (GDPR/HIPAA) apply downstream                                                                                                                                         |
| 1\. Ingestion & OCR     | Bias                                      | PASS (with caveat) | OCR engines can under-perform on non-Latin scripts or heavily stylized fonts - tracked as a fairness risk in Section 8                                                                                                                        |
| 1\. Ingestion & OCR     | Explainability                            | PASS               | Confidence score is shown to the user per document                                                                                                                                                                                            |
| 1\. Ingestion & OCR     | How easy to judge good vs. bad response?  | PASS               | OCR output can be visually spot-checked against the source scan                                                                                                                                                                               |
| 2\. Extraction          | Is ML necessary?                          | PASS               | Party names, dates, and amounts appear in unpredictable positions and phrasing across contract templates                                                                                                                                      |
| 2\. Extraction          | Do you have data to train/evaluate?       | **FAIL**           | We do not yet have a proprietary labeled SMB-contract dataset; **mitigation:** use the open CUAD dataset plus commission ~150–200 expert-labeled SMB contracts before MVP eval sign-off                                                       |
| 2\. Extraction          | ML feasibility                            | PASS               | Named-entity extraction from legal text is a well-studied LLM task                                                                                                                                                                            |
| 2\. Extraction          | Can it meet accuracy requirements?        | PASS               | \>90% F1 is achievable with modern LLMs + few-shot prompting on structured extraction tasks, per CUAD benchmark literature                                                                                                                    |
| 2\. Extraction          | Can it scale?                             | PASS               | Stateless per-document LLM calls scale with API throughput                                                                                                                                                                                    |
| 2\. Extraction          | How fast can you get feedback?            | PASS               | User corrections in the dashboard become immediate labeled signal                                                                                                                                                                             |
| 2\. Extraction          | Applicable laws                           | PASS               | GDPR/CCPA govern storage of extracted personal data (party names, addresses)                                                                                                                                                                  |
| 2\. Extraction          | Bias                                      | PASS (with caveat) | Non-English or heavily jurisdiction-specific contracts (e.g., civil-law templates) may extract less reliably - tracked in Section 8                                                                                                           |
| 2\. Extraction          | Explainability                            | PASS               | Every extracted field links to its source span in the document                                                                                                                                                                                |
| 2\. Extraction          | How easy to judge good vs. bad response?  | PASS               | Extracted fields are directly checkable against the source text                                                                                                                                                                               |
| 3\. Risk & compliance   | Is ML necessary?                          | PASS               | Judging whether a clause is "unusually one-sided" requires contextual legal reasoning, not keyword matching                                                                                                                                   |
| 3\. Risk & compliance   | Do you have data to train/evaluate?       | **FAIL**           | Ground-truth "this clause is risky" labels are subjective and scarce; **mitigation:** build eval set with 2–3 independent legal reviewers rating clauses and require majority agreement before using as ground truth                          |
| 3\. Risk & compliance   | ML feasibility                            | PASS               | LLMs can reason over clause language against known risk patterns with appropriate prompting                                                                                                                                                   |
| 3\. Risk & compliance   | Can it meet accuracy requirements?        | PASS               | Comparable published benchmarks report ~90%+ risk-detection accuracy for LLM-based contract review vs. ~85% for human lawyers on NDAs                                                                                                         |
| 3\. Risk & compliance   | Can it scale?                             | PASS               | Same stateless-call scaling as extraction                                                                                                                                                                                                     |
| 3\. Risk & compliance   | How fast can you get feedback?            | PASS               | User "this flag was wrong" clicks feed a correction queue reviewed weekly                                                                                                                                                                     |
| 3\. Risk & compliance   | Applicable laws                           | PASS               | This component must not constitute unauthorized practice of law - output is framed as "informational, not legal advice"                                                                                                                       |
| 3\. Risk & compliance   | Bias                                      | PASS (with caveat) | Risk thresholds tuned on Western/common-law contract norms may misfire on other legal traditions - flagged in Section 8                                                                                                                       |
| 3\. Risk & compliance   | Explainability                            | PASS               | Every flag shows source clause + plain-language rationale + confidence level                                                                                                                                                                  |
| 3\. Risk & compliance   | How easy to judge good vs. bad response?  | PASS (with caveat) | Legal risk judgment has genuine gray areas even among human lawyers - evaluation relies on reviewer agreement, not a single ground truth                                                                                                      |
| 4\. Summarization & Q&A | Is ML necessary?                          | PASS               | Natural-language summarization and open-ended Q&A require generative language modeling                                                                                                                                                        |
| 4\. Summarization & Q&A | Do you have data to train/evaluate?       | PASS               | Evaluated via expert review of summary accuracy/completeness rather than a fixed labeled set                                                                                                                                                  |
| 4\. Summarization & Q&A | ML feasibility                            | PASS               | Retrieval-augmented generation over a single document is a well-established pattern                                                                                                                                                           |
| 4\. Summarization & Q&A | Can it meet accuracy requirements?        | PASS               | RAG grounding + citation requirement keeps hallucination risk low for in-document questions                                                                                                                                                   |
| 4\. Summarization & Q&A | Can it scale?                             | PASS               | Same infra as extraction/risk components                                                                                                                                                                                                      |
| 4\. Summarization & Q&A | How fast can you get feedback?            | PASS               | Thumbs up/down on each chat answer is immediate                                                                                                                                                                                               |
| 4\. Summarization & Q&A | Applicable laws                           | PASS               | Same "not legal advice" framing applies to chat answers                                                                                                                                                                                       |
| 4\. Summarization & Q&A | Bias                                      | PASS               | Lower bias risk since answers are grounded in the user's own document rather than general knowledge                                                                                                                                           |
| 4\. Summarization & Q&A | Explainability                            | PASS               | Answers include inline citations to source clauses                                                                                                                                                                                            |
| 4\. Summarization & Q&A | How easy to judge good vs. bad responses? | PASS               | User can directly compare the answer to the cited source text                                                                                                                                                                                 |

Sample analysis summary, across all the components

Once we are done with component level risk we can identify all risks in your AI agents workflow.

| **Component**           | **Risk level** | **Mitigation**                                                                                                                   |
|-------------------------|----------------|----------------------------------------------------------------------------------------------------------------------------------|
| 1\. Ingestion & OCR     | Medium         | Reject low-confidence scans; support native digital upload as the recommended path                                               |
| 2\. Extraction          | Medium         | Commission expert-labeled SMB contract set pre-launch; build correction feedback loop                                            |
| 3\. Risk & compliance   | High           | Require multi-reviewer agreement for ground truth; "not legal advice" framing; human review required for all High-severity flags |
| 4\. Summarization & Q&A | Low            | RAG grounding + mandatory citation keeps hallucination risk contained                                                            |

## Prioritize components and narrow scope {Follow the prioritization tenants listed in the lesson ‘Product Roadmap & Prioritization’ and list prioritized stories}

### 

| **Story ID** | **Title**                  | **Priority** | **Points** | **Rationale**                                                                          |
|--------------|----------------------------|--------------|------------|----------------------------------------------------------------------------------------|
| US-001       | Upload & OCR ingestion     | P0           | 5          | Nothing works without ingestion - the entry point to every other feature               |
| US-002       | Risk flags with citation   | P0           | 8          | Core value proposition; the reason an SMB would pay for this over generic CLM software |
| US-003       | Grounded Q&A chat          | P0           | 8          | Primary interactive surface; differentiates from a static PDF report                   |
| US-004       | Contract comparison        | P1           | 5          | High value for redline review but not required to prove the core hypothesis            |
| US-005       | Export to PDF/Word         | P1           | 2          | Needed for sharing with co-founders/counsel, low engineering cost                      |
| US-006       | Renewal/deadline reminders | P1           | 3          | Drives retention and workflow lock-in but not needed to validate initial value         |
| US-007       | HIPAA BAA-specific flag    | P2           | 3          | Valuable for the healthcare vertical specifically; backlog until vertical expansion    |

**MVP scope rationale:** The MVP (US-001–US-003) proves the core hypothesis - that an SMB user can upload a contract and get accurate, explainable, cited insight faster and cheaper than a manual read-through - without the added engineering cost of comparison, export, or reminders. Those P1 features are deliberately deferred to MVP-1 because they add retention and workflow value but aren't required to validate whether users trust and act on the AI's core output.

# ROADMAP

{define the roadmap for your MVP as described in lesson ‘Product Roadmap & Prioritization’ }

## 

| **Release**                   | **Features**                                                                                                                                                                                                     | **Duration**         |
|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------|
| MVP / MEP (Evaluable)         | Upload & OCR ingestion (US-001), risk flags with citation (US-002), grounded Q&A chat (US-003); single-document flow only; web app only                                                                          | Weeks 1–8            |
| MVP 1                         | Contract comparison (US-004), PDF/Word export (US-005), renewal/deadline reminders (US-006); Google Drive/Dropbox import                                                                                         | Weeks 9–16           |
| Launch (General Availability) | HIPAA BAA-specific flagging (US-007), DocuSign/Adobe Sign integration, multi-user team accounts, billing/subscription tiers                                                                                      | Months 5–6           |
| Iteration                     | Expanded industry-specific risk libraries (real estate leases, finance/insurance NDAs), fine-tuned extraction model (if correction-rate data supports it), CRM/project-management integration for deadline tasks | Ongoing, post-launch |

> Each roadmap item is linked back to the prioritized stories and risk assessment in Section 3. The MVP deliberately excludes comparison, export, and reminders — an MVP that includes everything is not an MVP.

**Dependencies:**

- OCR/document-processing vendor contract finalized before Week 1 (blocks ingestion component)

- Legal review of "not legal advice" disclaimer language and terms of service before any public beta

- Expert-labeled evaluation set (150–200 contracts) delivered before MVP eval sign-off — see Section 5

- Design sign-off on the insights dashboard and citation/explainability UI by Week 4

WEEK 3

# IMPLEMENTATION PLAN

## Evaluation Strategy (Evaluating AI / Writing Evals)

{List plan for setting up evaluation for this product, how will you establish ground truth, plan to evaluate, Add how AI performance will be monitored and measured over time}  
  
Model Requirements

{Add Model selection criteria and requirements below}  
  
Here is an example to get you started…

<table>
<colgroup>
<col style="width: 22%" />
<col style="width: 18%" />
<col style="width: 59%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>CRITERIA</strong></th>
<th><strong>REQUIREMENT</strong></th>
<th><strong>RATIONALE</strong></th>
</tr>
<tr class="odd">
<th><p>Open vs.</p>
<p>Closed Source</p></th>
<th>Closed Source</th>
<th>“We do not have the resources to use an open-sourced model.”</th>
</tr>
<tr class="header">
<th>Context Window</th>
<th>128K+</th>
<th>“We need to pass in a large volume of data into the prompt.”</th>
</tr>
<tr class="odd">
<th>Modalities</th>
<th>Text, Vision</th>
<th>“We want users to be able to upload images and converse with them.”</th>
</tr>
<tr class="header">
<th>Fine-Tuning Capability</th>
<th>Required</th>
<th>“We will fine-tune our own model with proprietary data.”</th>
</tr>
<tr class="odd">
<th>Latency</th>
<th>High Priority</th>
<th>“Given the real-time nature of the product, speed is incredibly important. We are willing to spend more for a faster model as we believe it will lend itself to a positive ROI.”</th>
</tr>
<tr class="header">
<th>Accuracy</th>
<th>High Priority</th>
<th>“Given the nature of regulatory requirements, accuracy is important”</th>
</tr>
<tr class="odd">
<th>Parameters</th>
<th>N/A</th>
<th>“Given we are using GPT-4, that model only comes in 1 parameter size (1.7T). We considered using a smaller model and fine-tuning it, but given that we want our model to have broad general knowledge, we’ve decided against it.”</th>
</tr>
<tr class="header">
<th>Time to Market</th>
<th>Medium</th>
<th>Based on current plan we want to go to market in 3 months</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# EVALUATIONS

{Add your evaluations based on the HHH framework}  
  
Make a copy of this sheet for your project, Edit it and Add a link to your Evals to your PRD  
[<u>https://docs.google.com/spreadsheets/d/1j82be2ibJ7lnf2ONGNeqf0LxBVitZvl2XmiFjCmH44A/edit?usp=sharing</u>](https://docs.google.com/spreadsheets/d/1j82be2ibJ7lnf2ONGNeqf0LxBVitZvl2XmiFjCmH44A/edit?usp=sharing)

Launch Plan  
{What experimentation will you setup for the product, what evaluation criteria must be met for a Go live decision}  
  
Example - Table : Launch Criteria

| **Launch**                    | **Helpful** | **Honest** | **Harmless** | **Reason** |
|-------------------------------|-------------|------------|--------------|------------|
| **Measurement launch (1-2%)** |             |            |              |            |
| **Beta launch (2-10%)**       |             |            |              |            |
| **Launch**                    |             |            |              |            |

WEEK 4

# DATA REQUIREMENTS

{List the data strategy for your product}

| Model Fine-Tuning         | Are you fine tuning the model, if yes explain why (eg. tone/style, functional output, specialized knowledge)                                 |
|---------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| Data Preparation          | Is this data used for model turning or evaluation (establishing ground truth) Describe your process to collect/generate and prepare the data |
| Data Quantity             | Describe how much data you require (eg. 100 contracts).                                                                                      |
| Iterative Data Collection | Describe your methodology to collect data on an ongoing basis                                                                                |
| Iterative Fine-Tuning     | Describe your methodology to continuously fine-tune the model, if applicable.                                                                |
| Knowledge Base            | Describe what type of data (docs, spreadsheets) you will use for RAG Knowledge base.                                                         |

## Prompt Strategy {Add details around what type of prompting techniques you will use for this product}

# RESPONSIBLE AI RISKS & MITIGATION {Add your assessment on what responsible AI risks face your product and how you will mitigate them}

Q: How are we ensuring that we are not showing up in the media on the wrong side of AI ( Responsible AI)?

For Responsible AI:

| Accountability ::To ensure that your ML system is designed with a positive impact on people, organizations, and society, start by assessing its potential impact during the design or requirement-gathering stage of your product and follow these steps.                                                                                                |     |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----|
| What are the efficacy and limitations of your product?                                                                                                                                                                                                                                                                                                   |     |
| What compliance and Policies apply to manage sensitive data?                                                                                                                                                                                                                                                                                             |     |
| How will you Manage sensitive data?                                                                                                                                                                                                                                                                                                                      |     |
| Human oversight and control ?                                                                                                                                                                                                                                                                                                                            |     |
| Transparency:Transparent systems ensure that all stakeholders, including those who use the system to make decisions and those who are impacted by those decisions, can understand how the system is designed, how it functions, and how it can be modified                                                                                               |     |
| What are the direct and indirect use cases of your solution?                                                                                                                                                                                                                                                                                             |     |
| How do you come up with results, what is considered on each step?                                                                                                                                                                                                                                                                                        |     |
| What benchmarks like accuracy, precision do you need to share?                                                                                                                                                                                                                                                                                           |     |
| What disclosure will we need here?                                                                                                                                                                                                                                                                                                                       |     |
| Fairness : To ensure that your ML/AI systems provide a similar quality of service for all identified areas of operation, including marginalized groups, here are some practical questions to come up with your own policy.                                                                                                                               |     |
| What groups will be underrepresented , i.e your product will not work for these specific groups?How will you close this gap?(identify minimum data needed and collection plan )                                                                                                                                                                          |     |
| Explain why certain groups don't work with your product ?                                                                                                                                                                                                                                                                                                |     |
| What test/feedback loop will you put to identify groups that are not working well in your product?How will you address these?                                                                                                                                                                                                                            |     |
| Reliability and safety:To ensure that your ML/AI features consistently produce reliable and safe results, we need to proactively identify and address any safety-related issues and be transparent with our users about any vulnerabilities. Here are some practical question that will help you to implement this in the product development lifecycle: |     |
| what a reliable and safe product experience entails, what are acceptable error rates?                                                                                                                                                                                                                                                                    |     |
| What are the consequences of inputting data into your system? What can go wrong here?                                                                                                                                                                                                                                                                    |     |
| What is the recovery plan in case the system is not working as intended?                                                                                                                                                                                                                                                                                 |     |
| How do you plan to moderate the usage of the system and monitor the health of the system?In case things go wrong, how do you plan to communicate to your customers?                                                                                                                                                                                      |     |

WEEK 5

# PRICING

## Costs & Accuracy Tradeoffs (Optional)

{List different cost and accuracy tradeoffs you had to make during development}

| S. No | Item                                     | What We Used | Why We Chose This | Trade-Offs |
|-------|------------------------------------------|--------------|-------------------|------------|
| 1     | Framework                                |              |                   |            |
| 2     | LLM for Inference                        |              |                   |            |
| 3     | Libraries/Tools                          |              |                   |            |
| 4     | User Interface                           |              |                   |            |
| 5     | Vector Database                          |              |                   |            |
| 6     | Hosting App Builds on Private Repository |              |                   |            |
| 7     | Dev Editor                               |              |                   |            |

## Development Costs 

{List 1time cost of building this product - Infrastructure and Manpower }

| S NO | ITEM                                                            | COST |
|------|-----------------------------------------------------------------|------|
|      |                                                                 |      |
| 1    | Azure VM T4-16GB Nvidia GPU                                     |      |
| 2    | Azure Open AI GPT-3.5-Turbo-0125 16K (Output)                   |      |
| 3    | Azure Open AI GPT-3.5-Turbo-0125 16K (Input)                    |      |
| 4    | Azure Open AI GPT-4-Turbo 128K (Input)                          |      |
| 5    | Azure Open AI GPT-4-Turbo 128K (Output)                         |      |
| 6    | Google Cloud Vision API                                         |      |
| 7    | Azure App Service (P0v3) Premium Plan (4GB RAM, 250 GB Storage) |      |
| 8    | Azure Storage Table (GB/month)                                  |      |
| 9    | Azure Blog Storage (First 50 terabyte (TB) / month)             |      |
| 10   | Docker Hub                                                      |      |
| 11   | Github (4 users)                                                |      |
| 12   | Hosting (DNS)                                                   |      |

## Resource (Manpower cost)

| S NO      | ITEM                  | COST |
|-----------|-----------------------|------|
| 1         | Dev Ops Engineer      |      |
| 2         | Front End Engineer    |      |
| 3         | Backend Engineer (x2) |      |
| **TOTAL** |                       |      |

### 

## Operational Costs

{List ongoing costs to run the product - Infrastructure and Manpower }

## Market Size

{List Total Addressable Market (TAM), Serviceable Addressable Market(SAM)}

## Revenue Potential

{List different revenue scenarios for this product}

Pricing Models  
{List different pricing models and give rationale which one is used for this product}

## Directional Pricing

{What is the directional pricing for this feature}

# 
