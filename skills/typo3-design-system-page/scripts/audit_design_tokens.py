#!/usr/bin/env python3
"""Validate a design-system token file and its declared WCAG contrast evidence."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
REQUIRED_RAMP = {"50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"}


def channel(value: int) -> float:
    normalized = value / 255
    return normalized / 12.92 if normalized <= 0.04045 else ((normalized + 0.055) / 1.055) ** 2.4


def luminance(value: str) -> float:
    red, green, blue = (int(value[index:index + 2], 16) for index in (1, 3, 5))
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)


def contrast(first: str, second: str) -> float:
    light, dark = sorted((luminance(first), luminance(second)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def resolve_color(value: object, colors: dict[str, object], label: str, errors: list[str]) -> str | None:
    resolved = colors.get(value, value) if isinstance(value, str) else value
    if not isinstance(resolved, str) or not HEX.fullmatch(resolved):
        errors.append(f"{label} must resolve to a six-digit hex color")
        return None
    return resolved.upper()


def require_mapping(document: dict[str, object], key: str, errors: list[str]) -> dict[str, object]:
    value = document.get(key)
    if not isinstance(value, dict):
        errors.append(f"{key} must be an object")
        return {}
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tokens", type=Path)
    parser.add_argument("--allow-example", action="store_true")
    arguments = parser.parse_args()

    try:
        document = json.loads(arguments.tokens.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exception:
        print(f"ERROR: {exception}", file=sys.stderr)
        return 2
    if not isinstance(document, dict):
        print("ERROR: token document must be a JSON object", file=sys.stderr)
        return 2

    errors: list[str] = []
    meta = require_mapping(document, "meta", errors)
    colors = require_mapping(document, "colors", errors)
    ramp = require_mapping(document, "color_ramp", errors)
    typography = require_mapping(document, "typography", errors)
    spacing = require_mapping(document, "spacing", errors)
    components = require_mapping(document, "components", errors)

    if meta.get("example_only") is True and not arguments.allow_example:
        errors.append("meta.example_only must be false before publication")
    ramp_status = meta.get("color_ramp_status")
    allowed_ramp_statuses = {"approved", "audited_existing", "proposed"}
    if ramp_status not in allowed_ramp_statuses:
        errors.append(
            "meta.color_ramp_status must be approved, audited_existing, or proposed"
        )
    for name, value in colors.items():
        resolve_color(value, {}, f"colors.{name}", errors)
    missing_ramp = sorted(REQUIRED_RAMP - set(ramp))
    if missing_ramp:
        errors.append("color_ramp is missing: " + ", ".join(missing_ramp))
    for name, value in ramp.items():
        resolve_color(value, {}, f"color_ramp.{name}", errors)
    for role in ("display", "body"):
        data = typography.get(role)
        if not isinstance(data, dict) or not all(data.get(key) for key in ("family", "weights", "license")):
            errors.append(f"typography.{role} needs family, weights, and license")
    if not isinstance(spacing.get("base_px"), (int, float)) or not isinstance(spacing.get("scale_px"), list):
        errors.append("spacing needs numeric base_px and a scale_px array")
    for key in ("action_min_height_px", "focus_width_px", "target_min_px"):
        if not isinstance(components.get(key), (int, float)):
            errors.append(f"components.{key} must be numeric")

    evidence = document.get("contrast_evidence")
    if not isinstance(evidence, list) or not evidence:
        errors.append("contrast_evidence must be a non-empty array")
        evidence = []
    results: list[str] = []
    for index, item in enumerate(evidence):
        label = f"contrast_evidence[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{label} must be an object")
            continue
        foreground = resolve_color(item.get("foreground"), colors, f"{label}.foreground", errors)
        background = resolve_color(item.get("background"), colors, f"{label}.background", errors)
        minimum = item.get("minimum")
        allowed = item.get("allowed")
        if not isinstance(minimum, (int, float)) or minimum <= 0:
            errors.append(f"{label}.minimum must be a positive number")
            continue
        if not isinstance(allowed, bool):
            errors.append(f"{label}.allowed must be boolean")
            continue
        if not isinstance(item.get("purpose"), str) or not item["purpose"].strip():
            errors.append(f"{label}.purpose must be non-empty")
        if foreground and background:
            ratio = contrast(foreground, background)
            passes = ratio + 0.005 >= float(minimum)
            if allowed != passes:
                errors.append(
                    f"{label}.allowed is {allowed}, but {ratio:.2f}:1 "
                    f"{'passes' if passes else 'fails'} {float(minimum):g}:1"
                )
            results.append(
                f"{label}: {foreground} on {background} = {ratio:.2f}:1 "
                f"(minimum {float(minimum):g}:1, allowed={str(allowed).lower()})"
            )

    for result in results:
        print(result)
    if ramp_status in allowed_ramp_statuses:
        print(f"color_ramp status: {ramp_status}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("Design tokens valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
