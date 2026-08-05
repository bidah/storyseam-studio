---
name: team-access
description: >-
  Manage TEAM ACCESS — invite people into a workspace and choose how much they
  see. Use when the user says "invite <someone>", "add a teammate", "share this
  project with <email>", "give <name> access to all my projects / just this
  one", "make <name> an admin", "who's on my team", "list/remove members", or
  "change what <name> can see". Model: every user has a personal organization
  (workspace) that owns their projects; you invite others INTO an org and pick a
  SCOPE — 'all' (every current + future project) or 'selection' (named projects,
  as editor or viewer). ALWAYS call list_orgs FIRST for the organizationId (the
  user's own work is the org with personal:true); you cannot invite without it.
  invite_member returns an inviteUrl — give that link to the user to share; NO
  email is sent. If the email or scope is vague, confirm in one render_ui card
  first. Change access later with set_member_scope. The org owner's access is
  fixed.
---

# Team access (orgs, invites, scopes)

Shot Studio is multi-tenant. Each user has a **personal organization** — a
workspace that owns the projects they create. Collaboration works by inviting
other people **into an org** and granting them a **scope**.

## The model, in one picture

| concept | meaning |
|---------|---------|
| **organization** | a workspace/tenant. Everyone has a `personal: true` one; teams can have more. Projects belong to exactly one org. |
| **member role** | `owner` (fixed, full control) · `admin` (manages the org + all its projects) · `member` (sees only what they're scoped to) |
| **scope** | how much of the org a *member* sees: **all projects**, or a **selection** of specific ones |
| **project role** | on a scoped project: `editor` (can change it) or `viewer` (read-only) |

An `admin` sees everything; a plain `member` sees **nothing** until you give them
either whole-org scope or specific project grants. The person you invite can also
create and own their **own** projects in their own personal org — inviting them
never limits that.

## Always do this first

`list_orgs` → pick the `organizationId`. The user's own projects live in the org
with `personal: true`. Every other tool here needs that id.

## Inviting

`invite_member` with the `organizationId`, the `email`, and a scope:

- **whole workspace** → `scopeMode: "all"`. They see every project now and later.
- **specific projects** → `scopeMode: "selection"`, `projectIds: [...]`, and
  `projectRole` `"editor"` (default) or `"viewer"`.
- **a co-manager** → `role: "admin"` (scope is irrelevant; admins see all).

It returns an **`inviteUrl`**. Show it to the user and tell them to send it to the
person — **no email goes out automatically**. The invitee opens the link while
signed in and accepts; that's when they actually join.

If the user was vague about the email or the scope, draw ONE `render_ui` confirm
card ("Invite alice@example.com to *Whistlewood* as editor?") before calling
invite_member — don't guess a scope and don't fan out one invite per project when
they meant "all".

## Changing access later

`set_member_scope` (get the member's `userId` from `list_members`):

- `allProjects: true|false` — flip whole-org reach.
- `grants: [{ projectId, role }]` — add or re-role specific projects.
- `revokeProjectIds: [...]` — take specific projects away.

`list_members` shows the current roster with each person's role, `allProjects`
flag, and per-project `grants` — read it before changing anything so you report
the real before/after.

## Rules

1. **`list_orgs` before anything** — you can't act without the `organizationId`.
2. **Never invent a scope.** If the user didn't say "all" vs. which projects,
   ask with a `render_ui` card.
3. **Hand over the inviteUrl.** The invite isn't delivered until the user shares
   that link; always surface it, never imply an email was sent.
4. **The owner is fixed.** You can't change or remove the org owner's access.
5. Report results in chat (who now has what), not by sending the user to a tab.
