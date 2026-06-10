---
name: audit
description: Run a comprehensive technical assessment of the current repo -- architecture, security, code quality, and issues -- and produce a structured report
argument-hint: [output-path]
---

Parse $ARGUMENTS as follows:
- **output-path** (optional): Where to save the report. Defaults to `TECHNICAL_ASSESSMENT.md` in the repo root.

## What This Skill Does

Perform a deep, structured audit of the current repository and produce a professional technical assessment report. This is NOT a migration plan -- it's a health check. The report should be useful to hand to a CTO, lead dev, or external consultant.

## Execution Steps

### Phase 1: Discover the Stack

Before analyzing anything, understand what you're looking at:

1. **Identify the language(s) and framework(s)** -- check package files (`package.json`, `*.csproj`, `Cargo.toml`, `go.mod`, `requirements.txt`, `Gemfile`, `pom.xml`, `build.gradle`, etc.)
2. **Map the project structure** -- how many projects/packages/apps? Monorepo or single project? What build system?
3. **Identify the database(s)** -- ORMs, migrations, connection strings, schema files
4. **Identify external integrations** -- third-party SDKs, API clients, webhooks
5. **Identify infrastructure** -- CI/CD files, Docker, Kubernetes, cloud provider configs
6. **Identify the test setup** -- test frameworks, test directories, coverage config

### Phase 2: Analyze (use parallel agents for speed)

Launch parallel investigations for each section. Be thorough -- read actual code, don't just look at file names.

#### 2a. Good Patterns (What They're Doing Well)

Look for and document with specific examples:
- **Architecture**: Layered? Clean? Hexagonal? Event-driven? Is there clear separation of concerns?
- **Design patterns**: Interface-driven design, dependency injection, repository pattern, CQRS, etc.
- **Code organization**: Feature-based? Layer-based? Domain-driven? Is it consistent?
- **Error handling**: Structured errors? Custom exceptions? Proper HTTP status codes?
- **Validation**: Where does it live? Is it centralized or scattered?
- **Async patterns**: Are I/O operations non-blocking?
- **Type safety**: Strong typing? Generics? Discriminated unions?
- **API design**: RESTful? Consistent naming? Versioning?

For each good pattern found, explain WHY it's good and give a concrete file/line example.

#### 2b. Technology Inventory

Build a table of every significant dependency with:
- Name
- Version in use
- Current latest version
- Status: `Current`, `Behind`, `Maintenance only`, `EOL`, `Vulnerable`

Separate into categories: Backend, Frontend, Database, Infrastructure, Testing, Third-Party Integrations.

#### 2c. Issues That Need Attention

Categorize by severity: CRITICAL, HIGH, MEDIUM, LOW.

**CRITICAL** -- must fix regardless of any other plans:
- Security vulnerabilities (see 2d)
- Data loss risks
- Production stability risks

**HIGH** -- significant risk or tech debt:
- God classes / god files (any file over 1,000 lines deserves scrutiny; over 2,000 is almost always a problem)
- Missing test coverage for critical paths
- Tight coupling that prevents independent deployment or testing
- Dead code that creates confusion
- Inconsistent patterns that indicate no shared conventions

**MEDIUM** -- should fix but not urgent:
- Outdated dependencies (not EOL, just behind)
- TODO/FIXME/HACK debt markers
- Copy-paste duplication
- Missing documentation for complex logic
- Inconsistent error handling

**LOW** -- nice to have:
- Code style inconsistencies
- Minor naming issues
- Over-engineering / premature abstraction

For each issue, provide: the file path, what's wrong, why it matters, and a suggested fix direction.

#### 2d. Security Posture

Scan specifically for:

**Secrets & Credentials:**
- Hardcoded passwords, API keys, tokens, connection strings in source
- `.env` files committed to git (check `.gitignore`)
- Certificates or private keys in the repo
- Secrets in CI/CD config files

**Authentication & Authorization:**
- Missing auth on API endpoints
- Weak password policies
- Insecure token configuration (long TTL, no refresh, HTTP allowed)
- Missing CSRF protection
- Session management issues

**Input Handling:**
- SQL injection risks (raw queries, string concatenation)
- XSS risks (unescaped user input in templates)
- Command injection risks
- Path traversal risks
- Missing input validation on API boundaries

**Infrastructure Security:**
- Missing security headers (CSP, HSTS, X-Frame-Options, etc.)
- CORS misconfiguration
- Insecure TLS/SSL config
- Exposed debug endpoints or admin panels
- Overly permissive file permissions

**Dependency Security:**
- Known CVEs in dependencies
- Outdated packages with security patches available

Produce a scorecard table rating each area: PASS, MIXED, FAIL, UNKNOWN.

#### 2e. CI/CD & DevOps

Evaluate the pipeline:
- What triggers builds? (PRs, merges, tags?)
- What validation runs? (lint, test, build, security scan?)
- What's the deployment model? (manual, auto, staged?)
- Are there environment promotions? (dev -> staging -> prod?)
- What's missing?

Check git history for signals:
- Revert frequency (high reverts = bugs caught in prod, not CI)
- Branch strategy (GitFlow, trunk-based, etc.)
- PR discipline (direct commits to main?)

#### 2f. Test Coverage Assessment

- Count test files vs source files
- Identify test framework(s)
- Check for empty tests (no assertions)
- Identify critical untested code paths
- Estimate overall coverage percentage

### Phase 3: Write the Report

Structure the output as a markdown file with these sections:

```markdown
# [Repo Name] -- Technical Assessment Report

**Date**: [today's date]
**Scope**: Full codebase audit -- architecture, technology, code quality, and security
**Purpose**: Identify strengths, risks, and areas for improvement

---

## Executive Summary
[3-5 sentences: what this project is, what stack it uses, what's good, what's concerning]

---

## 1. What They're Doing Well
[Each pattern as an H3 with concrete examples and file paths]

## 2. Technology Inventory
[Tables by category: Backend, Frontend, Database, Infrastructure, Testing, Integrations]

## 3. Issues That Must Be Fixed
[Grouped by severity: CRITICAL, HIGH, MEDIUM]
[Each issue: file path, what's wrong, why it matters, fix direction]

## 4. Security Posture
[Detailed findings with file:line references]
[Scorecard table at the end]

## 5. CI/CD & DevOps Assessment
[Pipeline analysis, git history signals, what's missing]

## 6. Test Coverage Assessment
[Numbers, gaps, recommendations]

## 7. Additional Findings
[Anything else noteworthy that doesn't fit above -- half-finished migrations, unusual patterns, etc.]

## 8. Summary of Recommendations (Priority Order)
[Table: Priority (P0-P3) | Category | Action]
```

### Phase 4: Save

Save the report to the specified output path (default: `TECHNICAL_ASSESSMENT.md` in repo root).

## Rules

1. **Be specific.** Every finding must include a file path. "There are security issues" is useless. "`XeroAPIHelper.cs:35` contains a hardcoded OAuth consumer key" is useful.
2. **Be balanced.** Start with what's good. Teams that get pure criticism shut down. Acknowledge good work before listing problems.
3. **Be honest about severity.** Don't inflate issues to seem thorough. A missing comma in a comment is not HIGH severity.
4. **No migration plans.** This is a health check, not a roadmap. If migration is needed, say so in findings, but don't design it here.
5. **Use tables.** Technology inventories, security scorecards, and recommendation summaries should always be tables.
6. **Quantify.** "Low test coverage" is vague. "16 test files for 27 projects, estimated <5% coverage" is actionable.
7. **Read the actual code.** Don't just grep for patterns -- open files, read implementations, understand the architecture before judging it.
8. **Use parallel agents** for the analysis phase to maximize speed. Each section (2a-2f) can run concurrently.
9. **Don't pad the report.** If a section has nothing noteworthy, say so in one line and move on. A 20-page report full of filler is worse than a 10-page report with substance.
10. **Include a "doing well" section.** This is not optional. Every codebase has good patterns -- find them.
