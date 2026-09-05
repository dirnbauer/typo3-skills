#!/usr/bin/env python3
"""Convert TYPO3 reStructuredText documentation to compact Markdown.

Reads raw .rst content from stdin, outputs clean Markdown to stdout.
Uses only Python stdlib — no external dependencies.
"""

import re
import sys


def convert_rst_to_md(text: str) -> str:
    lines = text.splitlines()
    output = []

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip navigation-title metadata
        if stripped.startswith(":navigation-title:"):
            i += 1
            continue

        # Strip directives that should be removed entirely
        if _is_strip_directive(stripped):
            i = _skip_directive_block(lines, i)
            continue

        # Strip reference targets (.. _label:) and link targets (.. _label: url)
        if re.match(r"^\.\.\s+_[^:]+:", stripped):
            i += 1
            continue

        # Strip substitution definitions (.. |something| replace::)
        if re.match(r"^\.\.\s+\|.*\|\s+replace::", stripped):
            i = _skip_directive_block(lines, i)
            continue

        # Convert confval-menu (container for confval blocks)
        if re.match(r"^(\s*)\.\.\s+confval-menu::", stripped):
            i = _convert_confval_menu(lines, i, output)
            continue

        # Convert standalone confval blocks
        if re.match(r"^(\s*)\.\.\s+confval::\s+", line):
            i = _convert_confval(lines, i, output)
            continue

        # Convert code blocks
        if re.match(r"^(\s*)\.\.\s+code-block::", line):
            i = _convert_code_block(lines, i, output)
            continue

        # Convert literalinclude
        if re.match(r"^(\s*)\.\.\s+literalinclude::", line):
            m = re.match(r"^(\s*)\.\.\s+literalinclude::\s+(.*)", line)
            path = m.group(2).strip() if m else ""
            output.append(f"> See file: `{path}`")
            i = _skip_directive_block(lines, i)
            continue

        # Convert admonitions
        admonition_match = re.match(
            r"^(\s*)\.\.\s+(note|warning|tip|important|deprecated|"
            r"versionadded|versionchanged|attention|caution|danger|"
            r"error|hint|seealso|todo)::\s*(.*)",
            line,
            re.IGNORECASE,
        )
        if admonition_match:
            i = _convert_admonition(lines, i, output, admonition_match)
            continue

        # Convert toctree (strip entirely)
        if re.match(r"^(\s*)\.\.\s+toctree::", stripped):
            i = _skip_directive_block(lines, i)
            continue

        # Convert rubric (strip)
        if re.match(r"^(\s*)\.\.\s+rubric::", stripped):
            i = _skip_directive_block(lines, i)
            continue

        # Convert youtube directives to a link
        youtube_match = re.match(r"^(\s*)\.\.\s+youtube::\s+(.*)", line)
        if youtube_match:
            video_id = youtube_match.group(2).strip()
            output.append(f"> Video: https://www.youtube.com/watch?v={video_id}")
            i = _skip_directive_block(lines, i)
            continue

        # Strip unknown rST directives (directory-tree, card-grid, etc.)
        if re.match(r"^(\s*)\.\.\s+[\w-]+::", stripped):
            i = _skip_directive_block(lines, i)
            continue

        # Strip rST comments (.. followed by text — not a directive, not a reference)
        if re.match(r"^\.\.\s+\w", stripped):
            i = _skip_directive_block(lines, i)
            continue

        # Convert section headers (underline/overline style)
        # Case 1: Overline + title + underline
        current_char = _get_header_char(line)
        if current_char and i + 2 < len(lines):
            title_line = lines[i + 1]
            underline = lines[i + 2]
            underline_char = _get_header_char(underline)
            if underline_char and title_line.strip():
                title = title_line.strip()
                level = _header_level(current_char)
                prefix = "#" * level
                output.append(f"{prefix} {title}")
                i += 3
                continue

        # Case 2: Title + underline
        if i + 1 < len(lines) and stripped and not stripped.startswith(".."):
            next_line = lines[i + 1]
            header_char = _get_header_char(next_line)
            if header_char:
                title = stripped
                level = _header_level(header_char)
                prefix = "#" * level
                output.append(f"{prefix} {title}")
                i += 2
                continue

        # Pass through other lines with inline conversions
        output.append(_convert_inline(line))
        i += 1

    result = "\n".join(output)
    result = _cleanup(result)
    return result


def _is_strip_directive(stripped: str) -> bool:
    """Check if a line is a directive that should be stripped entirely."""
    patterns = [
        r"^\.\.\s+include::",
        r"^\.\.\s+index::",
        r"^\.\.\s+contents::",
        r"^\.\.\s+image::",
        r"^\.\.\s+figure::",
    ]
    for p in patterns:
        if re.match(p, stripped):
            return True
    return False


def _get_indent(line: str) -> int:
    """Return the indentation level of a line."""
    return len(line) - len(line.lstrip())


def _skip_directive_block(lines: list, start: int) -> int:
    """Skip a directive and all its indented content. Returns next index."""
    if start >= len(lines):
        return start + 1

    base_indent = _get_indent(lines[start])
    i = start + 1

    while i < len(lines):
        line = lines[i]
        # Blank lines within the block are part of it
        if line.strip() == "":
            i += 1
            continue
        # If indented more than the directive, it's part of the block
        if _get_indent(line) > base_indent:
            i += 1
            continue
        break

    return i


def _get_header_char(line: str) -> str:
    """Check if a line is a section underline/overline. Returns the char or None."""
    stripped = line.strip()
    if len(stripped) < 3:
        return None
    char = stripped[0]
    if char in "=-~`'^\"#*+_" and all(c == char for c in stripped):
        return char
    return None


def _header_level(char: str) -> int:
    """Map underline character to header level."""
    mapping = {
        "=": 1,
        "-": 2,
        "~": 3,
        "`": 4,
        "'": 4,
        "^": 4,
        '"': 4,
        "#": 1,
        "*": 2,
    }
    return mapping.get(char, 3)


def _convert_inline(text: str) -> str:
    """Convert rST inline markup to Markdown."""
    # Convert double backtick literals to single backtick
    text = re.sub(r"``([^`]+)``", r"`\1`", text)

    # Convert cross-references with display text: :role:`Display <target>`
    text = re.sub(
        r":(?:ref|confval):`([^<`]+?)\s*<[^>]+>`", lambda m: m.group(1).strip(), text
    )

    # Convert cross-references without display text: :role:`label`
    text = re.sub(r":ref:`([^`]+)`", r"\1", text)
    text = re.sub(r":confval:`([^`]+)`", r"`\1`", text)

    # Convert code roles to backtick
    text = re.sub(
        r":(?:typoscript|ts|yaml|php|html|sql|js|samp):`([^`]+)`", r"`\1`", text
    )

    # Convert t3src references
    text = re.sub(r":t3src:`([^`]+)`", r"`\1`", text)

    return text


def _convert_confval_menu(lines: list, start: int, output: list) -> int:
    """Process a confval-menu block — extract nested confval blocks."""
    base_indent = _get_indent(lines[start])
    i = start + 1

    # Skip the confval-menu options (lines starting with :)
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped == "":
            i += 1
            continue

        indent = _get_indent(line)
        if indent <= base_indent and stripped != "":
            break

        # Found a nested confval
        if re.match(r"\s*\.\.\s+confval::", line):
            i = _convert_confval(lines, i, output)
            continue

        # Found a nested reference target
        if re.match(r"\s*\.\.\s+_[^:]+:\s*$", stripped):
            i += 1
            continue

        # Skip option lines like :display:, :type:, :name:, :caption:
        if re.match(r"\s+:[a-zA-Z]", line):
            i += 1
            continue

        # Other content inside the menu — pass through
        i += 1

    return i


def _convert_confval(lines: list, start: int, output: list) -> int:
    """Convert a confval directive to a Markdown heading + property table."""
    m = re.match(r"^(\s*)\.\.\s+confval::\s+(.*)", lines[start])
    if not m:
        return start + 1

    base_indent = _get_indent(lines[start])
    name = m.group(2).strip()
    i = start + 1

    # Parse confval options
    props = {}
    content_lines = []
    option_indent = None

    # First pass: collect options
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped == "" and not content_lines:
            i += 1
            continue

        indent = _get_indent(line)

        # End of confval block
        if indent <= base_indent and stripped != "":
            break

        # Option lines like :type:, :Default:, :Example:
        opt_match = re.match(r"^\s+:(\w+):\s*(.*)", line)
        if opt_match and not content_lines:
            key = opt_match.group(1)
            val = opt_match.group(2).strip()
            if option_indent is None:
                option_indent = _get_indent(line)
            # Skip internal metadata and multi-line option blocks
            if key.lower() in ("name", "class", "examples"):
                i += 1
                # Skip continuation lines of :Examples: (indented lists)
                if key.lower() == "examples":
                    while i < len(lines):
                        cl = lines[i]
                        cs = cl.strip()
                        if cs == "":
                            i += 1
                            continue
                        ci = _get_indent(cl)
                        if ci > option_indent:
                            i += 1
                            continue
                        break
                continue
            props[key] = val
            i += 1
            continue

        # :Examples: block (multi-line, with list items)
        if stripped.startswith(":Examples:") and not content_lines:
            i += 1
            continue

        # Blank lines within content — check if next non-blank line
        # is still part of this confval
        if stripped == "" and content_lines:
            # Look ahead: is the next non-blank line still indented?
            j = i + 1
            while j < len(lines) and lines[j].strip() == "":
                j += 1
            if j < len(lines) and _get_indent(lines[j]) > base_indent:
                content_lines.append("")
                i += 1
                continue
            else:
                # Next content is at or below our indent — end confval
                break

        if indent > base_indent:
            # This is content belonging to the confval
            # Dedent to the base level of the confval content
            content_indent = base_indent + 4
            if indent >= content_indent:
                dedented = line[content_indent:]
            else:
                dedented = line.lstrip()
            content_lines.append(dedented)
            i += 1
            continue

        break

    # Emit heading
    output.append(f"### {name}")
    output.append("")

    # Emit property table if we have properties
    table_props = {}
    for key, val in props.items():
        if key.lower() == "name":
            continue
        display_key = key.capitalize() if key[0].islower() else key
        table_props[display_key] = _convert_inline(val)

    if table_props:
        output.append("| Property | Value |")
        output.append("|----------|-------|")
        for k, v in table_props.items():
            output.append(f"| {k} | {v} |")
        output.append("")

    # Process content lines (may contain nested directives)
    if content_lines:
        # Strip leading/trailing blank lines
        while content_lines and content_lines[0].strip() == "":
            content_lines.pop(0)
        while content_lines and content_lines[-1].strip() == "":
            content_lines.pop()

        # Process content through main converter logic for nested directives
        content_text = "\n".join(content_lines)
        converted = convert_rst_to_md(content_text)
        if converted.strip():
            output.append(converted)
            output.append("")

    return i


def _convert_code_block(lines: list, start: int, output: list) -> int:
    """Convert a code-block directive to a fenced code block."""
    m = re.match(r"^(\s*)\.\.\s+code-block::\s*(.*)", lines[start])
    if not m:
        return start + 1

    base_indent = _get_indent(lines[start])
    lang = m.group(2).strip()
    i = start + 1

    # Skip options (lines starting with :)
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped == "":
            i += 1
            continue
        if re.match(r"\s+:", lines[i]) and _get_indent(lines[i]) > base_indent:
            i += 1
            continue
        break

    # Collect code content
    code_lines = []
    code_indent = None

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped == "" and code_indent is None:
            i += 1
            continue

        indent = _get_indent(line)

        if stripped == "":
            code_lines.append("")
            i += 1
            continue

        if indent <= base_indent:
            break

        if code_indent is None:
            code_indent = indent

        # Dedent code
        if len(line) >= code_indent:
            code_lines.append(line[code_indent:])
        else:
            code_lines.append(line.lstrip())
        i += 1

    # Remove trailing blank lines
    while code_lines and code_lines[-1].strip() == "":
        code_lines.pop()

    output.append(f"```{lang}")
    output.extend(code_lines)
    output.append("```")
    output.append("")

    return i


def _convert_admonition(lines: list, start: int, output: list, match) -> int:
    """Convert an admonition directive to blockquote."""
    base_indent = _get_indent(lines[start])
    admonition_type = match.group(2)
    extra = match.group(3).strip()

    label_map = {
        "note": "Note",
        "warning": "Warning",
        "tip": "Tip",
        "important": "Important",
        "deprecated": "Deprecated",
        "versionadded": "Added in",
        "versionchanged": "Changed in",
        "attention": "Attention",
        "caution": "Caution",
        "danger": "Danger",
        "error": "Error",
        "hint": "Hint",
        "seealso": "See also",
        "todo": "TODO",
    }

    label = label_map.get(admonition_type.lower(), admonition_type.capitalize())

    if extra:
        output.append(f"> **{label}: {extra}**")
    else:
        output.append(f"> **{label}:**")

    i = start + 1
    content_lines = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped == "" and not content_lines:
            i += 1
            continue

        indent = _get_indent(line)

        if stripped == "":
            content_lines.append("")
            i += 1
            continue

        if indent <= base_indent:
            break

        # Dedent
        content_indent = base_indent + 4
        if len(line) >= content_indent:
            dedented = line[content_indent:]
        else:
            dedented = line.lstrip()
        content_lines.append(dedented)
        i += 1

    # Strip trailing blank lines
    while content_lines and content_lines[-1].strip() == "":
        content_lines.pop()

    for cl in content_lines:
        converted = _convert_inline(cl)
        if converted.strip():
            output.append(f"> {converted}")
        else:
            output.append(">")

    output.append("")

    return i


def _cleanup(text: str) -> str:
    """Clean up the final Markdown output."""
    # Remove runs of more than 2 blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Strip trailing whitespace on each line
    lines = [line.rstrip() for line in text.splitlines()]
    text = "\n".join(lines)
    # Ensure file ends with exactly one newline
    text = text.strip() + "\n"
    return text


def main():
    content = sys.stdin.read()
    result = convert_rst_to_md(content)
    sys.stdout.write(result)


if __name__ == "__main__":
    main()
