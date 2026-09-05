#!/usr/bin/env python3
"""
git.typo3.org GitLab helper for t3o site repositories.

Covers the operations that are easy to get wrong by hand: reading your real
access level before planning, writing issues and merge requests with a
read-back check (GitLab answers 200 and silently drops fields you may not set),
and fingerprinting a live response from a site behind the Anubis bot wall.

Not for TYPO3 Core patches - those go to Gerrit, see references/gerrit-workflow.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

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


def open_checked(request: urllib.request.Request):
    """Open a Request whose scheme https_request() has already validated.

    The single place this script reaches the network, so the `file://` concern
    behind the urllib audit rule is answered once, in https_request().
    """
    return urllib.request.urlopen(request)  # nosemgrep: dynamic-urllib-use-detected


def call(path: str, method: str = "GET", body: dict | None = None) -> object:
    if not path.startswith("/") or "://" in path:
        sys.exit(f"Refusing suspicious API path: {path}")
    request = https_request(
        f"{API}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"PRIVATE-TOKEN": token(), "Content-Type": "application/json"},
    )
    try:
        with open_checked(request) as response:
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
    issue = call(f"/projects/{encoded(args.project)}/issues/{args.iid}", "PUT", body)
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
        f"/projects/{encoded(args.project)}/{kind}/{iid}/notes", "POST", {"body": text}
    )
    print(f"note {note['id']} added to {kind[:-1]} {iid}")


def cmd_mr_create(args: argparse.Namespace) -> None:
    if args.target == "main":
        sys.exit("t3o sites take merge requests against 'develop', never 'main'.")
    title = args.title
    if args.draft and not title.lower().startswith("draft:"):
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
