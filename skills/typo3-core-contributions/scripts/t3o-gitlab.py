#!/usr/bin/env python3
"""
git.typo3.org GitLab helper for t3o site repositories.

Covers the operations that are easy to get wrong by hand: reading your real
access level before planning, writing issues and merge requests with a
read-back check (GitLab answers 200 and silently drops fields you may not set),
keeping an open merge request current (title, description, labels, draft
state), reading its merge gate and awaiting its pipeline, and
fingerprinting a live response from a site behind the Anubis bot wall.

Not for TYPO3 Core patches - those go to Gerrit, see references/gerrit-workflow.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

HOST = "https://git.typo3.org"
API = f"{HOST}/api/v4"
TOKEN_FILE = "~/.secrets/git.typo3.org"
TOKEN_ENV = "GIT_TYPO3_ORG_TOKEN"

# A browser-shaped agent is what trips the bot wall; the plain one reaches the
# origin. Keeping both here is the whole point of the `probe` subcommand.
BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
)
PLAIN_UA = "curl/8"
# Markers unique to the challenge page. Deliberately NOT "anubis": the project
# page of the anubis repository itself carries that word 107 times and would be
# misread as a wall.
WALL_MARKERS = ("techaro", "within.website", "making sure you")

ACCESS_LEVELS = {
    0: ("no membership", "read, create issues, edit your own issue descriptions"),
    10: ("Guest", "+ be linked across projects"),
    20: ("Reporter", "+ set labels, link issues"),
    30: ("Developer", "+ push branches, open merge requests"),
    40: ("Maintainer", "+ merge (but t3o rules still forbid merging your own MR)"),
    50: ("Owner", "everything"),
}


def token() -> str:
    """The PAT, from the environment first, then the token file.

    Not everyone keeps the token on disk: where it lives in a secret store it is
    exported for the call instead, and requiring the file turns a working setup
    into "No token at ~/.secrets/git.typo3.org".
    """
    value = os.environ.get(TOKEN_ENV, "").strip()
    if value:
        return value
    path = Path(TOKEN_FILE).expanduser()
    if not path.is_file():
        sys.exit(
            f"No token: set ${TOKEN_ENV} or create {TOKEN_FILE} "
            "with a git.typo3.org PAT."
        )
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        sys.exit(f"{TOKEN_FILE} is empty.")
    return value


def https_request(url: str, **kwargs: object) -> urllib.request.Request:
    """Build a Request, refusing anything urllib would open besides http(s).

    urllib honours `file://`, so a url that reached here from an argument could
    otherwise read local files.
    """
    scheme = urllib.parse.urlsplit(url).scheme
    if scheme not in ("http", "https"):
        sys.exit(f"Refusing non-http(s) url: {url}")
    return urllib.request.Request(url, **kwargs)  # type: ignore[arg-type]


def open_checked(request: urllib.request.Request, timeout: float | None = None):
    """Open a Request whose scheme https_request() has already validated.

    The single place this script reaches the network, so the `file://` concern
    behind the urllib audit rule is answered once, in https_request().

    `timeout` is what keeps a wait bounded: without it a stalled connection
    blocks past any deadline the caller thinks it has.
    """
    return urllib.request.urlopen(  # nosemgrep: dynamic-urllib-use-detected
        request, timeout=timeout
    )


def call(
    path: str,
    method: str = "GET",
    body: dict | None = None,
    timeout: float | None = None,
) -> Any:
    if not path.startswith("/") or "://" in path:
        sys.exit(f"Refusing suspicious API path: {path}")
    request = https_request(
        f"{API}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"PRIVATE-TOKEN": token(), "Content-Type": "application/json"},
    )
    try:
        with open_checked(request, timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:400]
        if error.code == 403 and "Guest role in both projects" in detail:
            detail += (
                "\nHint: cross-project links need Guest in BOTH projects. "
                "Use a full-path textual reference instead."
            )
        if error.code == 409 and "personal namespace" in detail:
            detail += (
                "\nHint: forking is disabled for your namespace. File an issue "
                "containing the ready diff instead of opening a merge request."
            )
        sys.exit(f"HTTP {error.code} on {method} {path}\n{detail}")


def encoded(project: str) -> str:
    return urllib.parse.quote(project, safe="")


def positive_int(value: str) -> int:
    """An argparse type: seconds, and seconds are positive.

    `--interval -1` otherwise reaches time.sleep(-1) as a traceback, and 0
    turns the poll into a tight loop against the API.
    """
    if not value.isascii() or not value.isdecimal() or int(value) < 1:
        raise argparse.ArgumentTypeError(f"expected a positive number: {value!r}")
    return int(value)


def numeric(value: Any, what: str) -> int:
    """An iid or id as an int, before it is put into a path.

    Both ends need this: an argument is whatever the caller typed, and an id
    read back from a response is remote input. Without it either can carry
    `../` and address an endpoint this script never meant to call. Returning
    an int rather than the validated string is what makes that impossible —
    there is no string left to smuggle a path separator in.
    """
    text = str(value)
    # isdigit() is true for "²" (int() then raises) and for "١٢٣" (int() gives
    # 123, an id the caller never typed). Only ASCII decimals are an id here.
    if not text.isascii() or not text.isdecimal():
        sys.exit(f"Not a numeric {what}: {text!r}")
    return int(text)


def read_text_arg(value: str | None, file_arg: str | None) -> str | None:
    """Prefer --*-file over the inline value so long markdown stays readable."""
    if file_arg:
        path = Path(file_arg).expanduser()
        if not path.is_file():
            sys.exit(f"Not a readable file: {file_arg}")
        return path.read_text(encoding="utf-8")
    return value


def report_labels(applied: list[str], wanted: list[str]) -> None:
    """GitLab returns 200 for a label write you are not allowed to make."""
    if not wanted:
        return
    missing = [label for label in wanted if label not in applied]
    if missing:
        print(
            f"  WARNING labels not applied: {', '.join(missing)}\n"
            "  The API answered 200 and dropped them - you need at least "
            "Reporter in this project.",
            file=sys.stderr,
        )
    else:
        print(f"  labels applied: {', '.join(applied)}")


def cmd_access(args: argparse.Namespace) -> None:
    project = call(f"/projects/{encoded(args.project)}?with_permissions=1")
    permissions = project.get("permissions") or {}
    level = 0
    for key in ("project_access", "group_access"):
        entry = permissions.get(key) or {}
        level = max(level, entry.get("access_level") or 0)
    name, can = ACCESS_LEVELS.get(level, (f"level {level}", "unknown"))

    print(f"{project['path_with_namespace']}")
    print(f"  default branch  : {project.get('default_branch')}")
    print(f"  visibility      : {project.get('visibility')}")
    print(f"  access          : {name} ({level}) - {can}")
    print(f"  issues enabled  : {project.get('issues_access_level')}")
    print(f"  builds enabled  : {project.get('builds_access_level')}")
    if project.get("builds_access_level") == "disabled":
        print(
            "  NOTE CI is disabled for this project - no pipeline will run on "
            "your merge request. Reproduce the gates locally instead."
        )
    if level < 30:
        print(
            "  NOTE you cannot push a branch here; an issue with a ready diff "
            "is the deliverable."
        )
    if level < 20:
        print(
            "  NOTE you cannot set labels here; writes will report 200 and drop them."
        )


def cmd_issue_create(args: argparse.Namespace) -> None:
    labels = [label for label in (args.label or []) if label]
    body = {
        "title": args.title,
        "description": read_text_arg(args.description, args.description_file) or "",
    }
    if labels:
        body["labels"] = ",".join(labels)
    issue = call(f"/projects/{encoded(args.project)}/issues", "POST", body)
    print(f"#{issue['iid']} {issue['web_url']}")
    report_labels(issue.get("labels") or [], labels)


def cmd_issue_update(args: argparse.Namespace) -> None:
    labels = [label for label in (args.label or []) if label]
    body: dict = {}
    if args.title:
        body["title"] = args.title
    description = read_text_arg(args.description, args.description_file)
    if description is not None:
        body["description"] = description
    if labels:
        body["labels"] = ",".join(labels)
    if not body:
        sys.exit("Nothing to update - pass --title, --description[-file] or --label.")
    issue = call(
        f"/projects/{encoded(args.project)}/issues/{numeric(args.iid, 'issue iid')}",
        "PUT",
        body,
    )
    print(f"#{issue['iid']} updated - {issue['web_url']}")
    report_labels(issue.get("labels") or [], labels)


def cmd_note(args: argparse.Namespace) -> None:
    text = read_text_arg(args.body, args.body_file)
    if not text:
        sys.exit("Pass --body or --body-file.")
    if bool(args.issue) == bool(args.merge_request):
        sys.exit("Pass exactly one of --issue or --merge-request.")
    kind = "merge_requests" if args.merge_request else "issues"
    iid = args.merge_request or args.issue
    note = call(
        f"/projects/{encoded(args.project)}/{kind}/{numeric(iid, 'iid')}/notes",
        "POST",
        {"body": text},
    )
    print(f"note {note['id']} added to {kind[:-1]} {iid}")


def cmd_mr_create(args: argparse.Namespace) -> None:
    if args.target == "main":
        sys.exit("t3o sites take merge requests against 'develop', never 'main'.")
    title = args.title
    if args.draft and not title.lower().startswith(DRAFT_MARKER):
        title = f"Draft: {title}"
    description = read_text_arg(args.description, args.description_file) or ""
    if "testing" not in description.lower():
        print(
            "WARNING the t3o workflow requires the description to state the "
            "testing done; no 'Testing' section found.",
            file=sys.stderr,
        )
    merge_request = call(
        f"/projects/{encoded(args.project)}/merge_requests",
        "POST",
        {
            "source_branch": args.source,
            "target_branch": args.target,
            "title": title,
            "description": description,
        },
    )
    print(
        f"!{merge_request['iid']} {merge_request['web_url']} "
        f"(draft={merge_request['draft']})"
    )


DRAFT_PREFIX = "Draft: "
DRAFT_MARKER = "draft:"
# GitLab derives `draft` from the title prefix; there is no boolean to set.
# It matches case-insensitively and without the space, so the marker and the
# prefix we write are not the same string.
TERMINAL_PIPELINE_STATUS = ("success", "failed", "canceled", "skipped", "manual")


def mr_path(project: str, iid: str) -> str:
    return f"/projects/{encoded(project)}/merge_requests/{numeric(iid, 'MR iid')}"


def strip_draft(title: str) -> str:
    # DRAFT_PREFIX has a trailing space the title may not, and slicing by its
    # length ate the first letter of "Draft:fix".
    if not title.lower().startswith(DRAFT_MARKER):
        return title
    return title[len(DRAFT_MARKER) :].lstrip()


def cmd_mr_update(args: argparse.Namespace) -> None:
    """Change title, description, labels or draft state of an existing MR.

    Without this the only way to take an MR out of draft, add a label or
    refresh a description after a review round is a hand-rolled curl carrying
    the token on the command line - dozens of times in a single session.
    """
    labels = [label for label in (args.label or []) if label]
    body: dict = {}
    title = args.title
    if args.draft is not None and title is None:
        title = strip_draft(str(call(mr_path(args.project, args.iid))["title"]))
    if title is not None:
        # Only when a draft state was asked for: `--title "Draft: Fix"` alone
        # must keep the prefix the caller typed, not silently ready the MR.
        if args.draft is True:
            title = f"{DRAFT_PREFIX}{strip_draft(title)}"
        elif args.draft is False:
            title = strip_draft(title)
        body["title"] = title
    description = read_text_arg(args.description, args.description_file)
    if description is not None:
        body["description"] = description
    if labels:
        body["add_labels"] = ",".join(labels)
    if not body:
        sys.exit(
            "Nothing to update - pass --title, --description[-file], --label, "
            "--draft or --ready."
        )
    merge_request = call(mr_path(args.project, args.iid), "PUT", body)
    print(
        f"!{merge_request['iid']} updated - draft={merge_request['draft']} "
        f"{merge_request['web_url']}"
    )
    report_labels(merge_request.get("labels") or [], labels)


def cmd_mr_show(args: argparse.Namespace) -> None:
    """The merge gate in one call: state, draft, why it cannot merge, threads."""
    merge_request = call(mr_path(args.project, args.iid))
    pipeline = merge_request.get("head_pipeline") or {}
    print(
        f"!{merge_request['iid']} {merge_request['state']} "
        f"draft={merge_request['draft']} sha={str(merge_request['sha'])[:8]}"
    )
    # detailed_merge_status names the reason; merge_status only says "cannot".
    print(f"  merge status: {merge_request.get('detailed_merge_status')}")
    print(f"  pipeline: {pipeline.get('status', 'none')} (id {pipeline.get('id')})")
    # Not "threads": the flag is the merge gate, and a project that allows
    # merging with open threads reports True while threads remain open.
    blocking = not merge_request.get("blocking_discussions_resolved", True)
    print(f"  blocking discussions unresolved: {blocking}")
    print(f"  {merge_request['web_url']}")


def time_left(deadline: float | None) -> float | None:
    """What a request may still take, measured when it is about to be issued.

    None is "nothing is bounding this" - `pipeline status` has no deadline.
    A budget that is gone ends the run here instead of spending one more
    request past the deadline the caller asked for.
    """
    if deadline is None:
        return None
    left = deadline - time.monotonic()
    if left <= 0:
        sys.exit(
            "The --timeout budget ran out while reading the pipeline - "
            "this is not a result."
        )
    return left


def pipeline_for(
    project: str,
    iid: str | None,
    pipeline_id: str | None,
    deadline: float | None = None,
) -> dict:
    # Every call re-reads the budget: the lookup can take two requests, and
    # the first one may have spent what the second was going to use.
    if pipeline_id:
        return call(
            f"/projects/{encoded(project)}/pipelines/{numeric(pipeline_id, 'pipeline id')}",
            timeout=time_left(deadline),
        )
    pipelines = call(
        f"{mr_path(project, str(iid))}/pipelines", timeout=time_left(deadline)
    )
    if not pipelines:
        sys.exit(
            f"No pipeline on !{iid}. Unauthenticated reads answer 200 with an "
            "empty array, so check the token before reading this as 'none ran'."
        )
    return call(
        f"/projects/{encoded(project)}/pipelines/"
        f"{numeric(pipelines[0]['id'], 'pipeline id')}",
        timeout=time_left(deadline),
    )


def print_failed_jobs(project: str, pipeline_id: Any) -> None:
    jobs = call(
        f"/projects/{encoded(project)}/pipelines/"
        f"{numeric(pipeline_id, 'pipeline id')}/jobs?per_page=100"
    )
    for job in jobs if isinstance(jobs, list) else []:
        if job.get("status") == "failed":
            print(f"  failed: {job['name']} {job['web_url']}")


def cmd_pipeline_status(args: argparse.Namespace) -> None:
    pipeline = pipeline_for(args.project, args.merge_request, args.id)
    print(
        f"pipeline {pipeline['id']} {pipeline['status']} "
        f"sha={str(pipeline['sha'])[:8]} {pipeline['web_url']}"
    )
    if pipeline["status"] == "failed":
        print_failed_jobs(args.project, pipeline["id"])
    # Same contract as `wait`: a caller chaining on this must not read a failed
    # or canceled pipeline as green.
    if pipeline["status"] in ("failed", "canceled"):
        sys.exit(1)


def cmd_pipeline_wait(args: argparse.Namespace) -> None:
    """Poll until the pipeline reaches a terminal status.

    A failed probe is not a state: a transport error leaves the pipeline
    "still running" and the loop keeps waiting rather than reporting a result
    it never read.
    """
    # Before the first request: a slow lookup spends the caller's budget too.
    deadline = time.monotonic() + args.timeout
    pipeline = pipeline_for(args.project, args.merge_request, args.id, deadline)
    project, pipeline_id = args.project, pipeline["id"]
    while True:
        status = pipeline["status"]
        if status in TERMINAL_PIPELINE_STATUS:
            print(f"pipeline {pipeline_id} {status} {pipeline['web_url']}")
            if status == "failed":
                print_failed_jobs(project, pipeline_id)
            # A canceled pipeline is not a passed one: a caller chaining on
            # this must not read "canceled" as green.
            if status in ("failed", "canceled"):
                sys.exit(1)
            return
        if time.monotonic() >= deadline:
            sys.exit(
                f"pipeline {pipeline_id} still {status} after {args.timeout}s - "
                "the wait ran out, this is not a result."
            )
        remaining = deadline - time.monotonic()
        time.sleep(min(args.interval, max(remaining, 0)))
        if time.monotonic() >= deadline:
            # Back to the top, which reports the timeout. Issuing the request
            # first would run past the deadline to say the same thing.
            continue
        try:
            pipeline = call(
                f"/projects/{encoded(project)}/pipelines/"
                f"{numeric(pipeline_id, 'pipeline id')}",
                timeout=time_left(deadline),
            )
        except urllib.error.URLError as error:
            # DNS, TLS or a dropped connection: keep the last state and poll
            # again. call() only handles HTTPError, so without this the loop
            # dies on a hiccup instead of waiting, which is what it is for.
            print(f"  probe failed ({error.reason}), still waiting", file=sys.stderr)


def cmd_link(args: argparse.Namespace) -> None:
    target_project, _, target_iid = args.to.rpartition("#")
    if not target_project or not target_iid.isdigit():
        sys.exit("--to must look like services/group/project#123")
    target = call(f"/projects/{encoded(target_project)}")
    call(
        f"/projects/{encoded(args.project)}/issues/{args.iid}/links",
        "POST",
        {
            "target_project_id": str(target["id"]),
            "target_issue_iid": target_iid,
            "link_type": args.type,
        },
    )
    print(f"linked #{args.iid} {args.type} {args.to}")


def fetch(url: str, agent: str) -> tuple[int, str, int, str, bool]:
    request = https_request(url, headers={"User-Agent": agent})
    try:
        with open_checked(request) as response:
            raw = response.read()
            status = response.status
            content_type = response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        raw = error.read()
        status = error.code
        content_type = error.headers.get("Content-Type", "")
    except urllib.error.URLError as error:
        # DNS failure, refused connection, TLS error. A probe exists to diagnose
        # a host, so it reports the reason instead of raising a traceback.
        return 0, "", 0, f"unreachable: {error.reason}", False
    text = raw.decode("utf-8", errors="replace")
    lowered = text.lower()
    start = lowered.find("<title>")
    title = ""
    if start != -1:
        title = text[start + 7 : lowered.find("</title>", start)].strip()
    walled = any(marker in lowered for marker in WALL_MARKERS)
    return status, content_type, len(raw), title, walled


def cmd_probe(args: argparse.Namespace) -> None:
    """Fingerprint a live URL so a bot-wall page is never mistaken for content."""
    print(f"{args.url}")
    verdicts = {}
    reached = {}
    for label, agent in (("plain", PLAIN_UA), ("browser", BROWSER_UA)):
        status, content_type, size, title, walled = fetch(args.url, agent)
        verdicts[label] = walled
        reached[label] = status != 0
        flag = "unreachable" if status == 0 else ("BOT WALL" if walled else "origin")
        print(
            f"  {label:<7} : {status} {content_type.split(';')[0]:<24} "
            f"{size:>8}B  [{flag}]  {title[:60]}"
        )
    if not any(reached.values()):
        print(
            "  -> Nothing was reached; the verdicts above say nothing about the site."
        )
        return
    if verdicts.get("browser") and not verdicts.get("plain"):
        print(
            "  -> A browser user agent gets the challenge page here. Anything "
            "you concluded from a browser-UA probe of this host is about the "
            "wall, not the site."
        )
    elif verdicts.get("plain") and verdicts.get("browser"):
        print("  -> Both agents hit the wall; no origin response was observed.")
    else:
        print("  -> Origin response for both agents.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="git.typo3.org helper for t3o site repositories",
        epilog="Project paths are full, e.g. services/t3o-sites/common/t3olayout",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    access = subparsers.add_parser("access", help="show your real access level")
    access.add_argument("project")
    access.set_defaults(func=cmd_access)

    issue = subparsers.add_parser("issue", help="create or update an issue")
    issue_sub = issue.add_subparsers(dest="issue_command", required=True)

    create = issue_sub.add_parser("create")
    create.add_argument("project")
    create.add_argument("--title", required=True)
    create.add_argument("--description")
    create.add_argument("--description-file")
    create.add_argument("--label", action="append")
    create.set_defaults(func=cmd_issue_create)

    update = issue_sub.add_parser("update")
    update.add_argument("project")
    update.add_argument("iid")
    update.add_argument("--title")
    update.add_argument("--description")
    update.add_argument("--description-file")
    update.add_argument("--label", action="append")
    update.set_defaults(func=cmd_issue_update)

    note = subparsers.add_parser("note", help="add a comment")
    note.add_argument("project")
    note.add_argument("--issue")
    note.add_argument("--merge-request")
    note.add_argument("--body")
    note.add_argument("--body-file")
    note.set_defaults(func=cmd_note)

    merge_request = subparsers.add_parser("mr", help="merge request operations")
    mr_sub = merge_request.add_subparsers(dest="mr_command", required=True)
    mr_create = mr_sub.add_parser("create")
    mr_create.add_argument("project")
    mr_create.add_argument("--source", required=True)
    mr_create.add_argument("--target", default="develop")
    mr_create.add_argument("--title", required=True)
    mr_create.add_argument("--description")
    mr_create.add_argument("--description-file")
    mr_create.add_argument("--draft", action="store_true", default=True)
    mr_create.add_argument("--no-draft", dest="draft", action="store_false")
    mr_create.set_defaults(func=cmd_mr_create)

    mr_update = mr_sub.add_parser("update")
    mr_update.add_argument("project")
    mr_update.add_argument("iid")
    mr_update.add_argument("--title")
    mr_update.add_argument("--description")
    mr_update.add_argument("--description-file")
    mr_update.add_argument("--label", action="append")
    draft_state = mr_update.add_mutually_exclusive_group()
    draft_state.add_argument("--draft", action="store_true", default=None)
    draft_state.add_argument("--ready", dest="draft", action="store_false")
    mr_update.set_defaults(func=cmd_mr_update)

    mr_show = mr_sub.add_parser(
        "show", help="state, draft, merge status, blocking discussions"
    )
    mr_show.add_argument("project")
    mr_show.add_argument("iid")
    mr_show.set_defaults(func=cmd_mr_show)

    pipeline = subparsers.add_parser("pipeline", help="read or await a pipeline")
    pipeline_sub = pipeline.add_subparsers(dest="pipeline_command", required=True)
    for name, func in (("status", cmd_pipeline_status), ("wait", cmd_pipeline_wait)):
        sub = pipeline_sub.add_parser(name)
        sub.add_argument("project")
        # Exactly one selector: neither asked for pipeline "None", both
        # silently ignored --merge-request.
        selector = sub.add_mutually_exclusive_group(required=True)
        selector.add_argument("--merge-request", help="newest pipeline of this MR")
        selector.add_argument("--id", help="a pipeline id, instead of --merge-request")
        if name == "wait":
            sub.add_argument("--interval", type=positive_int, default=60)
            sub.add_argument("--timeout", type=positive_int, default=3600)
        sub.set_defaults(func=func)

    link = subparsers.add_parser("link", help="relate two issues")
    link.add_argument("project")
    link.add_argument("iid")
    link.add_argument("--to", required=True, help="project/path#iid")
    link.add_argument(
        "--type",
        default="relates_to",
        choices=["relates_to", "blocks", "is_blocked_by"],
    )
    link.set_defaults(func=cmd_link)

    probe = subparsers.add_parser(
        "probe", help="fingerprint a live URL against the Anubis bot wall"
    )
    probe.add_argument("url")
    probe.set_defaults(func=cmd_probe)

    return parser


def main() -> int:
    args = build_parser().parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
