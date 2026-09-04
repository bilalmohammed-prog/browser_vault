from pathlib import Path

# Project root = directory containing this script's parent folder.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = PROJECT_ROOT / "PROJECT_TREE.md"

# Directories that should not appear in the tree.
IGNORED_DIRS = {
    ".git",
    ".github",
    ".idea",
    ".vscode",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".cache",
    "coverage",
    ".pytest_cache",
    ".venv",
    "venv",
}

# Files that should not appear in the tree.
IGNORED_FILES = {
    ".DS_Store",
    "PROJECT_TREE.md",
}

# Optional: ignore files/directories by extension.
IGNORED_EXTENSIONS = {
    ".pyc",
    ".pyo",
}


def should_ignore(path: Path) -> bool:
    """Return True if this path should be excluded from the tree."""

    if path.name in IGNORED_DIRS:
        return True

    if path.name in IGNORED_FILES:
        return True

    if path.is_file() and path.suffix in IGNORED_EXTENSIONS:
        return True

    return False


def build_tree(directory: Path, prefix: str = "") -> list[str]:
    """Recursively build the project tree."""

    try:
        entries = sorted(
            [
                path
                for path in directory.iterdir()
                if not should_ignore(path)
            ],
            key=lambda path: (path.is_file(), path.name.lower()),
        )
    except PermissionError:
        return []

    lines = []

    for index, path in enumerate(entries):
        is_last = index == len(entries) - 1

        connector = "└── " if is_last else "├── "
        lines.append(f"{prefix}{connector}{path.name}")

        if path.is_dir():
            child_prefix = prefix + ("    " if is_last else "│   ")
            lines.extend(build_tree(path, child_prefix))

    return lines


def generate_tree() -> None:
    """Generate PROJECT_TREE.md."""

    tree_lines = build_tree(PROJECT_ROOT)

    content = "# Project Tree\n\n"
    content += "```text\n"
    content += f"{PROJECT_ROOT.name}/\n"

    if tree_lines:
        content += "\n".join(tree_lines)

    content += "\n```\n"

    OUTPUT_FILE.write_text(content, encoding="utf-8")

    print(f"Project tree generated: {OUTPUT_FILE}")


if __name__ == "__main__":
    generate_tree()