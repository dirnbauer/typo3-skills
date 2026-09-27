"""Every PHP file the skills ship must parse: probes, adapters, examples. Skipped without PHP."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# One PHP process for all files: TOKEN_PARSE runs the real parser and throws ParseError.
# Keep the ini files: Debian/Ubuntu ship the tokenizer as a shared extension, so `php -n` lacks it.
CHECK = r"""
if (!function_exists('token_get_all')) {
    fwrite(STDOUT, "The tokenizer extension is not loaded; enable it to syntax-check the skills.\n");
    exit(2);
}
$failed = 0;
foreach (array_slice($argv, 1) as $file) {
    try {
        token_get_all((string)file_get_contents($file), TOKEN_PARSE);
    } catch (ParseError $error) {
        $failed++;
        fwrite(STDOUT, $file . ':' . $error->getLine() . ' ' . $error->getMessage() . "\n");
    }
}
exit($failed ? 1 : 0);
"""


class PhpSyntaxTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("php"), "php is not installed")
    def test_shipped_php_files_parse(self):
        files = sorted(
            str(path)
            for path in (ROOT / "skills").rglob("*.php")
            if not {"node_modules", "vendor"} & set(path.parts)
        )
        self.assertTrue(files, "expected PHP files under skills/")
        result = subprocess.run(
            ["php", "-r", CHECK, "--", *files],
            capture_output=True, text=True, timeout=600,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
