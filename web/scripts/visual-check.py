"""Backward-compatible entry point for the current static-site browser checks."""
import os
import runpy
import sys
from pathlib import Path

if '--base' not in sys.argv:
    sys.argv.extend(['--base', os.environ.get('SKILLFLUX_WEB_URL', 'http://127.0.0.1:4321')])
runpy.run_path(str(Path(__file__).with_name('public-ui-check.py')), run_name='__main__')
